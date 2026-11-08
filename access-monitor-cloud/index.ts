import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
import {ApiError,ALLOWED_ORIGIN,SOURCE,sha256,generateToken,bearer,verifyOwner,limitedJson,publicIpv4} from './core.mjs';
import {normalizeSnapshot} from './snapshot.mjs';
import {deviceDigest,deviceSource} from './bootstrap.mjs';
import {schema} from './schema.mjs';

const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{max:1,prepare:false,connect_timeout:5,idle_timeout:10,ssl:'require'});
let initialized:Promise<void>|null=null;
async function ensureSchema(){
  if(!initialized)initialized=(async()=>{
    await sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(174831821,1)`;
      await tx.unsafe(schema);
      if(/^[a-f0-9]{64}$/.test(deviceDigest))await tx`insert into aman_access_v1.keys(id,digest,source_id,active) values('device-windows',${deviceDigest},${deviceSource},true) on conflict(id) do nothing`;
    });
  })().catch(error=>{initialized=null;throw error});
  return initialized;
}
let cachedKeys:any=null,keysExpire=0;
async function jwks(){if(cachedKeys&&Date.now()<keysExpire)return cachedKeys;const response=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw new Error();cachedKeys=await response.json();keysExpire=Date.now()+300000;return cachedKeys;}
function json(status:number,data:any,origin:string|null){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin===ALLOWED_ORIGIN?{'Access-Control-Allow-Origin':ALLOWED_ORIGIN}:{}),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}});}
async function prune(tx:any){
  await tx`delete from aman_access_v1.events where occurred_at<now()-interval '7 days'`;
  await tx`delete from aman_access_v1.sources where last_seen<now()-interval '7 days' or source_id not in(select source_id from aman_access_v1.sources order by last_seen desc,source_id limit 25)`;
  await tx`delete from aman_access_v1.events where (source_id,id) not in(select source_id,id from aman_access_v1.events order by occurred_at desc,source_id,id limit 150) or source_id not in(select source_id from aman_access_v1.sources)`;
}
async function readSnapshot(tx:any){
  const events=(await tx`select event from aman_access_v1.events order by occurred_at desc,source_id,id limit 150`).map((r:any)=>r.event);
  const sources=(await tx`select source_id,last_seen from aman_access_v1.sources order by last_seen desc,source_id limit 25`).map((r:any)=>({source_id:r.source_id,last_seen:r.last_seen.toISOString()}));
  const result={events,sources,server_time:new Date().toISOString(),limit:150,retention_days:7,truncated:events.length===150};
  while(new TextEncoder().encode(JSON.stringify(result)).length>180*1024&&events.length)events.pop();
  return result;
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');
  try{
    if(origin&&origin!==ALLOWED_ORIGIN)throw new ApiError(403,'Origin not allowed');
    const url=new URL(req.url),path=url.pathname.split('/aman-access-monitor').pop()!;
    const methods:Record<string,string[]>={'/api/time':['GET'],'/api/health':['GET'],'/api/events':['GET'],'/api/geo':['GET'],'/api/ingest':['POST'],'/api/collector-health':['GET'],'/api/collector-key/status':['GET'],'/api/collector-key':['POST'],'/api/collector-key/revoke':['POST']};
    if(!methods[path])throw new ApiError(404,'Not found');
    if(req.method==='OPTIONS'){if(origin!==ALLOWED_ORIGIN||!methods[path].includes(req.headers.get('access-control-request-method')||'')||(req.headers.get('access-control-request-headers')||'').split(',').some(x=>x.trim()&&!['authorization','content-type'].includes(x.trim().toLowerCase())))throw new ApiError(403,'Preflight rejected');return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':methods[path].join(', '),'Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'}});}
    if(!methods[path].includes(req.method))throw new ApiError(405,'Method not allowed');
    if(path==='/api/time')return json(200,{server_time:new Date().toISOString()},origin);
    if(path==='/api/health'){try{await sql`select 1`;return json(200,{database_available:true},origin);}catch(error){const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,60}$/.test(error.code)?error.code:'CONNECTION_FAILED';return json(503,{database_available:false,database_identity_configured:!!Deno.env.get('SUPABASE_DB_URL'),code},origin);}}
    const token=bearer(req),isCollector=path==='/api/ingest'||path==='/api/collector-health';
    if(!isCollector)await verifyOwner(token,jwks);
    else if(!/^aman_[A-Za-z0-9_-]{43}$/.test(token))throw new ApiError(401,'Unauthorized');
    await ensureSchema();
    if(isCollector){
      const hash=await sha256(token);
      // Global application lock makes revoke/rotate and ingestion atomic across instances.
      const result=await sql.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(174831821,1)`;
        const [key]=await tx`select source_id from aman_access_v1.keys where digest=${hash} and active=true`;
        if(!key)throw new ApiError(401,'Unauthorized');
        if(path==='/api/collector-health'){
          const [row]=await tx`select (select count(*)::int from aman_access_v1.events where source_id=${key.source_id}) as event_count,(select last_seen from aman_access_v1.sources where source_id=${key.source_id}) as last_seen`;
          return {source_id:key.source_id,...row};
        }
        const body=await limitedJson(req);
        if(!body||Object.keys(body).some(k=>!['source_id','events'].includes(k))||body.source_id!==key.source_id||!Array.isArray(body.events)||body.events.length>100)throw new ApiError(400,'Invalid batch');
        if(body.events.some((e:any)=>!e||typeof e!=='object'||Array.isArray(e)||e.source_id!==key.source_id||Object.keys(e).some(k=>!['id','source_id','session_id','occurred_at','type','actor','ip','action','metadata'].includes(k))))throw new ApiError(400,'Invalid event');
        let normalized;try{normalized=normalizeSnapshot({events:body.events,sources:[]});}catch{throw new ApiError(400,'Invalid event');}
        for(const event of normalized.events){event.metadata.received_at=new Date().toISOString();await tx`insert into aman_access_v1.events(source_id,id,occurred_at,event) values(${key.source_id},${event.id},${event.occurred_at},${tx.json(event)}) on conflict(source_id,id) do nothing`;}
        await tx`insert into aman_access_v1.sources(source_id,last_seen) values(${key.source_id},now()) on conflict(source_id) do update set last_seen=excluded.last_seen`;
        await prune(tx);
        return {ok:true,accepted:normalized.events.length,expired:normalized.expired,server_time:new Date().toISOString()};
      });return json(200,result,origin);
    }
    if(path==='/api/events'){const snapshot=await sql.begin(async tx=>{await tx`select pg_advisory_xact_lock(174831821,1)`;await prune(tx);return readSnapshot(tx);});return json(200,snapshot,origin);}
    if(path.startsWith('/api/collector-key')){
      const result=await sql.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(174831821,1)`;
        if(path==='/api/collector-key/status'){const [row]=await tx`select active,source_id,created_at from aman_access_v1.keys where id='manual'`;return row||{active:false};}
        const body=await limitedJson(req,4096);
        if(path==='/api/collector-key/revoke'){if(!body||Object.keys(body).length)throw new ApiError(400,'Empty object required');await tx`update aman_access_v1.keys set active=false where id='manual'`;return {ok:true,active:false};}
        if(!body||Object.keys(body).length!==1||typeof body.source_id!=='string'||!SOURCE.test(body.source_id))throw new ApiError(400,'Valid source_id required');
        const fresh=generateToken();await tx`insert into aman_access_v1.keys(id,digest,source_id,active,created_at) values('manual',${await sha256(fresh)},${body.source_id},true,now()) on conflict(id) do update set digest=excluded.digest,source_id=excluded.source_id,active=true,created_at=excluded.created_at`;
        return {active:true,token:fresh,source_id:body.source_id};
      });return json(200,result,origin);
    }
    if(path==='/api/geo'){
      const ip=url.searchParams.get('ip');if(!publicIpv4(ip))throw new ApiError(400,'Public IPv4 required');
      const response=await fetch('https://ipapi.co/'+ip+'/json/',{signal:AbortSignal.timeout(5000),redirect:'error',headers:{Accept:'application/json'}});
      if(!response.ok)throw new ApiError(502,'Location unavailable');const data=await limitedJson(new Request('https://local.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:response.body,duplex:'half'} as any),65536);
      if(data.error||typeof data.latitude!=='number'||typeof data.longitude!=='number'||!Number.isFinite(data.latitude)||!Number.isFinite(data.longitude)||Math.abs(data.latitude)>90||Math.abs(data.longitude)>180)throw new ApiError(502,'Location unavailable');
      return json(200,{approximate:true,latitude:data.latitude,longitude:data.longitude,...Object.fromEntries([['city',data.city],['region',data.region],['country',data.country_name]].map(([k,v])=>[k,typeof v==='string'?v.slice(0,160):null]))},origin);
    }
    throw new ApiError(404,'Not found');
  }catch(error){return json(error instanceof ApiError?error.status:503,{error:error instanceof ApiError?error.message:'Private monitoring service unavailable'},origin);}
});

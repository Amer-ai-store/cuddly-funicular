import { Miniflare } from 'miniflare';
import { readFile,readdir,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const build=spawnSync(process.execPath,['scripts/build-worker.mjs'],{cwd:root,stdio:'inherit'});
if(build.status!==0)process.exit(build.status||1);
await mkdir(resolve(root,'.aas-local'),{recursive:true});
const mf=new Miniflare({
  scriptPath:resolve(root,'dist/server/index.js'),modules:true,compatibilityDate:'2025-05-01',
  d1Databases:['DB'],d1Persist:resolve(root,'.aas-local/d1'),port:3000,host:'127.0.0.1',
  bindings:{AAS_API_TOKEN:'local-development-only',AAS_ALLOWED_SERVER_ORIGINS:'[]'},
  // Local HTTP must use the session proxy; the hosted Worker uses Cloudflare fetch.
  serviceBindings:{GITHUB_API_HTTP:async request=>{
    const response=await fetch(request.url,{method:'GET',headers:Object.fromEntries(request.headers),redirect:'manual',signal:request.signal});
    return new Response(response.body,{status:response.status,headers:response.headers});
  }}
});
const db=await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS _aas_local_migrations (name TEXT PRIMARY KEY)').run();
for(const name of (await readdir(resolve(root,'drizzle'))).filter(v=>v.endsWith('.sql')).sort()){
  if(await db.prepare('SELECT name FROM _aas_local_migrations WHERE name = ?').bind(name).first())continue;
  const sql=await readFile(resolve(root,'drizzle',name),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))await db.prepare(statement).run();
  await db.prepare('INSERT INTO _aas_local_migrations (name) VALUES (?)').bind(name).run();
}
await mf.ready;
// Development identity is injected only on the loopback preview proxy.
const {createServer}=await import('node:http');
const proxy=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
  for(const name of [...headers.keys()])if(name.startsWith('oai-authenticated-user-'))headers.delete(name);
  headers.set('oai-authenticated-user-id','local-development-owner');
  const upstream=await mf.dispatchFetch('http://127.0.0.1:3001'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  res.writeHead(upstream.status,Object.fromEntries(upstream.headers));res.end(Buffer.from(await upstream.arrayBuffer()));
});
// Miniflare itself is for service requests. Browser development goes through this identity proxy.
proxy.listen(3001,'127.0.0.1',()=>console.log('Local workspace: http://127.0.0.1:3001 (development identity only)'));
const shutdown=async()=>{proxy.close();await mf.dispose();process.exit(0);};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

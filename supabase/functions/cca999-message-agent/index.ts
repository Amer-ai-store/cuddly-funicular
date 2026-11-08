import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJECT = "amer-ai-store";
const VERSION = "1.1.0";
const ORIGIN = "https://amer-ai-store.github.io";
const STATES = ["QUEUED", "DELIVERED", "READ", "ACKNOWLEDGED"];
const allowedKeys = (user: any): string[] => {
  const keys = user?.app_metadata?.cca999_chat_keys;
  return Array.isArray(keys) ? keys.filter((key: unknown) => typeof key === "string") : [];
};
const text = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
const reply = (data: unknown, code = 200, origin = "") =>
  new Response(JSON.stringify(data), { status: code, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin === ORIGIN ? { "access-control-allow-origin": ORIGIN, "vary": "Origin" } : {})
  }});
const receipt = (kind: string, actorId: string) => ({
  receipt_id: kind + "_" + crypto.randomUUID(),
  actor_user_id: actorId,
  recorded_at: new Date().toISOString(),
  attestation: "AUTHENTICATED_API_CLIENT_NOT_CHATGPT_UI"
});
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const isChatKey = (key: string) => /^[A-Za-z0-9_.:-]{1,100}$/.test(key);
const permit = (user: any, chat: string) => isChatKey(chat) && allowedKeys(user).includes(chat);
async function endpoint(c: any, chat: string) {
  const { data, error } = await c.from("orchestrator_chat_endpoints")
    .select("chat_key,agent_name,active").eq("chat_key", chat)
    .eq("project_key", PROJECT).eq("active", true).maybeSingle();
  if (error) throw Error("ENDPOINT_LOOKUP_FAILED");
  return data;
}
async function addEvent(c: any, msgId: string, state: string, actorId: string, proof: any) {
  const { error } = await c.from("orchestrator_bus_events").insert({
    message_id: msgId, state, actor: "auth_user:" + actorId, evidence: proof
  });
  return !error;
}
async function authorize(c: any, req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ") || header.length > 8000) return null;
  const token = header.slice(7).trim();
  const { data, error } = await c.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user;
}
async function lookupMessage(c: any, id: string) {
  const {data, error} = await c.from("orchestrator_bus_messages")
    .select("id,external_message_id,source_chat_key,destination_chat_key,source_agent,destination_agent,correlation_id,status,created_at,delivered_at,read_at,acknowledged_at")
    .eq("id", id).eq("project_key",PROJECT).maybeSingle();
  if (error) throw Error("MESSAGE_LOOKUP_FAILED");
  return data;
}
async function queue(c: any, user: any, source: string, destination: string, subject: string, body: string, parent: any = null) {
  if (!permit(user, source)) return {status:403, body:{ok:false,error:"SOURCE_NOT_AUTHORIZED"}};
  if (!isChatKey(destination) || !subject || !body) return {status:400,body:{ok:false,error:"INVALID_MESSAGE"}};
  const [src,dst] = await Promise.all([endpoint(c,source),endpoint(c,destination)]);
  if (!src || !dst) return {status:404,body:{ok:false,error:"CHAT_NOT_REGISTERED"}};
  const sent = receipt("queued", user.id);
  const externalId = "cca999_" + crypto.randomUUID();
  const correlation = parent?.correlation_id || "corr_" + crypto.randomUUID();
  const payload = { schema:"cca999.message.v1",subject,body,reply_to:parent?.id || null,receipt_id:sent.receipt_id };
  const {data, error} = await c.from("orchestrator_bus_messages").insert({
    external_message_id:externalId,source_agent:src.agent_name,destination_agent:dst.agent_name,
    message_type:"TASK",payload,status:"QUEUED",requires_ack:true,correlation_id:correlation,
    trace_id:"trace_"+crypto.randomUUID(),project_key:PROJECT,source_chat_key:source,
    destination_chat_key:destination,command_name:null,command_version:1
  }).select("id,created_at").single();
  if (error || !data) return {status:503,body:{ok:false,error:"QUEUE_WRITE_FAILED"}};
  const audited = await addEvent(c,data.id,"QUEUED",user.id,{...sent,source_chat_key:source,destination_chat_key:destination,external_message_id:externalId,reply_to:parent?.id||null});
  if (!audited) return {status:503,body:{ok:false,error:"AUDIT_EVENT_FAILED",message_id:data.id,audit_incomplete:true}};
  return {status:201,body:{ok:true,state:"QUEUED",message_id:data.id,external_message_id:externalId,correlation_id:correlation,receipt:sent,
    delivery_verified:false,chatgpt_delivery_verified:false}};
}
Deno.serve(async (req:Request) => {
  const origin=req.headers.get("origin")||"";
  if(req.method==="OPTIONS") return origin===ORIGIN ? new Response(null,{status:204,headers:{
    "access-control-allow-origin":ORIGIN,"access-control-allow-headers":"authorization,content-type",
    "access-control-allow-methods":"GET,POST,OPTIONS","vary":"Origin"
  }}) : reply({ok:false,error:"ORIGIN_NOT_ALLOWED"},403,origin);
  if(req.method==="GET" && new URL(req.url).pathname.endsWith("/health")) {
    try{
      const c=db();
      const {error}=await c.from("orchestrator_chat_endpoints").select("chat_key").limit(1);
      return reply({ok:!error,service:"cca999-message-agent",version:VERSION,database_reachable:!error,
        auth:"supabase-auth-user-app-metadata-scopes",meaning:"API server health is not proof of ChatGPT delivery"},error?503:200,origin);
    }catch{return reply({ok:false,error:"HEALTH_CHECK_UNAVAILABLE"},503,origin)}
  }
  if(req.method!=="POST") return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405,origin);
  if(Number(req.headers.get("content-length")||0)>14000) return reply({ok:false,error:"REQUEST_TOO_LARGE"},413,origin);
  try {
    const c=db();
    const user=await authorize(c,req);
    if(!user) return reply({ok:false,error:"AUTHENTICATION_REQUIRED"},401,origin);
    if(!allowedKeys(user).length) return reply({ok:false,error:"CHAT_MEMBERSHIP_NOT_PROVISIONED"},403,origin);
    const raw=await req.text();
    if(raw.length>14000) return reply({ok:false,error:"REQUEST_TOO_LARGE"},413,origin);
    let b:any;try{b=JSON.parse(raw)}catch{return reply({ok:false,error:"INVALID_JSON"},400,origin)}
    const op=text(b.op,30).toLowerCase();
    const chat=text(b.chat_key,100);
    if(op==="send"){
      const result=await queue(c,user,text(b.source_chat_key,100),text(b.destination_chat_key,100),text(b.subject,140),text(b.body,2500));
      return reply(result.body,result.status,origin);
    }
    if(op==="inbox"){
      if(!permit(user,chat))return reply({ok:false,error:"CHAT_NOT_AUTHORIZED"},403,origin);
      if(!await endpoint(c,chat))return reply({ok:false,error:"CHAT_NOT_REGISTERED"},404,origin);
      const limit=Math.min(Math.max(Number(b.limit)||25,1),50);
      const {data,error}=await c.from("orchestrator_bus_messages")
        .select("id,external_message_id,source_chat_key,destination_chat_key,message_type,payload,status,correlation_id,created_at,delivered_at,read_at,acknowledged_at")
        .eq("project_key",PROJECT).eq("destination_chat_key",chat)
        .in("status",STATES).order("created_at",{ascending:false}).limit(limit);
      if(error)return reply({ok:false,error:"INBOX_READ_FAILED"},503,origin);
      return reply({ok:true,chat_key:chat,messages:data||[],count:(data||[]).length,
        semantics:"INBOX_READ_IS_NOT_DELIVERY_RECEIPT"},200,origin);
    }
    if(op==="received" || op==="read" || op==="ack"){
      const id=text(b.message_id,100),m=await lookupMessage(c,id);
      if(!m)return reply({ok:false,error:"MESSAGE_NOT_FOUND"},404,origin);
      if(!permit(user,chat) || m.destination_chat_key!==chat)return reply({ok:false,error:"RECIPIENT_NOT_AUTHORIZED"},403,origin);
      const transition=op==="received" ? ["QUEUED","DELIVERED"] : op==="read" ? ["DELIVERED","READ"] : ["READ","ACKNOWLEDGED"];
      if(m.status!==transition[0])return reply({ok:false,error:"INVALID_TRANSITION",current_state:m.status,required_state:transition[0]},409,origin);
      const proof=receipt(op,user.id);
      const changes:any={status:transition[1]};
      if(op==="received"){changes.delivered_at=proof.recorded_at;changes.delivery_evidence=proof}
      if(op==="read")changes.read_at=proof.recorded_at;
      if(op==="ack"){changes.acknowledged_at=proof.recorded_at;changes.ack_evidence={
        ...proof,acknowledgement:text(b.acknowledgement,100)||"RECEIVED",proof_ref:text(b.proof_ref,160)||null
      }}
      const {data,error}=await c.from("orchestrator_bus_messages").update(changes)
        .eq("id",id).eq("project_key",PROJECT).eq("destination_chat_key",chat)
        .eq("status",transition[0]).select("id").maybeSingle();
      if(error)return reply({ok:false,error:"STATE_UPDATE_FAILED"},503,origin);
      if(!data)return reply({ok:false,error:"CONCURRENT_STATE_CHANGE"},409,origin);
      const audited=await addEvent(c,id,transition[1],user.id,{...proof,chat_key:chat,attestation:"RECIPIENT_APP_EXPLICIT_CONFIRMATION_NOT_CHATGPT_UI"});
      if(!audited)return reply({ok:false,error:"AUDIT_EVENT_FAILED",message_id:id,audit_incomplete:true},503,origin);
      return reply({ok:true,message_id:id,state:transition[1],receipt:proof,chatgpt_ui_delivery_verified:false},200,origin);
    }
    if(op==="reply"){
      const parent=await lookupMessage(c,text(b.message_id,100));
      if(!parent)return reply({ok:false,error:"PARENT_MESSAGE_NOT_FOUND"},404,origin);
      if(!permit(user,chat)||parent.destination_chat_key!==chat)return reply({ok:false,error:"REPLY_NOT_AUTHORIZED"},403,origin);
      const result=await queue(c,user,chat,parent.source_chat_key,text(b.subject,140)||"رد على مهمة",text(b.body,2500),parent);
      return reply(result.body,result.status,origin);
    }
    if(op==="status"){
      const m=await lookupMessage(c,text(b.message_id,100));
      if(!m)return reply({ok:false,error:"MESSAGE_NOT_FOUND"},404,origin);
      if(!(permit(user,m.source_chat_key)||permit(user,m.destination_chat_key)))return reply({ok:false,error:"NOT_PARTICIPANT"},403,origin);
      const {data,error}=await c.from("orchestrator_bus_events")
        .select("id,state,actor,evidence,created_at").eq("message_id",m.id).order("created_at",{ascending:true}).limit(100);
      if(error)return reply({ok:false,error:"AUDIT_READ_FAILED"},503,origin);
      const entries=data||[];
      const verified={
        queued:entries.some((e:any)=>e.state==="QUEUED"&&typeof e.actor==="string"&&e.actor.startsWith("auth_user:")&&e.evidence?.attestation==="AUTHENTICATED_API_CLIENT_NOT_CHATGPT_UI"),
        delivered:entries.some((e:any)=>e.state==="DELIVERED"&&typeof e.actor==="string"&&e.actor.startsWith("auth_user:")&&e.evidence?.attestation==="RECIPIENT_APP_EXPLICIT_CONFIRMATION_NOT_CHATGPT_UI"),
        read:entries.some((e:any)=>e.state==="READ"&&typeof e.actor==="string"&&e.actor.startsWith("auth_user:")&&e.evidence?.attestation==="RECIPIENT_APP_EXPLICIT_CONFIRMATION_NOT_CHATGPT_UI"),
        acknowledged:entries.some((e:any)=>e.state==="ACKNOWLEDGED"&&typeof e.actor==="string"&&e.actor.startsWith("auth_user:")&&e.evidence?.attestation==="RECIPIENT_APP_EXPLICIT_CONFIRMATION_NOT_CHATGPT_UI")
      };
      const {data:linkedReplies,error:re}=await c.from("orchestrator_bus_messages")
        .select("id,external_message_id,source_chat_key,destination_chat_key,status,created_at,payload")
        .eq("project_key",PROJECT).contains("payload",{reply_to:m.id}).limit(50);
      if(re)return reply({ok:false,error:"REPLY_AUDIT_READ_FAILED"},503,origin);
      return reply({ok:true,message:m,events:entries,verified_api_receipts:verified,linked_replies:linkedReplies||[],
        distinction:"Canonical status may include legacy events; only verified_api_receipts are authenticated client acknowledgements. ChatGPT UI delivery unverified"},200,origin);
    }
    return reply({ok:false,error:"UNKNOWN_OPERATION",ops:["send","inbox","received","read","ack","reply","status"]},400,origin);
  } catch {return reply({ok:false,error:"INTERNAL_ERROR"},503,origin)}
});

export const BRIDGE_CHANNEL='aas-cc-owner-bridge-v1';
export const PRIVATE_ORIGIN='https://amer-ai-command-center.eagerlark64.chatgpt.site';
export const APPROVED_ORIGIN='https://amer-ai-store.github.io';
export const MAX_BRIDGE_BYTES=2*1024*1024;
const methods=new Set(['GET','HEAD','POST','PATCH','DELETE']);
const requestHeaders=new Set(['accept','content-type','if-match','if-none-match']);
export function validateBridgeRequest(value){
  if(!value||typeof value!=='object'||!/^[-a-f0-9]{36}$/i.test(value.id||'')||!methods.has(value.method))return null;
  if(typeof value.path!=='string'||value.path.length>2048||!value.path.startsWith('/api/v1/')||/[\\#\r\n]/.test(value.path))return null;
  const url=new URL(value.path,'https://aas.invalid');
  if(url.origin!=='https://aas.invalid'||!url.pathname.startsWith('/api/v1/'))return null;
  const headers={};
  if(!Array.isArray(value.headers)||value.headers.length>8)return null;
  for(const entry of value.headers){if(!Array.isArray(entry)||entry.length!==2||!requestHeaders.has(entry[0])||typeof entry[1]!=='string'||entry[1].length>1000||/[\r\n]/.test(entry[1]))return null;headers[entry[0]]=entry[1];}
  if(value.body!=null&&(typeof value.body!=='string'||new TextEncoder().encode(value.body).length>MAX_BRIDGE_BYTES||['GET','HEAD'].includes(value.method)))return null;
  return {id:value.id,path:url.pathname+url.search,method:value.method,headers,body:value.body??undefined};
}
export async function boundedBridgeText(response){
  if(Number(response.headers.get('content-length'))>MAX_BRIDGE_BYTES){response.body?.cancel().catch(()=>{});throw Error('bridge_response_limit');}
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BRIDGE_BYTES){await reader.cancel();throw Error('bridge_response_limit');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

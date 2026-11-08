// Pure validation/authentication helpers shared by the Edge service and tests.
export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
export const ALLOWED_ORIGIN='https://amer-ai-store.github.io';
export const FIREBASE_PROJECT='ameraistore-1c81d';
export const OWNER_EMAIL='zxzx.mohammad91@gmail.com';
export const SOURCE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
export const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const generateToken=()=> 'aman_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export function bearer(req){const value=req.headers.get('authorization')||'';const match=/^Bearer ([A-Za-z0-9._~-]{32,4096})$/i.exec(value);if(!match)throw new ApiError(401,'Unauthorized');return match[1];}
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function verifyOwner(token,fetchKeys,now=Date.now()){
  try{
    const parts=token.split('.');if(parts.length!==3||token.length>4096)throw 0;
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds=Math.floor(now/1000);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.aud!==FIREBASE_PROJECT||claims.iss!=='https://securetoken.google.com/'+FIREBASE_PROJECT||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||claims.email!==OWNER_EMAIL||claims.email_verified!==true||!Number.isInteger(claims.exp)||claims.exp<=seconds||!Number.isInteger(claims.iat)||claims.iat>seconds+30||!Number.isInteger(claims.auth_time)||claims.auth_time>seconds+30)throw 0;
    const jwks=await fetchKeys();const key=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!key)throw 0;
    const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw 0;
    return claims.sub;
  }catch{throw new ApiError(401,'Owner authentication required');}
}
export async function limitedJson(req,max=256*1024){
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type')||''))throw new ApiError(415,'Use application/json');
  if(Number(req.headers.get('content-length')||0)>max)throw new ApiError(413,'Payload too large');
  const reader=req.body?.getReader();if(!reader)throw new ApiError(400,'JSON body required');let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new ApiError(413,'Payload too large');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(400,'Invalid JSON');}
}
export function publicIpv4(value){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value))return false;
  const p=value.split('.').map(Number);if(p.some(n=>n>255))return false;
  const [a,b,c]=p;
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&[0,2].includes(c))||(b===88&&c===99)))||(a===198&&([18,19].includes(b)||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}

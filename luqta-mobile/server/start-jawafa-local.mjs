/** Private local Luqta server on JAWAFFASVR, without exposing Jawafa_DB. */
import { createCommerceServer } from './commerce.mjs';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
if (!process.env.LOCALAPPDATA) throw new Error('A private Windows profile is required');
const data=resolve(process.env.LOCALAPPDATA,'JawafaLuqtaCommerce');
mkdirSync(data,{recursive:true,mode:0o700});
const bootstrap=join(data,'owner-bootstrap.json');
if (!existsSync(bootstrap)) {
  const owner={name:'Luqta Owner',email:'owner@luqta.local',password:randomBytes(40).toString('base64url')};
  writeFileSync(bootstrap,JSON.stringify(owner),{flag:'wx',mode:0o600});
}
const owner=JSON.parse(readFileSync(bootstrap,'utf8'));
process.env.NODE_ENV='production';
process.env.CORS_ORIGINS='https://amer-ai-store.github.io';
const app=await createCommerceServer({
  dbPath:join(data,'commerce.sqlite'),
  bootstrapAdmin:owner,
  jawafaBridgeUrl:'http://127.0.0.1:3456',
  seedDemoProducts:false
});
const port=8790;
app.server.listen(port,'127.0.0.1',()=>console.log('Luqta local commerce API ready on localhost:'+port));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0)});

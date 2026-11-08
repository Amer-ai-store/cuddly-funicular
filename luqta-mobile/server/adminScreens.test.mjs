import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceServer } from './commerce.mjs';

test('all central dashboard and mobile admin read screens resolve with owner authorization',async t=>{
 const fetchImpl=async url=>{
   const body=String(url).endsWith('/health')?{ok:true,mode:'FORENSIC-READ-ONLY',database:'Jawafa_DB'}:
    String(url).endsWith('/tables')?{ok:true,tables:[{TABLE_NAME:'Items'}]}:{ok:true,data:[]};
   return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const app=await createCommerceServer({dbPath:':memory:',seedDemoProducts:false,
   bootstrapAdmin:{name:'Test Owner',email:'screens@example.test',password:'screens-password-123'},
   jawafaFetchImpl:fetchImpl});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.server.address().port+'/api';
 const login=await fetch(url+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'screens@example.test',password:'screens-password-123'})});
 assert.equal(login.status,200);
 const token=(await login.json()).token;
 const paths=['overview','products','inventory/undo','inventory/connector','jawafa/source',
   'jawafa/catalog-preview','offers','orders','users','coupons','returns','tickets','settings',
   'agent-keys','agent-jobs','audit'];
 for(const path of paths){
   const response=await fetch(url+'/admin/'+path,{headers:{Authorization:'Bearer '+token}});
   const result=await response.json();
   assert.equal(response.status,200,path+': '+JSON.stringify(result).slice(0,260));
   assert.equal((await fetch(url+'/admin/'+path)).status,401,'must restrict '+path);
 }
});

import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';
const root=resolve(import.meta.dirname,'..');
const kit={};
async function collectKit(dir,prefix='') {
  for(const item of await readdir(dir,{withFileTypes:true})){
    if(item.name.startsWith('.')||item.name.includes('.test.')||item.name==='node_modules')continue;
    const path=resolve(dir,item.name),name=prefix+item.name;
    if(item.isDirectory())await collectKit(path,name+'/');
    else if(/\.(?:mjs|js|json|ya?ml|md|service|sh|example)$/.test(item.name))kit['aas-execution-kit/'+name]=new Uint8Array(await readFile(path));
  }
}
try {
  await collectKit(resolve(root,'integrations/runner'));
  kit['aas-execution-kit/SETUP.md']=new Uint8Array(await readFile(resolve(root,'docs/runner-setup.md')));
  await mkdir(resolve(root,'dist/downloads'),{recursive:true});
  await writeFile(resolve(root,'dist/downloads/aas-execution-kit.zip'),zipSync(kit,{level:6}));
} catch(error) { if(error.code!=='ENOENT')throw error; }
try {
  const databaseKit={};
  for(const name of ['bridge.mjs','sqlite.example.json','inventory.example.json'])databaseKit['aas-database-bridge/integrations/database-bridge/'+name]=new Uint8Array(await readFile(resolve(root,'integrations/database-bridge',name)));
  databaseKit['aas-database-bridge/integrations/runner/runner.mjs']=new Uint8Array(await readFile(resolve(root,'integrations/runner/runner.mjs')));
  databaseKit['aas-database-bridge/SETUP.md']=new Uint8Array(await readFile(resolve(root,'docs/database-bridge.md')));
  await mkdir(resolve(root,'dist/downloads'),{recursive:true});
  await writeFile(resolve(root,'dist/downloads/aas-database-bridge.zip'),zipSync(databaseKit,{level:6}));
} catch(error) { if(error.code!=='ENOENT')throw error; }
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const assets={};
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
const sourceRevision=revision+(dirty?'-dirty':'');
async function collect(dir, prefix='') {
  for(const item of await readdir(dir,{withFileTypes:true})){
    if(item.name==='server'||item.name==='.openai'||item.name==='store.js')continue;
    const name=prefix+'/'+item.name,path=resolve(dir,item.name);
    if(item.isDirectory())await collect(path,name);
    else assets[name]={type:mime[extname(item.name)]||'application/octet-stream',body:(await readFile(path)).toString('base64')};
  }
}
await collect(resolve(root,'dist'));
assets['/build-info.json']={type:'application/json; charset=utf-8',body:Buffer.from(JSON.stringify({sourceRevision,features:['theme','workflow-gates','pinned-source-analysis','runner-receipts','coordination','assistant','database-bridge']})).toString('base64')};
await writeFile(resolve(root,'server/assets.generated.mjs'),'export default '+JSON.stringify(assets)+';\n');
await mkdir(resolve(root,'dist/server'),{recursive:true});
await mkdir(resolve(root,'dist/.openai'),{recursive:true});
await build({entryPoints:[resolve(root,'server/worker.mjs')],outfile:resolve(root,'dist/server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false,define:{__AAS_SOURCE_REVISION__:JSON.stringify(sourceRevision)}});
await cp(resolve(root,'.openai/hosting.json'),resolve(root,'dist/.openai/hosting.json'));
await cp(resolve(root,'drizzle'),resolve(root,'dist/.openai/drizzle'),{recursive:true});
const source=await readFile(resolve(root,'dist/server/index.js'),'utf8');
const worker=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
if(typeof worker.default?.fetch!=='function')throw Error('Invalid Worker artifact');
console.log('Built and validated Sites Worker ESM + D1 migrations');

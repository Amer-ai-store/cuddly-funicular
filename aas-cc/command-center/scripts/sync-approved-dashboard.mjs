/** Copy the entire source and public client to the explicitly selected canonical repository. */
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),target=process.argv[2];
if(!target?.startsWith('/'))throw Error('Pass the absolute approved repository checkout.');
const remote=execFileSync('git',['remote','get-url','origin'],{cwd:target,encoding:'utf8'}).trim();
if(remote.toLowerCase()!=='https://github.com/amer-ai-store/mohammad-ahmed-ghannam.git')throw Error('Unexpected destination repository.');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const sourceDir=resolve(target,'aas-cc/command-center');
for(const name of files){if(name==='.env'||name.includes('node_modules/')||name.includes('.aas-local/'))throw Error('Private runtime path in source selection');const output=resolve(sourceDir,name);await mkdir(dirname(output),{recursive:true});await copyFile(resolve(root,name),output);}
const publicDir=resolve(target,'dashboard/aas'),manifest=[];
async function copyPublic(dir,prefix=''){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(['server','.openai','store.js','host-bridge.html','host-bridge.js'].includes(entry.name))continue;
  const name=prefix+entry.name,input=resolve(dir,entry.name),output=resolve(publicDir,name);
  if(entry.isDirectory()){await mkdir(output,{recursive:true});await copyPublic(input,name+'/');continue;}
  let bytes=await readFile(input);if(name==='index.html')bytes=Buffer.from(bytes.toString().replace('<html lang="ar" dir="rtl">','<html lang="ar" dir="rtl" data-aas-host="approved">'));
  await mkdir(dirname(output),{recursive:true});await writeFile(output,bytes);manifest.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
}
await mkdir(publicDir,{recursive:true});await copyPublic(resolve(root,'dist'));
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const routes=['overview','orchestration','advisor','database','execution','workspaces','tasks','agents','approvals','activity','commerce','repository','integrations','settings'];
const release={format:'aas-cc-integrated-client-v1',sourceRevision,privateBackend:'https://amer-ai-command-center.eagerlark64.chatgpt.site',apiTransport:'owner-session-popup',sharedStorage:'existing-private-D1',routes,files:manifest.sort((a,b)=>a.path.localeCompare(b.path)),productionDataCopied:false,credentialsCopied:false};
await writeFile(resolve(publicDir,'integration-manifest.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:files.length,publicFiles:manifest.length,routes:routes.length,sourceRevision}));

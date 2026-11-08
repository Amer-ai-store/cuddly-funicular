/** Deterministic, read-only audit of the fixed repository at an observed Git SHA.
 * Downloaded code is never executed, extracted to disk, or returned as snippets.
 * A completed result covers every eligible text file in the bounded archive;
 * it is not a compiler, a complete security assessment, or an execution adapter.
 */
import { Unzip, UnzipInflate } from 'fflate';
import { REPOSITORY } from './github-cache.mjs';

const LIMITS = Object.freeze({ compressed: 5 * 1024 * 1024, decoded: 12 * 1024 * 1024, file: 1024 * 1024, entries: 512, timeout: 20000 });
const TEXT_EXTENSIONS = new Set(['kt','kts','java','xml','toml','properties','gradle','js','mjs','cjs','ts','tsx','jsx','json','yml','yaml','md','html','css','sql','sh','txt','pro']);
const EXCLUDED_DIRECTORIES = new Set(['.git','node_modules','vendor','build','.gradle','dist','assets','screenshots','screenshots-baseline']);
const LOCK_FILES = new Set(['package-lock.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb','gradle.lockfile']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export class SourceAnalysisError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const invalidArchive = () => new SourceAnalysisError(502,'source_archive_invalid','تعذّر التحقق من اكتمال أرشيف المصدر أو سلامة ملفاته. لم يُسجّل تحليل مكتمل.');
const evidenceError = () => new SourceAnalysisError(413,'source_evidence_limit','يتجاوز تقرير التحليل حدود الأدلة المحفوظة. لم يُسجّل تحليل مكتمل.');
const limitError = () => new SourceAnalysisError(413,'source_analysis_limit','يتجاوز أرشيف المصدر حدود التحليل: 5 MiB مضغوط، 12 MiB مفكوك، 512 مدخلًا، و1 MiB لكل ملف نصي.');
const unavailable = () => new SourceAnalysisError(502,'source_unavailable','تعذّر تنزيل أرشيف المصدر المحدد من GitHub. لم يُسجّل تحليل مكتمل.');
const timeoutError = () => new SourceAnalysisError(504,'source_analysis_timeout','انتهت مهلة تنزيل المصدر وتحليله. أعد المحاولة؛ لم يُسجّل تحليل مكتمل.');
const hexDigest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
const sourceUrl = (sha,path='') => 'https://github.com/'+REPOSITORY+(path?'/blob/':'/tree/')+sha+(path?'/'+path.split('/').map(encodeURIComponent).join('/'): '');
function pathKind(path) {
  const parts=path.split('/');
  if(parts.some(part=>EXCLUDED_DIRECTORIES.has(part)) || path.includes('/test/screenshots/'))return {eligible:false,reason:'assets_or_generated'};
  const name=parts.at(-1);
  if(LOCK_FILES.has(name))return {eligible:false,reason:'lock_file'};
  if((/^\.env(?:\.|$)/.test(name)&&name!=='.env.example') || /\.(?:jks|keystore|pem|key|p12)$/i.test(name))return {eligible:false,reason:'credential_file'};
  const extension=name.includes('.')?name.split('.').at(-1).toLowerCase():'';
  return TEXT_EXTENSIONS.has(extension)||['.env.example','.gitignore','Dockerfile','Makefile','gradlew'].includes(name)
    ?{eligible:true,language:extension||'text'}:{eligible:false,reason:'binary_or_unsupported'};
}
function archiveEntries(bytes,prefix) {
  if(bytes.length<22)throw invalidArchive();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  }
  if(end<0 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0)throw invalidArchive();
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(count>LIMITS.entries)throw limitError();
  if(!count || count!==view.getUint16(end+8,true) || offset+size!==end)throw invalidArchive();
  const entries=new Map();let cursor=offset,totalDecoded=0;const ranges=[];
  for(let n=0;n<count;n++){
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50)throw invalidArchive();
    const flags=view.getUint16(cursor+8,true),compression=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true);
    const compressed=view.getUint32(cursor+20,true),decoded=view.getUint32(cursor+24,true),nameSize=view.getUint16(cursor+28,true),extraSize=view.getUint16(cursor+30,true),commentSize=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
    if(flags&1 || ![0,8].includes(compression) || view.getUint16(cursor+34,true)!==0 || cursor+46+nameSize+extraSize+commentSize>end)throw invalidArchive();
    let name;
    try{name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameSize));}catch{throw invalidArchive();}
    if(!name.startsWith(prefix) || name.length>500 || /[\x00-\x1f\x7f\\]/.test(name) || entries.has(name))throw invalidArchive();
    const path=name.slice(prefix.length),directory=name.endsWith('/');
    if(path.split('/').some(part=>part==='.'||part==='..') || path.startsWith('/') || (!path&&!directory))throw invalidArchive();
    const kind=directory?{eligible:false,reason:'directory'}:pathKind(path);
    totalDecoded+=decoded;
    if(totalDecoded>LIMITS.decoded || (kind.eligible&&decoded>LIMITS.file))throw limitError();
    if(local+30>offset || view.getUint32(local,true)!==0x04034b50 || view.getUint16(local+6,true)!==flags || view.getUint16(local+8,true)!==compression)throw invalidArchive();
    const localNameSize=view.getUint16(local+26,true),localExtraSize=view.getUint16(local+28,true),dataStart=local+30+localNameSize+localExtraSize;
    if(dataStart+compressed>offset)throw invalidArchive();
    let localName;try{localName=decoder.decode(bytes.subarray(local+30,local+30+localNameSize));}catch{throw invalidArchive();}
    if(localName!==name)throw invalidArchive();
    ranges.push([local,dataStart+compressed]);
    entries.set(name,{name,path,directory,compressed,decoded,compression,crc,...kind});
    cursor+=46+nameSize+extraSize+commentSize;
  }
  if(cursor!==end)throw invalidArchive();
  ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw invalidArchive();
  return {entries,totalDecoded};
}
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function decodeArchive(bytes,prefix,signal) {
  const {entries,totalDecoded}=archiveEntries(bytes,prefix);const seen=new Set(),files=[];let inflated=0;
  const unzip=new Unzip(file=>{
    const metadata=entries.get(file.name);
    if(!metadata || seen.has(file.name) || file.compression!==metadata.compression)throw invalidArchive();
    seen.add(file.name);
    if(!metadata.eligible)return;
    const record={...metadata,chunks:[],bytes:0,complete:false};files.push(record);
    file.ondata=(error,chunk,final)=>{
      if(error)throw invalidArchive();
      if(signal.aborted)throw timeoutError();
      record.bytes+=chunk.byteLength;inflated+=chunk.byteLength;
      if(record.bytes>LIMITS.file || inflated>LIMITS.decoded)throw limitError();
      if(record.bytes>metadata.decoded)throw invalidArchive();
      record.chunks.push(chunk);if(final)record.complete=true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed pushes bound the output allocated by a single inflate call.
  for(let i=0;i<bytes.length;i+=1024){if(signal.aborted)throw timeoutError();unzip.push(bytes.subarray(i,i+1024),i+1024>=bytes.length);}
  if(seen.size!==entries.size || !files.length)throw invalidArchive();
  for(const file of files){
    if(!file.complete || file.bytes!==file.decoded)throw invalidArchive();
    const data=new Uint8Array(file.bytes);let offset=0;for(const chunk of file.chunks){data.set(chunk,offset);offset+=chunk.length;}
    if(crc32(data)!==file.crc)throw invalidArchive();
    try{file.text=decoder.decode(data);}catch{throw invalidArchive();}
    if(file.text.includes('\u0000'))throw invalidArchive();
    file.data=data;delete file.chunks;
  }
  return {files,entries:[...entries.values()],totalDecoded,inflated};
}
function codeViews(text) {
  const comments=[],strings=[];let state='code',start=0,depth=0;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(state==='line'){if(ch==='\n'){comments.push([start,i]);state='code';}continue;}
    if(state==='block'){
      if(ch==='/'&&next==='*'){depth++;i++;}
      else if(ch==='*'&&next==='/'){i++;if(--depth===0){comments.push([start,i+1]);state='code';}}
      continue;
    }
    if(state==='triple'){if(text.slice(i,i+3)==='"""'){i+=2;strings.push([start,i+1]);state='code';}continue;}
    if(state==='double'||state==='single'){
      if(ch==='\\'&&next)i++;
      else if(ch===(state==='double'?'"':"'")){strings.push([start,i+1]);state='code';}
      continue;
    }
    if(ch==='/'&&next==='/'){start=i;i++;state='line';}
    else if(ch==='/'&&next==='*'){start=i;i++;depth=1;state='block';}
    else if(text.slice(i,i+3)==='"""'){start=i;i+=2;state='triple';}
    else if(ch==='"'||ch==="'"){start=i;state=ch==='"'?'double':'single';}
  }
  if(state==='line'||state==='block')comments.push([start,text.length]);
  else if(state!=='code')strings.push([start,text.length]);
  const mask=(ranges)=>{
    const parts=[];let position=0;
    for(const [from,to] of ranges.sort((a,b)=>a[0]-b[0])){parts.push(text.slice(position,from),text.slice(from,to).replace(/[^\n]/g,' '));position=to;}
    parts.push(text.slice(position));return parts.join('');
  };
  return {withStrings:mask([...comments]),code:mask([...comments,...strings])};
}
function analyze(files,sha) {
  const findings=[];const checks=[];
  const add=(id,severity,title,detail,recommendation,file,index=0)=>{
    const line=file.text.slice(0,index).split('\n').length;
    findings.push({id,severity,title,detail,recommendation,evidence:[{path:file.path,line,url:sourceUrl(sha,file.path)+'#L'+line}]});
  };
  for(const file of files){
    if(/\.(?:kt|kts|java|gradle)$/.test(file.path)){
      const {code,withStrings}=codeViews(file.text);
      const mock=code.match(/return(?:@\w+)?\s+getOfflineMock(?:Image)?Response\s*\(/);
      if(mock)add('ai-mock-fallback','high','إجابات تجريبية عند تعذر الذكاء الاصطناعي','يحتوي المصدر على مسار يعيد استجابة تجريبية بدل نتيجة مزود فعلية.','افصل وضع العرض عن التشغيل الفعلي، وأظهر فشل المزود بوضوح.',file,mock.index);
      const key=code.match(/BuildConfig\s*\.\s*(?:GEMINI|OPENAI|ANTHROPIC)_API_KEY\b/);
      if(key)add('client-provider-key','high','مرجع مفتاح مزود داخل تطبيق العميل','يقرأ كود العميل مفتاح مزود من BuildConfig؛ لم يُفحص أو يُعرض أي مفتاح فعلي.','انقل مصادقة المزود إلى الخادم، واجعل التطبيق يتصل بخدمة محدودة الصلاحيات.',file,key.index);
      const query=withStrings.match(/generateContent\?key=|[?&](?:api[_-]?key|key)=\$\{?apiKey\b/);
      if(query)add('provider-key-query','medium','مفتاح المزود ضمن عنوان الطلب','يبني المصدر عنوان طلب يضع متغير المفتاح ضمن query string.','استخدم وسيط الخادم ورأس مصادقة؛ لا تضمّن المفتاح في عنوان URL.',file,query.index);
      const release=code.match(/\brelease\s*\{[^}]*\bisMinifyEnabled\s*=\s*false/s);
      if(release)add('release-minification-off','info','تقليص كود إصدار release معطل','يصرح إعداد release بتعطيل isMinifyEnabled؛ هذه ملاحظة إعداد وليست دليل اختراق.','راجع قرار التحسين والتشويش، واختبر نسخة release قبل تغيير الإعداد.',file,release.index);
    }
    if(file.path.endsWith('AndroidManifest.xml')){
      const xml=file.text.replace(/<!--[\s\S]*?-->/g,match=>match.replace(/[^\n]/g,' '));
      const permission=xml.match(/<uses-permission\b[^>]*android:name\s*=\s*["']android\.permission\.(?:READ_CONTACTS|CALL_PHONE|QUERY_ALL_PACKAGES|SYSTEM_ALERT_WINDOW)["']/);
      if(permission)add('sensitive-android-permissions','medium','صلاحيات Android تحتاج مراجعة الغرض','يعلن Manifest صلاحية حساسة من مجموعة جهات الاتصال أو الاتصال أو التطبيقات أو النوافذ العائمة.','راجع الحاجة لكل صلاحية وتجربة طلبها في وقت التشغيل؛ لا يثبت هذا الفحص استخدامها الفعلي.',file,permission.index);
      if(/android:usesCleartextTraffic\s*=\s*["']true["']/.test(xml))add('cleartext-traffic-enabled','medium','السماح باتصالات غير مشفرة معلن','يصرح Manifest بالسماح بمرور cleartext.','قيد الاتصال بـHTTPS وراجع أي استثناء مطلوب حسب النطاق.',file,xml.search(/android:usesCleartextTraffic/));
    }
  }
  checks.push({id:'source-integrity',status:'passed',detail:'قُرئ كل ملف نصي مؤهل في الأرشيف، وتحقق الحجم وCRC32 وسُجل SHA-256.'});
  checks.push({id:'static-rules',status:'completed',detail:'قواعد نصية محددة لإعدادات Android ومصادقة المزود والبدائل التجريبية؛ لا تشمل بناء التطبيق أو تشغيله.'});
  return {checks,findings};
}
async function readArchive(response,signal) {
  if(response.status!==200 || !/^(?:application\/zip|application\/x-zip-compressed|application\/octet-stream)(?:;|$)/i.test(response.headers.get('Content-Type')||'')){response.body?.cancel().catch(()=>{});throw unavailable();}
  if(Number(response.headers.get('Content-Length'))>LIMITS.compressed){response.body?.cancel().catch(()=>{});throw limitError();}
  const reader=response.body?.getReader();if(!reader)throw unavailable();
  const chunks=[];let size=0;const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){if(signal.aborted)throw timeoutError();const {value,done}=await reader.read();if(signal.aborted)throw timeoutError();if(done)break;size+=value.length;if(size>LIMITS.compressed){cancel();throw limitError();}chunks.push(value);}}
  finally{signal.removeEventListener('abort',cancel);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

export async function analyzeRepositorySource({sourceRevision,fetchImpl=fetch,now}={}) {
  if(typeof sourceRevision!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceRevision))throw new SourceAnalysisError(422,'source_revision_invalid','يلزم SHA كامل من مراجعة GitHub التي تحقق منها الخادم.');
  const sha=sourceRevision.toLowerCase(),checkedAt=new Date(typeof now==='function'?now():now??Date.now());
  if(!Number.isFinite(checkedAt.getTime()))throw new SourceAnalysisError(422,'source_time_invalid','توقيت التحليل غير صالح.');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timeoutError());},LIMITS.timeout);});
  try{
    const operation=(async()=>{
      const response=await fetchImpl('https://codeload.github.com/'+REPOSITORY+'/zip/'+sha,{method:'GET',redirect:'manual',headers:{Accept:'application/zip','User-Agent':'AAS-CC-Source-Audit'},signal:controller.signal});
      const archive=await readArchive(response,controller.signal);
      const decoded=decodeArchive(archive,REPOSITORY.split('/')[1]+'-'+sha+'/',controller.signal);
      const files=await Promise.all(decoded.files.sort((a,b)=>a.path.localeCompare(b.path,'en')).map(async file=>({...file,sha256:await hexDigest(file.data)})));
      const {checks,findings}=analyze(files,sha),archiveSha256=await hexDigest(archive);
      const manifest=files.map(file=>file.sha256+'  '+file.path).join('\n');const manifestSha256=await hexDigest(encoder.encode(manifest));
      const report={analyzerVersion:'android-static-v1',repository:REPOSITORY,sourceRevision:sha,source:'github-archive',checkedAt:checkedAt.toISOString(),execution:false,modification:false,
        scope:'كل ملفات النص البرمجي والإعدادات والتوثيق ذات الامتدادات المعروفة داخل الأرشيف، باستثناء الأصول والملفات المولدة وملفات القفل والاعتمادات والأسرار. قواعد النتائج مخصصة لأنماط Android المحددة ولا تعادل مراجعة أمنية شاملة.',
        coverage:{complete:true,archiveEntries:decoded.entries.length,analyzedFiles:files.length,excludedFiles:decoded.entries.filter(file=>!file.directory&&!file.eligible).length,compressedBytes:archive.length,declaredDecodedBytes:decoded.totalDecoded,analyzedBytes:decoded.inflated},
        archiveSha256,manifestSha256,files:files.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256,language:file.language,url:sourceUrl(sha,file.path)})),excluded:decoded.entries.filter(file=>!file.directory&&!file.eligible).map(file=>({path:file.path,reason:file.reason})),checks,findings};
      const compact={analyzerVersion:report.analyzerVersion,repository:REPOSITORY,sourceRevision:sha,checkedAt:report.checkedAt,scope:report.scope,coverage:report.coverage,archiveSha256,manifestSha256,checks,findings};
      const reportContent=JSON.stringify(compact);if(reportContent.length>8000)throw evidenceError();
      const evidence=[{kind:'report',label:'نتائج التحليل الآلي الثابت',content:reportContent,sha256:await hexDigest(encoder.encode(reportContent))}];
      const lines=manifest.split('\n');let chunk='';
      const saveChunk=async()=>{if(!chunk)return;evidence.push({kind:'file',label:'بصمات ملفات المصدر '+evidence.length,content:chunk,sha256:await hexDigest(encoder.encode(chunk))});chunk='';};
      for(const line of lines){if(chunk.length+line.length+1>7800)await saveChunk();chunk+=(chunk?'\n':'')+line;}await saveChunk();
      evidence.push({kind:'url',label:'شجرة المصدر عند المراجعة المفحوصة',url:sourceUrl(sha)});
      if(evidence.length>10)throw evidenceError();
      return {sourceRevision:sha,outcome:'passed',summary:'اكتمل التحليل الثابت لـ '+files.length+' ملفًا نصيًا عند '+sha.slice(0,12)+'، وظهرت '+findings.length+' ملاحظات مرتبطة بأسطر المصدر. لم يُشغّل الكود ولم يُعدّل.',evidence,report};
    })();
    return await Promise.race([operation,deadline]);
  }catch(error){if(error instanceof SourceAnalysisError)throw error;if(controller.signal.aborted||error?.name==='AbortError')throw timeoutError();throw invalidArchive();}
  finally{clearTimeout(timer);}
}

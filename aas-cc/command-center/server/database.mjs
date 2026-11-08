import {ControlRepository,controlError,controlId} from './control.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,label,max=160)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw controlError(422,'invalid_database_input',label+' غير صالح.');return value.trim();};
const list=(value,max)=>{if(!Array.isArray(value)||value.length>max)throw controlError(422,'database_limit','قائمة قاعدة البيانات تتجاوز الحدود.');return value;};
const number=(value,max=100001)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw controlError(422,'invalid_database_input','قيمة قاعدة البيانات غير صالحة.');return value;};
const safeColumn=name=>!/(password|passwd|token|secret|credit|card|cvv|email|phone|address|customer|api.?key|credential|session)/i.test(name);
const safeTable=name=>!/(customer|user|auth|session|credential|secret|token|payment|card)/i.test(name);
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'):JSON.stringify(value);
const operationShape=op=>({action:op.action,table:op.table,...(op.values?{values:op.values}:{}),...(op.key?{key:op.key}:{})});
const date=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw controlError(422,'invalid_database_input','وقت الرصد غير صالح.');return new Date(value).toISOString();};
function values(input,columns){
  if(!object(input)||Object.keys(input).length>50)throw controlError(422,'invalid_database_values','حقول التغيير غير صالحة.');
  const result={};
  for(const [key,value]of Object.entries(input)){
    if(!columns.includes(key)||!safeColumn(key)||['__proto__','constructor','prototype'].includes(key))throw controlError(422,'database_column_denied','العمود غير مسموح في هذه العملية.');
    if(value!==null&&!(typeof value==='string'&&value.length<=4000)&&!(typeof value==='number'&&Number.isFinite(value))&&typeof value!=='boolean')throw controlError(422,'invalid_database_values','استخدم قيمًا نصية أو رقمية محدودة فقط.');
    Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});
  }
  return result;
}
export function normalizeDatabaseSnapshot(input){
  if(!object(input)||input.adapter!=='sqlite')throw controlError(422,'database_adapter','المحوّل المهيأ حاليًا هو SQLite.');
  const schema=list(input.schema,100).map(table=>{
    if(!object(table))throw controlError(422,'invalid_database_schema','مخطط الجدول غير صالح.');
    const columns=list(table.columns,100).map(column=>({name:string(column.name,'اسم العمود'),type:string(column.type||'ANY','نوع العمود'),primaryKey:typeof column.primaryKey==='boolean'?Number(column.primaryKey):number(column.primaryKey||0,1000),nullable:Boolean(column.nullable)}));
    if(new Set(columns.map(c=>c.name)).size!==columns.length)throw controlError(422,'invalid_database_schema','أعمدة مكررة.');
    return {name:string(table.name,'اسم الجدول'),type:string(table.type||'table','نوع الجدول'),columns,rowCount:number(table.rowCount),rowCountCapped:Boolean(table.rowCountCapped)};
  });
  if(new Set(schema.map(t=>t.name)).size!==schema.length)throw controlError(422,'invalid_database_schema','جداول مكررة.');
  let totalRows=0;
  const tables=list(input.tables||[],20).map(table=>{
    const definition=schema.find(t=>t.name===table.name);if(!definition||!safeTable(table.name))throw controlError(422,'invalid_database_schema','عينة من جدول غير مسموح.');
    const columns=list(table.columns,50).map(name=>string(name,'اسم العمود'));
    if(columns.some(name=>!safeColumn(name)||!definition.columns.some(c=>c.name===name)))throw controlError(422,'database_sensitive_columns','لا تُرسل حقول بيانات الدخول أو الاتصال أو الدفع ضمن عينات الجداول.');
    const rows=list(table.rows,100).map(row=>values(row,columns));totalRows+=rows.length;
    if(totalRows>500)throw controlError(413,'database_limit','عدد صفوف العينة يتجاوز الحد.');
    return {name:definition.name,columns,rows,truncated:Boolean(table.truncated)};
  });
  const writableTables=list(input.writableTables||[],20).map(table=>{
    const definition=schema.find(t=>t.name===table.name);if(!definition||!safeTable(table.name))throw controlError(422,'invalid_database_schema','إذن كتابة لجدول غير مسموح.');
    const columns=list(table.columns,50).map(name=>string(name,'اسم العمود'));
    const primaryKey=list(table.primaryKey,8).map(name=>string(name,'المفتاح'));
    if(!columns.length||!primaryKey.length||[...columns,...primaryKey].some(name=>!safeColumn(name)||!definition.columns.some(c=>c.name===name)))throw controlError(422,'invalid_database_schema','صلاحيات الكتابة المحلية غير صالحة.');
    const actualKeys=definition.columns.filter(column=>column.primaryKey>0).sort((a,b)=>a.primaryKey-b.primaryKey).map(column=>column.name);
    if(new Set(columns).size!==columns.length||new Set(primaryKey).size!==primaryKey.length||canonical(primaryKey)!==canonical(actualKeys))throw controlError(422,'invalid_database_schema','مفتاح الكتابة لا يطابق مخطط الجدول.');
    return {name:definition.name,columns,primaryKey};
  });
  if(new Set(writableTables.map(table=>table.name)).size!==writableTables.length)throw controlError(422,'invalid_database_schema','صلاحيات جدول مكررة.');
  const result={adapter:'sqlite',observedAt:date(input.observedAt),schema,tables,writableTables};
  if(new TextEncoder().encode(JSON.stringify(result)).length>220000)throw controlError(413,'database_limit','لقطة قاعدة البيانات أكبر من الحد المسموح.');
  return result;
}
const initial=()=>({bridges:[]});
const find=(data,id)=>data.bridges.find(item=>item.id===controlId(id))||(()=>{throw controlError(404,'database_bridge_missing','وصلة قاعدة البيانات غير موجودة.');})();
export class DatabaseControl {
  constructor(db){this.records=new ControlRepository(db);}
  async read(){const r=await this.records.load('database',initial());return {revision:r.revision,bridges:r.data.bridges.map(bridge=>({...bridge,status:bridge.lastSeenAt?(Date.now()-Date.parse(bridge.lastSeenAt)<90000?'online':'stale'):'waiting'})),capabilities:{adapter:'sqlite',transport:'outbound',arbitrarySql:false}};}
  async create(input){
    const name=string(input.name,'اسم الوصلة');const id='bridge-'+crypto.randomUUID();
    await this.records.update('database',initial(),data=>{if(data.bridges.length>=10)throw controlError(422,'database_limit','وصلت إلى الحد الأقصى للوصلات.');data.bridges.push({id,name,adapter:'sqlite',enabled:true,status:'waiting',createdAt:new Date().toISOString(),lastSeenAt:null,snapshot:null,operations:[]});return data;});return this.read();
  }
  async context(id){const r=await this.records.load('database',initial()),bridge=find(r.data,id);return {revision:r.revision,bridge:{id:bridge.id,enabled:bridge.enabled,adapter:bridge.adapter},operations:bridge.enabled?bridge.operations.filter(op=>op.status==='pending').slice(0,20).map(({id,action,table,values,key})=>({id,action,table,...(values?{values}:{}),...(key?{key}:{})})):[]};}
  async snapshot(input){const snapshot=normalizeDatabaseSnapshot(input.snapshot);await this.records.update('database',initial(),data=>{const bridge=find(data,input.bridgeId);bridge.snapshot=snapshot;bridge.lastSeenAt=new Date().toISOString();return data;});return {accepted:true,bridgeId:input.bridgeId,observedAt:snapshot.observedAt};}
  async queue(input){
    const requestId=controlId(input.requestId),id='dbop-'+crypto.randomUUID();
    await this.records.update('database',initial(),data=>{
      const bridge=find(data,input.bridgeId),prior=bridge.operations.find(op=>op.requestId===requestId);
      if(prior){if(!object(input.operation)||canonical(operationShape(prior))!==canonical(operationShape(input.operation)))throw controlError(409,'database_idempotency_conflict','معرّف الطلب مستخدم لتغيير مختلف.');return data;}
      if(!bridge.enabled||!bridge.snapshot||Date.now()-Date.parse(bridge.lastSeenAt)>90000)throw controlError(409,'database_offline','يلزم اتصال حديث بقاعدة البيانات قبل طلب التغيير.');
      if(bridge.operations.filter(op=>op.status==='pending').length>=50)throw controlError(422,'database_queue_full','طابور قاعدة البيانات ممتلئ.');
      const op=input.operation;if(!object(op)||!['insert','update','delete'].includes(op.action))throw controlError(422,'database_operation','نوع التغيير غير صالح.');
      const table=bridge.snapshot.writableTables.find(t=>t.name===op.table);if(!table)throw controlError(403,'database_write_denied','الكتابة لهذا الجدول غير مفعّلة في إعداد المنفّذ المحلي.');
      const operation={id,requestId,action:op.action,table:table.name,status:'pending',createdAt:new Date().toISOString()};
      if(op.action!=='delete'){operation.values=values(op.values,table.columns);if(!Object.keys(operation.values).length)throw controlError(422,'database_empty_change','لا توجد حقول لتغييرها.');}
      if(op.action!=='insert'){operation.key=values(op.key,table.primaryKey);if(table.primaryKey.some(name=>!Object.hasOwn(operation.key,name)||operation.key[name]===null))throw controlError(422,'database_key_required','يلزم مفتاح الصف الكامل للتعديل أو الحذف.');}
      bridge.operations.unshift(operation);bridge.operations=bridge.operations.filter((op,index)=>op.status==='pending'||index<150);return data;
    });return this.read();
  }
  async receipt(input){
    const raw=input.receipt;if(!object(raw)||!['applied','rejected','failed'].includes(raw.status))throw controlError(422,'database_receipt','إيصال قاعدة البيانات غير صالح.');
    const operationId=controlId(raw.operationId),changes=number(raw.changes,100000);
    if(typeof raw.backupCreated!=='boolean'||(raw.status==='applied'&&(raw.backupCreated!==true||changes!==1))||(raw.status!=='applied'&&changes!==0))throw controlError(422,'database_backup_required','التغيير الناجح يحتاج نسخة احتياطية مؤكدة وصفًا واحدًا متأثرًا؛ الفشل لا يعلن تغيير صفوف.');
    const receipt={operationId,status:raw.status,observedAt:date(raw.observedAt),changes,backupCreated:Boolean(raw.backupCreated),summary:string(raw.summary,'وصف النتيجة',1000)};
    if(raw.operationDigest!=null){if(!/^[a-f0-9]{64}$/.test(raw.operationDigest))throw controlError(422,'database_receipt','بصمة العملية غير صالحة.');receipt.operationDigest=raw.operationDigest;}
    if(raw.lastInsertRowid!=null)receipt.lastInsertRowid=string(String(raw.lastInsertRowid),'معرّف الصف',40);
    await this.records.update('database',initial(),data=>{const bridge=find(data,input.bridgeId),op=bridge.operations.find(item=>item.id===operationId);if(!op)throw controlError(404,'database_operation_missing','العملية غير موجودة.');if(op.status!=='pending'){if(canonical(op.receipt)!==canonical(receipt))throw controlError(409,'database_receipt_conflict','لا يمكن استبدال إيصال نهائي مختلف.');return data;}op.status=receipt.status;op.receipt=receipt;bridge.lastSeenAt=new Date().toISOString();return data;});return {accepted:true,operationId,status:receipt.status};
  }
}

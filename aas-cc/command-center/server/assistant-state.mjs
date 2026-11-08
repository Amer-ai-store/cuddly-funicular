import {ControlRepository,controlError,controlId} from './control.mjs';
import {assistantTurn,validateAssistantProposal,sanitizeAssistantText} from './assistant.mjs';
import {mutateLiveState} from './state.mjs';
const redact=sanitizeAssistantText;
export class AssistantControl {
  constructor(db){this.db=db;this.records=new ControlRepository(db);}
  async history(){
    const record=await this.records.load('assistant-history',{messages:[]});
    const ids=record.data.messages.flatMap(message=>(message.proposals||[]).map(p=>'assistant-proposal:'+p.id));
    const rows=ids.length?(await this.db.prepare('SELECT id,document FROM aas_control_records WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results:[];
    const plans=new Map(rows.map(row=>[row.id,JSON.parse(row.document)]));
    return {messages:record.data.messages.map(message=>({...message,...(message.proposals?{proposals:message.proposals.map(plan=>{const saved=plans.get('assistant-proposal:'+plan.id);return {...plan,status:saved?.status==='applied'?'applied':Date.parse(saved?.expiresAt||0)<Date.now()?'expired':'pending'};})}:{})}))};
  }
  async turn(input,context,env,fetchImpl){
    const requestId=controlId(input.requestId||crypto.randomUUID());
    const key='assistant-turn:'+requestId;
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({message:input.message,model:input.model}))))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const now=new Date().toISOString();
    const claimed=await this.db.prepare('INSERT OR IGNORE INTO aas_control_records (id,revision,document,updated_at) VALUES (?,0,?,?)').bind(key,JSON.stringify({status:'processing',digest}),now).run();
    if(claimed.meta.changes!==1){const old=await this.records.load(key);if(old.data.digest!==digest)throw controlError(409,'assistant_request_conflict','معرّف رسالة مستخدم لطلب مختلف.');if(old.data.result)return old.data.result;throw controlError(409,'assistant_in_progress','الرسالة قيد المعالجة أو لم تكتمل؛ لا تُعاد تلقائيًا.');}
    try{
      const history=await this.history();
      const bounded=[];let chars=0;
      for(const message of history.messages.slice(-8).reverse()){const content=String(message.content).slice(0,500);if(chars+content.length>4000)break;chars+=content.length;bounded.unshift({role:message.role,content});}
      const result=await assistantTurn({message:input.message,history:bounded,...(input.model?{model:input.model}:{})},context,env,fetchImpl);
      const proposals=[];
      for(const proposal of result.body.proposals||[]){
        const saved={...proposal,status:'pending',baseRevision:context.revision,repository:context.repository||null,expiresAt:new Date(Date.now()+30*60000).toISOString()};
        await this.records.load('assistant-proposal:'+proposal.id,saved);proposals.push({...proposal,status:'pending',baseRevision:context.revision});
      }
      const id='message-'+crypto.randomUUID();result.body={...result.body,proposals,messageId:id};
      await this.records.update('assistant-history',{messages:[]},data=>{data.messages.push({id:'message-'+crypto.randomUUID(),role:'user',content:redact(input.message,env).slice(0,2000),provider:null,model:null,createdAt:now},{id,role:'assistant',content:result.body.assistantMessage||'',provider:result.body.provider,model:result.body.model||null,proposals,createdAt:new Date().toISOString()});data.messages=data.messages.slice(-60);return data;});
      await this.records.update(key,{},data=>({...data,status:'completed',result}));return result;
    }catch(error){await this.records.update(key,{},data=>({...data,status:'failed'})).catch(()=>{});throw error;}
  }
  async apply(proposalId,org,repo,expected){
    const record=await this.records.load('assistant-proposal:'+controlId(proposalId));const plan=record.data;
    if(!plan.operation)throw controlError(404,'assistant_proposal_missing','المقترح غير موجود.');
    if(plan.status==='applied')return {record:org,alreadyApplied:true};
    if(plan.status!=='pending'||Date.parse(plan.expiresAt)<Date.now())throw controlError(409,'assistant_proposal_expired','انتهت صلاحية المقترح؛ اطلب اقتراحًا حديثًا.');
    if(expected!==org.revision||plan.baseRevision!==org.revision)throw controlError(409,'assistant_proposal_stale','تغيّر المشروع بعد إعداد المقترح؛ اطلب تحديثه قبل التنفيذ.');
    const checked=validateAssistantProposal(plan,{state:org.state,repository:plan.repository});
    const changed=mutateLiveState(org.state,checked.operation,checked.payload);
    const timestamp=new Date().toISOString(),nextPlan={...plan,status:'applied',appliedAt:timestamp,appliedRevision:org.revision+1};
    // A single D1 transaction checks BOTH revisions and commits the action and
    // its receipt together. A duplicate click never creates a second task.
    try{
      await this.db.batch([
        this.db.prepare('INSERT INTO aas_control_records (id,revision,document,updated_at) SELECT CASE WHEN (SELECT revision FROM aas_app_state WHERE id=?)=? AND (SELECT revision FROM aas_control_records WHERE id=?)=? THEN ? ELSE NULL END,0,?,?').bind('organization',org.revision,record.id,record.revision,'assistant-applied:'+proposalId,JSON.stringify({proposalId,status:'applied'}),timestamp),
        this.db.prepare('UPDATE aas_app_state SET revision=revision+1,document=?,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(changed.state),timestamp,'organization',org.revision),
        this.db.prepare('UPDATE aas_control_records SET revision=revision+1,document=?,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(nextPlan),timestamp,record.id,record.revision)
      ]);
    }catch{
      const current=await this.records.load(record.id);if(current.data.status==='applied')return {record:await repo.load(),alreadyApplied:true};
      throw controlError(409,'assistant_proposal_conflict','تغيّر المشروع أثناء الاعتماد؛ لم يُعَد تنفيذ المقترح.');
    }
    return {record:await repo.load(),result:changed.result,alreadyApplied:false};
  }
}

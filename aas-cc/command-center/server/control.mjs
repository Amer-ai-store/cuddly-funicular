const clone=value=>structuredClone(value);
export function controlError(status,code,message){return Object.assign(new Error(message),{status,code});}
export const controlId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw controlError(422,'invalid_control_id','معرّف العملية غير صالح.');return value;};
export class ControlRepository {
  constructor(db){this.db=db;}
  async load(id,initial={}){
    await this.db.prepare('INSERT OR IGNORE INTO aas_control_records (id,revision,document,updated_at) VALUES (?,0,?,?)').bind(id,JSON.stringify(initial),new Date().toISOString()).run();
    const row=await this.db.prepare('SELECT revision,document,updated_at FROM aas_control_records WHERE id=?').bind(id).first();
    return {id,revision:row.revision,data:JSON.parse(row.document),updatedAt:row.updated_at};
  }
  async save(record,data){
    const document=JSON.stringify(data);
    if(new TextEncoder().encode(document).length>1500000)throw controlError(413,'control_capacity','بلغ هذا السجل حد التخزين؛ صدّر السجل قبل إضافة المزيد.');
    const result=await this.db.prepare('UPDATE aas_control_records SET revision=revision+1,document=?,updated_at=? WHERE id=? AND revision=?').bind(document,new Date().toISOString(),record.id,record.revision).run();
    return result.meta.changes===1;
  }
  async update(id,initial,fn){
    for(let attempt=0;attempt<5;attempt++){
      const record=await this.load(id,initial),next=await fn(clone(record.data));
      if(await this.save(record,next))return {...record,revision:record.revision+1,data:next};
    }
    throw controlError(409,'control_conflict','وصل تحديث متزامن للمسار نفسه. أعد المحاولة بعد مراجعة الحالة.');
  }
}

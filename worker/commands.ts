import{type Env,type Actor,HttpError,iso,unix,text,id,admin,audit,rows}from'./types';
import{generateCode,hashCode,sha256,passwordHash}from'./security';
import{limit}from'./auth';
import{dispatch}from'./line';
export async function command(env:Env,actor:Actor,action:string,p:any){
 const db=env.DB,now=iso();
 if(['teacher_save','issue_code','unbind','staff_save','template_save','system_status'].includes(action))admin(actor);
 if(action==='system_status')return {send_enabled:env.LINE_SEND_ENABLED==='true',line_configured:!!env.LINE_CHANNEL_ACCESS_TOKEN&&!!env.LINE_CHANNEL_SECRET,binding_configured:env.BINDING_PEPPER?.length>=32};
 if(action==='teacher_save'){
  const tid=p.teacher_id?id(p.teacher_id):crypto.randomUUID();const name=text(p.name,'教師姓名',80),dept=text(p.department??'','單位',500,0),notes=text(p.notes??'','備註',500,0);
  const statements=[db.prepare(`INSERT INTO teachers(id,name,department,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,department=excluded.department,notes=excluded.notes,active=excluded.active,updated_at=excluded.updated_at`).bind(tid,name,dept,notes,p.active===false?0:1,now,now),audit(db,actor.id,action,tid)];
  // 停用時撤銷未使用綁定碼，避免重新啟用後舊碼意外復活。
  if(p.active===false)statements.push(db.prepare('DELETE FROM binding_codes WHERE teacher_id=?').bind(tid));
  await db.batch(statements);return {id:tid};
 }
 if(action==='issue_code'){
  if(!env.BINDING_PEPPER||env.BINDING_PEPPER.length<32)throw new HttpError(503,'後端尚未設定綁定金鑰');
  const tid=id(p.teacher_id),code=generateCode(),expiry=unix()+604800,digest=await hashCode(code,env.BINDING_PEPPER);
  const result=await db.batch([db.prepare(`INSERT INTO binding_codes(teacher_id,code_hash,expires_at,used_at,issued_at,issued_by) SELECT id,?,?,NULL,?,? FROM teachers WHERE id=? AND active=1 AND line_user_id IS NULL ON CONFLICT(teacher_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,used_at=NULL,issued_at=excluded.issued_at,issued_by=excluded.issued_by RETURNING teacher_id`).bind(digest,expiry,now,actor.id,tid),db.prepare("INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM binding_codes WHERE teacher_id=? AND code_hash=?)").bind(crypto.randomUUID(),actor.id,action,tid,now,tid,digest)]);
  if(!result[0].results.length)throw new HttpError(409,'教師已綁定、停用或不存在');return {code,expires_at:new Date(expiry*1000).toISOString()};
 }
 if(action==='unbind'){
  const tid=id(p.teacher_id);await db.batch([db.prepare('UPDATE teachers SET line_user_id=NULL,bound_at=NULL,bound_event_id=NULL,binding_event_time=NULL,binding_version=binding_version+1,updated_at=? WHERE id=?').bind(now,tid),db.prepare('DELETE FROM binding_codes WHERE teacher_id=?').bind(tid),db.prepare("UPDATE notifications SET send_status='failed',error_code='binding_changed' WHERE teacher_id=? AND send_status='queued'").bind(tid),audit(db,actor.id,action,tid)]);return {};
 }
 if(action==='staff_save'){
  const sid=p.id?id(p.id):crypto.randomUUID(),role=p.role;if(!['admin','staff'].includes(role))throw new HttpError(400,'權限格式錯誤');
  const name=text(p.display_name,'顯示名稱',80),old=await db.prepare('SELECT * FROM admins WHERE id=?').bind(sid).first<any>();
  if(actor.id===sid&&(p.active===false||role!=='admin'))throw new HttpError(409,'不可停用或降級自己的帳號');
  const username=text(p.username||old?.username,'登入帳號',120).toLowerCase();if(!/^[a-z0-9._@+-]{3,120}$/.test(username))throw new HttpError(400,'登入帳號限 3 至 120 字英數及 . _ @ + -');
  const password=p.password;if(!old||password){if(typeof password!=='string'||password.length<12||password.length>128)throw new HttpError(400,'密碼須為 12 至 128 字');}
  if(!env.AUTH_PEPPER||env.AUTH_PEPPER.length<32)throw new HttpError(503,'後端尚未設定登入金鑰');
  const hash=password?await passwordHash(password,env.AUTH_PEPPER):old.password_hash;
  await db.batch([db.prepare(`INSERT INTO admins(id,username,display_name,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,password_hash=excluded.password_hash,role=excluded.role,active=excluded.active,updated_at=excluded.updated_at`).bind(sid,username,name,hash,role,p.active===false?0:1,now,now),db.prepare('DELETE FROM sessions WHERE admin_id=?').bind(sid),audit(db,actor.id,action)]);return {id:sid};
 }
 if(action==='template_save'){
  if(!['mail','parcel','contact','custom'].includes(p.kind))throw new HttpError(400,'通知類型錯誤');
  await db.batch([db.prepare('UPDATE templates SET content=? WHERE kind=?').bind(text(p.content,'範本',5000,p.kind==='custom'?0:1),p.kind),audit(db,actor.id,action)]);return {};
 }
 if(action==='internal_note_create'){
  const nid=id(p.id),tid=id(p.teacher_id),content=text(p.content,'內部備註',2000);
  const teacher=await db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').bind(tid).first();if(!teacher)throw new HttpError(409,'教師已停用或不存在');
  await db.batch([db.prepare('INSERT INTO internal_notes(id,teacher_id,content,author_id,author_name,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(nid,tid,content,actor.id,actor.display_name,now),db.prepare(`INSERT INTO audit_logs(id,actor_id,action,internal_note_id,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM audit_logs WHERE internal_note_id=?)`).bind(crypto.randomUUID(),actor.id,action,nid,now,nid)]);
  const result=await db.prepare('SELECT * FROM internal_notes WHERE id=?').bind(nid).first<any>();if(result.content!==content||result.teacher_id!==tid||result.author_id!==actor.id)throw new HttpError(409,'重複請求內容不一致');return {data:result};
 }
 if(action.startsWith('handover_'))return handover(env,actor,action,p);
 if(action==='conversation_status'){
  if(!['待回覆','已完成'].includes(p.status))throw new HttpError(400,'對話狀態錯誤');
  const tid=id(p.teacher_id);await db.batch([db.prepare('INSERT INTO conversations(teacher_id,status,updated_at) VALUES(?,?,?) ON CONFLICT(teacher_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').bind(tid,p.status,now),audit(db,actor.id,action,tid)]);return {};
 }
 if(action==='complete'){
  if(!['待領取','待回覆','已完成'].includes(p.status))throw new HttpError(400,'處理狀態錯誤');
  await db.batch([db.prepare('UPDATE notifications SET status=?,completed_at=?,completed_by=? WHERE id=?').bind(p.status,p.status==='已完成'?now:null,p.status==='已完成'?actor.id:null,id(p.id)),audit(db,actor.id,action)]);return {};
 }
 if(action==='send'){
  if(env.LINE_SEND_ENABLED!=='true'||!env.LINE_CHANNEL_ACCESS_TOKEN)throw new HttpError(409,'真實發送尚未啟用，請先完成測試與核准');
  const content=text(p.content,'訊息'),kind=p.kind,request=id(p.request_id);
  if(!['mail','parcel','contact','custom','reply'].includes(kind)||!Array.isArray(p.teacher_ids)||p.teacher_ids.length<1||p.teacher_ids.length>100)throw new HttpError(400,'通知類型或對象錯誤，每批 1 至 100 位');
  const ids=[...new Set<string>(p.teacher_ids.map(id))].sort();
  const fingerprint=await sha256(JSON.stringify({ids,content,kind}));
  const existing=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
  if(existing&&(existing.fingerprint!==fingerprint||existing.actor_id!==actor.id))throw new HttpError(409,'重複請求內容不一致');
  await limit(env,'send:'+actor.id,30,60);
  const items=ids.map(tid=>({id:crypto.randomUUID(),teacher_id:tid,retry_key:crypto.randomUUID()}));
  // 單一 JSON 參數批次建立，維持 100 位上限並避免超過免費方案每次 D1 查詢／參數上限。
  const statements=[db.prepare('INSERT INTO send_requests(id,actor_id,fingerprint,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(request,actor.id,fingerprint,now),
   db.prepare(`INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,status,created_at)
   SELECT json_extract(j.value,'$.id'),?,json_extract(j.value,'$.teacher_id'),?,?,?,coalesce(t.binding_version,-1),json_extract(j.value,'$.retry_key'),?,?
   FROM json_each(?) j LEFT JOIN teachers t ON t.id=json_extract(j.value,'$.teacher_id')
   WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE request_id=? AND teacher_id=json_extract(j.value,'$.teacher_id'))
   AND EXISTS(SELECT 1 FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=?)`).bind(request,kind,content,actor.id,['mail','parcel'].includes(kind)?'待領取':'待回覆',now,JSON.stringify(items),request,request,actor.id,fingerprint)];
  await db.batch(statements);
  const req=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();if(req.fingerprint!==fingerprint||req.actor_id!==actor.id)throw new HttpError(409,'重複請求內容不一致');
  const notices=await rows<{id:string}>(db.prepare('SELECT id FROM notifications WHERE request_id=? ORDER BY teacher_id').bind(request));
  for(const n of notices.slice(0,5))await dispatch(env,actor,n.id);
  return {data:notices.map(n=>n.id)};
 }
 if(action==='dispatch'){await dispatch(env,actor,id(p.id));return {};}
 throw new HttpError(400,'不支援的操作');
}
async function handover(env:Env,actor:Actor,action:string,p:any){
 const db=env.DB,hid=id(p.id),now=iso(),operation=crypto.randomUUID();
 const before=await db.prepare('SELECT * FROM handovers WHERE id=?').bind(hid).first<any>();
 if(action==='handover_create'){
  const content=text(p.content,'交接內容',2000),name=text(p.handover_name,'交接人',80);
  if(before){if(before.content!==content||before.created_by!==actor.id||before.handover_name!==name)throw new HttpError(409,'重複請求內容不一致');return {data:before};}
  await db.batch([db.prepare('INSERT INTO handovers(id,content,created_by,creator_name,handover_name,created_at,operation_token) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(hid,content,actor.id,actor.display_name,name,now,operation),revision(db,actor,hid,action,null,operation,null),handoverAudit(db,actor,action,hid,operation)]);
 }else{
  if(!before)throw new HttpError(404,'交接事項不存在');
  if((action==='handover_complete'&&before.completed_at)||(action==='handover_reopen'&&!before.completed_at))return {data:before};
  if(p.expected_version!==before.version)throw new HttpError(409,'交接事項已被更新，請重新整理後再操作');
  const reason=text(p.reason??'','原因',500,0)||null;
  let sql:string,args:any[];
  if(action==='handover_complete'){sql='completed_at=?,completed_by=?,completed_name=?,finisher_name=?';args=[now,actor.id,actor.display_name,text(p.finisher_name,'完成人姓名',80)];}
  else if(action==='handover_edit'){sql='content=?,handover_name=?,finisher_name=?';args=[text(p.content,'交接內容',2000),text(p.handover_name,'交接人',80),before.completed_at?text(p.finisher_name,'完成人姓名',80):null];}
  else if(action==='handover_reopen'){sql='completed_at=NULL,completed_by=NULL,completed_name=NULL,finisher_name=NULL';args=[];}
  else throw new HttpError(400,'不支援的交接操作');
  await db.batch([db.prepare(`UPDATE handovers SET ${sql},version=version+1,operation_token=? WHERE id=? AND version=?`).bind(...args,operation,hid,p.expected_version),revision(db,actor,hid,action,before,operation,reason),handoverAudit(db,actor,action,hid,operation)]);
 }
 const after=await db.prepare('SELECT * FROM handovers WHERE id=?').bind(hid).first<any>();
 if(after.operation_token!==operation)throw new HttpError(409,'交接事項已被更新，請重新整理後再操作');return {data:after};
}
function revision(db:D1Database,actor:Actor,hid:string,action:string,before:any,operation:string,reason:string|null){
 return db.prepare(`INSERT INTO handover_revisions(id,handover_id,action,actor_id,actor_name,before_data,after_data,reason,created_at,json_version) SELECT ?,id,?,?,?, ?,json_object('id',id,'content',content,'created_by',created_by,'creator_name',creator_name,'handover_name',handover_name,'created_at',created_at,'completed_at',completed_at,'completed_by',completed_by,'completed_name',completed_name,'finisher_name',finisher_name,'version',version),?,?,version FROM handovers WHERE id=? AND operation_token=?`).bind(operation,action,actor.id,actor.display_name,before?JSON.stringify(before):null,reason,iso(),hid,operation);
}
function handoverAudit(db:D1Database,actor:Actor,action:string,hid:string,operation:string){return db.prepare(`INSERT INTO audit_logs(id,actor_id,action,handover_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM handover_revisions WHERE id=?)`).bind(crypto.randomUUID(),actor.id,action,hid,iso(),operation);}

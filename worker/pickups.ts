import {type Env,type Actor,HttpError,id,iso,unix,rows} from './types';
import {handoverHistory} from './handover-history';
import {sha256} from './security';
// D1 batch 內共用一個有效性閘門；任一筆版本改變便整批拒絕。沿用請求帳本，無須新增 Migration。
export async function pickupCommand(env:Env,actor:Actor,action:string,p:any){
 if(action==='handover_history')return handoverHistory(env,actor,p);
 if(!['pickup_many','undo_many','notification_preflight'].includes(action))return undefined;
 const db=env.DB,now=iso();
 if(action==='notification_preflight'){
  if(!Array.isArray(p.teacher_ids)||p.teacher_ids.length<1||p.teacher_ids.length>100)throw new HttpError(400,'每批限 1 至 100 位教師');
  const ids=[...new Set(p.teacher_ids.map(id))];
  const pending=await rows(db.prepare(`SELECT n.teacher_id,t.name,count(*) AS count FROM notifications n JOIN teachers t ON t.id=n.teacher_id WHERE n.teacher_id IN (SELECT value FROM json_each(?)) AND n.kind IN ('mail','parcel') AND n.status='待領取' GROUP BY n.teacher_id`).bind(JSON.stringify(ids)));
  return {pending};
 }
 const request=id(p.request_id),isUndo=action==='undo_many';
 let entries:any[],fingerprint:string,teacherId:string|null=null;
 if(isUndo){
  if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>100)throw new HttpError(400,'復原筆數須為 1 至 100 筆');
  const ids=[...new Set<string>(p.ids.map(id))].sort();if(ids.length!==p.ids.length)throw new HttpError(400,'復原資料重複');
  fingerprint=await sha256(JSON.stringify({action,ids}));
  entries=await rows(db.prepare(`SELECT u.*,n.version,n.operation_token,n.teacher_id FROM undo_actions u JOIN notifications n ON n.id=u.target_id WHERE u.id IN(SELECT value FROM json_each(?)) AND u.actor_id=? AND u.target_type='notification'`).bind(JSON.stringify(ids),actor.id));
  if(entries.length!==ids.length)throw new HttpError(409,'部分紀錄無法復原，請查看最新紀錄');
 }else{
  teacherId=id(p.teacher_id);
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>100)throw new HttpError(400,'每次限 1 至 100 筆');
  const items=p.items.map((n:any)=>{if(!n||typeof n!=='object'||Array.isArray(n))throw new HttpError(400,'領件資料格式錯誤');return {id:id(n.id),version:n.expected_version};}).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  if(new Set(items.map((n:any)=>n.id)).size!==items.length||items.some((n:any)=>!Number.isInteger(n.version)||n.version<1))throw new HttpError(400,'領件資料格式錯誤');
  fingerprint=await sha256(JSON.stringify({action,teacherId,items}));
  const existing=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
  if(existing){if(existing.actor_id!==actor.id||existing.fingerprint!==fingerprint)throw new HttpError(409,'重複請求內容不一致');return {already_applied:true};}
  const found=await rows(db.prepare(`SELECT * FROM notifications WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(JSON.stringify(items)));
  if(found.length!==items.length)throw new HttpError(409,'領件紀錄已變更，請重新確認');
  entries=items.map((item:any)=>{const n=found.find(n=>n.id===item.id)!;if(n.teacher_id!==teacherId||!['mail','parcel'].includes(n.kind)||n.status!=='待領取'||n.version!==item.version)throw new HttpError(409,'領件紀錄已變更，請重新確認');return {id:n.id,version:n.version,op:'',before_data:JSON.stringify({status:n.status,completed_at:n.completed_at,completed_by:n.completed_by})};});
 }
 const existing=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
 if(existing){if(existing.actor_id!==actor.id||existing.fingerprint!==fingerprint)throw new HttpError(409,'重複請求內容不一致');return {already_applied:true};}
 if(isUndo&&entries.some(e=>e.used_at||e.expires_at<=unix()||e.after_version!==e.version||e.operation_token!==e.id))throw new HttpError(409,'紀錄已更新、逾期或已復原，請查看最新紀錄');
 for(const e of entries)e.op=await sha256(request+':'+(isUndo?e.target_id:e.id));
 const json=JSON.stringify(entries),expiry=unix()+60;
 const valid=isUndo?`SELECT count(*) FROM json_each(?) j JOIN undo_actions u ON u.id=json_extract(j.value,'$.id') JOIN notifications n ON n.id=u.target_id WHERE u.actor_id=? AND u.used_at IS NULL AND u.expires_at>? AND u.target_type='notification' AND n.version=u.after_version AND n.operation_token=u.id`:`SELECT count(*) FROM json_each(?) j JOIN notifications n ON n.id=json_extract(j.value,'$.id') WHERE n.teacher_id=? AND n.kind IN ('mail','parcel') AND n.status='待領取' AND n.version=json_extract(j.value,'$.version')`;
 const args=isUndo?[json,actor.id,unix()]:[json,teacherId];
 const ledger=db.prepare(`INSERT INTO send_requests(id,actor_id,fingerprint,created_at) SELECT ?,?,?,? WHERE (${valid})=? ON CONFLICT(id) DO NOTHING`).bind(request,actor.id,fingerprint,now,...args,entries.length);
 const gate=`EXISTS(SELECT 1 FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=?)`;
 const statements=[ledger];
 if(isUndo){
  statements.push(db.prepare(`UPDATE notifications SET status=json_extract(j.value,'$.before_data.status'),completed_at=json_extract(j.value,'$.before_data.completed_at'),completed_by=json_extract(j.value,'$.before_data.completed_by'),version=notifications.version+1,operation_token=json_extract(j.value,'$.op') FROM json_each(?) j WHERE notifications.id=json_extract(j.value,'$.target_id') AND notifications.operation_token=json_extract(j.value,'$.id') AND ${gate}`).bind(JSON.stringify(entries.map(e=>({...e,before_data:JSON.parse(e.before_data)}))),request,actor.id,fingerprint));
  statements.push(db.prepare(`UPDATE undo_actions SET used_at=? WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(now,json,request,actor.id,fingerprint));
 }else{
  statements.push(db.prepare(`UPDATE notifications SET status='已完成',completed_at=?,completed_by=?,version=notifications.version+1,operation_token=json_extract(j.value,'$.op') FROM json_each(?) j WHERE notifications.id=json_extract(j.value,'$.id') AND notifications.version=json_extract(j.value,'$.version') AND ${gate}`).bind(now,actor.id,json,request,actor.id,fingerprint));
  statements.push(db.prepare(`INSERT INTO undo_actions(id,actor_id,target_type,target_id,before_data,after_version,expires_at) SELECT json_extract(j.value,'$.op'),?,'notification',n.id,json_extract(j.value,'$.before_data'),n.version,? FROM json_each(?) j JOIN notifications n ON n.id=json_extract(j.value,'$.id') WHERE n.operation_token=json_extract(j.value,'$.op') AND ${gate} ON CONFLICT(id) DO NOTHING`).bind(actor.id,expiry,json,request,actor.id,fingerprint));
 }
 statements.push(db.prepare(`INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at) SELECT json_extract(j.value,'$.op'),?,?,n.teacher_id,? FROM json_each(?) j JOIN notifications n ON n.id=json_extract(j.value,?) WHERE n.operation_token=json_extract(j.value,'$.op') AND ${gate} ON CONFLICT(id) DO NOTHING`).bind(actor.id,action,now,json,isUndo?'$.target_id':'$.id',request,actor.id,fingerprint));
 await db.batch(statements);
 if(!await db.prepare('SELECT id FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=?').bind(request,actor.id,fingerprint).first())throw new HttpError(409,'紀錄已被其他人更新，請重新確認後再操作');
 return isUndo?{}:{undo:{id:request,ids:entries.map(e=>e.op),expires_at:expiry}};
}

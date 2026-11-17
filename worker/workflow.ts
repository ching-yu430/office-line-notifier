import {type Env,type Actor,HttpError,id,iso,unix,audit} from './types';
import {limit} from './auth';

export function saveUndo(env:Env,actor:Actor,type:'notification'|'handover',before:any,operation:string){
 const table=type==='notification'?'notifications':'handovers';
 const state=type==='notification'?{status:before.status,completed_at:before.completed_at,completed_by:before.completed_by}:{completed_at:before.completed_at,completed_by:before.completed_by,completed_name:before.completed_name,finisher_name:before.finisher_name};
 return env.DB.prepare(`INSERT INTO undo_actions(id,actor_id,target_type,target_id,before_data,after_version,expires_at) SELECT ?,?,?,?,?,version,? FROM ${table} WHERE id=? AND operation_token=?`).bind(operation,actor.id,type,before.id,JSON.stringify(state),unix()+60,before.id,operation);
}
export const undoInfo=(operation:string)=>({id:operation,expires_at:unix()+60});

export async function workflowCommand(env:Env,actor:Actor,action:string,p:any){
 const db=env.DB,now=iso();
 if(action==='conversation_view'){
  await limit(env,'view:'+actor.id,120,60);
  const tid=id(p.teacher_id),mid=id(p.message_id);
  const result=await db.prepare(`INSERT INTO conversation_views(teacher_id,admin_id,last_seen_seq,updated_at)
   SELECT teacher_id,?,rowid,? FROM messages WHERE id=? AND teacher_id=? AND direction='in'
   ON CONFLICT(teacher_id,admin_id) DO UPDATE SET last_seen_seq=max(last_seen_seq,excluded.last_seen_seq),updated_at=excluded.updated_at RETURNING teacher_id`).bind(actor.id,now,mid,tid).first();
  if(!result)throw new HttpError(409,'訊息已變更，請重新載入對話');return {};
 }
 if(action==='presence'){
  await limit(env,'presence:'+actor.id,120,60);
  const tid=id(p.teacher_id),client=id(p.client_id);
  if(typeof p.typing!=='boolean')throw new HttpError(400,'輸入狀態格式錯誤');
  if(!p.typing){await db.prepare('DELETE FROM reply_presence WHERE teacher_id=? AND admin_id=? AND client_id=?').bind(tid,actor.id,client).run();return {};}
  if(!await db.prepare('SELECT id FROM teachers WHERE id=? AND active=1 AND bound_at IS NOT NULL').bind(tid).first())throw new HttpError(409,'教師尚未綁定或已停用');
  await db.prepare(`INSERT INTO reply_presence(teacher_id,admin_id,client_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(teacher_id,admin_id,client_id) DO UPDATE SET expires_at=excluded.expires_at`).bind(tid,actor.id,client,unix()+45).run();return {};
 }
 if(action==='complete'){
  if(!['待領取','待回覆','已完成'].includes(p.status))throw new HttpError(400,'處理狀態錯誤');
  const before=await db.prepare('SELECT * FROM notifications WHERE id=?').bind(id(p.id)).first<any>();
  if(!before)throw new HttpError(404,'找不到通知紀錄');
  if(p.expected_version!=null&&p.expected_version!==before.version)throw new HttpError(409,'這筆紀錄已由其他人更新，請重新載入');
  if(before.status===p.status)return {};
  const operation=crypto.randomUUID(),canUndo=p.status==='已完成'&&['mail','parcel'].includes(before.kind);
  const statements=[db.prepare(`UPDATE notifications SET status=?,completed_at=?,completed_by=?,version=version+1,operation_token=? WHERE id=? AND version=?`).bind(p.status,p.status==='已完成'?now:null,p.status==='已完成'?actor.id:null,operation,before.id,before.version)];
  if(canUndo)statements.push(saveUndo(env,actor,'notification',before,operation));
  statements.push(db.prepare(`INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at) SELECT ?,?,'complete',teacher_id,? FROM notifications WHERE id=? AND operation_token=?`).bind(crypto.randomUUID(),actor.id,now,before.id,operation));
  await db.batch(statements);
  const after=await db.prepare('SELECT operation_token FROM notifications WHERE id=?').bind(before.id).first<any>();
  if(after.operation_token!==operation)throw new HttpError(409,'這筆紀錄已由其他人更新，請重新載入');
  return canUndo?{undo:undoInfo(operation)}:{};
 }
 if(action==='undo'){
  const undo=await db.prepare('SELECT * FROM undo_actions WHERE id=? AND actor_id=?').bind(id(p.id),actor.id).first<any>();
  if(!undo)throw new HttpError(404,'找不到可復原的操作');
  if(undo.used_at)throw new HttpError(409,'這項操作已經復原');
  if(undo.expires_at<=unix())throw new HttpError(409,'快速復原時間已過，請到原紀錄更正');
  const table=undo.target_type==='notification'?'notifications':'handovers';
  const current=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(undo.target_id).first<any>();
  if(!current||current.version!==undo.after_version||current.operation_token!==undo.id)throw new HttpError(409,'紀錄已被更新，無法快速復原；請查看最新紀錄');
  const before=JSON.parse(undo.before_data),operation=crypto.randomUUID();
  const clause=' WHERE id=? AND version=? AND operation_token=? AND EXISTS(SELECT 1 FROM undo_actions WHERE id=? AND actor_id=? AND used_at IS NULL AND expires_at>?)';
  const gate=[current.id,current.version,undo.id,undo.id,actor.id,unix()];
  const statements=[];
  if(undo.target_type==='notification'){
   statements.push(db.prepare('UPDATE notifications SET status=?,completed_at=?,completed_by=?,version=version+1,operation_token=?'+clause).bind(before.status,before.completed_at,before.completed_by,operation,...gate));
  }else{
   statements.push(db.prepare('UPDATE handovers SET completed_at=?,completed_by=?,completed_name=?,finisher_name=?,version=version+1,operation_token=?'+clause).bind(before.completed_at,before.completed_by,before.completed_name,before.finisher_name,operation,...gate));
   statements.push(db.prepare(`INSERT INTO handover_revisions(id,handover_id,action,actor_id,actor_name,before_data,after_data,reason,created_at,json_version) SELECT ?,id,'handover_undo',?,?,?,?, '快速復原',?,version FROM handovers WHERE id=? AND operation_token=?`).bind(operation,actor.id,actor.display_name,JSON.stringify(current),JSON.stringify({...current,completed_at:before.completed_at,completed_by:before.completed_by,completed_name:before.completed_name,finisher_name:before.finisher_name,version:current.version+1,operation_token:operation}),now,current.id,operation));
  }
  statements.push(db.prepare(`UPDATE undo_actions SET used_at=? WHERE id=? AND actor_id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND operation_token=?)`).bind(now,undo.id,actor.id,current.id,operation));
  statements.push(db.prepare(`INSERT INTO audit_logs(id,actor_id,action,teacher_id,handover_id,created_at) SELECT ?,?,'undo',?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND operation_token=?)`).bind(crypto.randomUUID(),actor.id,undo.target_type==='notification'?current.teacher_id:null,undo.target_type==='handover'?current.id:null,now,current.id,operation));
  await db.batch(statements);
  const result=await db.prepare('SELECT used_at FROM undo_actions WHERE id=?').bind(undo.id).first<any>();
  if(!result.used_at)throw new HttpError(409,'紀錄已被更新，無法快速復原');return {};
 }
 return undefined;
}

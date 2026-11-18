import {type Actor,type Env,HttpError,admin,id,iso,unix,rows} from './types';
import {limit} from './auth';
import {cleanupOptions,cleanupCutoff,cleanupLimits,cleanupTotal,type CleanupCounts,type CleanupPreview} from '../src/cleanup';
type Target={id:string;version?:number;teacher_version?:number};
type Plan={messages:Target[];notifications:Target[];handovers:Target[];audits:Target[]};
// 每位教師保留最後一則訊息，同時避免 SQLite rowid 重用破壞未查看序號。
const messageWhere=`m.created_at<? AND EXISTS(SELECT 1 FROM conversations c WHERE c.teacher_id=m.teacher_id AND c.status='已完成')
 AND m.rowid<(SELECT max(last.rowid) FROM messages last WHERE last.teacher_id=m.teacher_id)
 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.teacher_id=m.teacher_id AND (n.status!='已完成' OR n.send_status IN ('queued','sending','uncertain')))
 AND NOT EXISTS(SELECT 1 FROM undo_actions u JOIN notifications n ON n.id=u.target_id WHERE u.target_type='notification' AND n.teacher_id=m.teacher_id AND u.used_at IS NULL AND u.expires_at>?)`;
const noticeWhere=`n.created_at<? AND n.completed_at<? AND n.status='已完成' AND n.send_status IN ('accepted','failed')
 AND NOT EXISTS(SELECT 1 FROM undo_actions u WHERE u.target_type='notification' AND u.target_id=n.id AND u.used_at IS NULL AND u.expires_at>?)
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.notification_id=n.id AND m.id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?)))`;
const handoverWhere=`h.created_at<? AND h.completed_at<? AND NOT EXISTS(SELECT 1 FROM undo_actions u WHERE u.target_type='handover' AND u.target_id=h.id AND u.used_at IS NULL AND u.expires_at>?)`;
export async function recordCleanup(env:Env,actor:Actor,action:string,p:any){
 if(!['records_cleanup_preview','records_cleanup_execute'].includes(action))return undefined;
 admin(actor);
 const db=env.DB,now=iso(),time=unix();
 if(action==='records_cleanup_preview'){
  let options;try{options=cleanupOptions(p);}catch(e){throw new HttpError(400,(e as Error).message);}
  await limit(env,'cleanup-preview:'+actor.id,12,60);
  const cutoff=cleanupCutoff(options.before),plan:Plan={messages:[],notifications:[],handovers:[],audits:[]};
  if(options.contact){
   plan.messages=await rows(db.prepare(`SELECT m.id,(SELECT conversation_version FROM teachers WHERE id=m.teacher_id) AS teacher_version FROM messages m WHERE ${messageWhere} ORDER BY m.rowid LIMIT ?`).bind(cutoff,time,cleanupLimits.messages));
   plan.notifications=await rows(db.prepare(`SELECT n.id,n.version FROM notifications n WHERE ${noticeWhere} ORDER BY n.completed_at,n.id LIMIT ?`).bind(cutoff,cutoff,time,JSON.stringify(plan.messages),cleanupLimits.notifications));
  }
  if(options.handovers)plan.handovers=await rows(db.prepare(`SELECT h.id,h.version FROM handovers h WHERE ${handoverWhere} ORDER BY h.completed_at,h.id LIMIT ?`).bind(cutoff,cutoff,time,cleanupLimits.handovers));
  if(options.audits)plan.audits=await rows(db.prepare("SELECT id FROM audit_logs WHERE created_at<? AND action!='records_cleanup' ORDER BY created_at,id LIMIT ?").bind(cutoff,cleanupLimits.audits));
  const revisionCount=await db.prepare("SELECT count(*) AS n FROM handover_revisions WHERE handover_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))").bind(JSON.stringify(plan.handovers)).first<{n:number}>();
  const counts:CleanupCounts={messages:plan.messages.length,notifications:plan.notifications.length,handovers:plan.handovers.length,revisions:revisionCount!.n,audits:plan.audits.length};
  const result:CleanupPreview={job_id:crypto.randomUUID(),before:options.before,counts,expires_at:time+600,limited:(Object.keys(cleanupLimits) as (keyof typeof cleanupLimits)[]).some(k=>counts[k]===cleanupLimits[k])};
  await db.batch([db.prepare("DELETE FROM record_cleanup_jobs WHERE state='preview' AND expires_at<=?").bind(time),db.prepare("INSERT INTO record_cleanup_jobs(id,actor_id,cutoff,created_at,expires_at,state,plan_json,result_json) VALUES(?,?,?,?,?,'preview',?,?)").bind(result.job_id,actor.id,cutoff,now,result.expires_at,JSON.stringify(plan),JSON.stringify(result))]);
  return result;
 }
 if(p.confirmation!=='刪除紀錄')throw new HttpError(400,'請輸入「刪除紀錄」確認');
 const jobId=id(p.job_id),job=await db.prepare('SELECT * FROM record_cleanup_jobs WHERE id=? AND actor_id=?').bind(jobId,actor.id).first<any>();
 if(!job)throw new HttpError(404,'找不到清理預覽，請重新預覽');
 if(job.state==='completed')return {...JSON.parse(job.result_json),already_applied:true};
 if(job.expires_at<=time)throw new HttpError(409,'清理預覽已逾時，請重新預覽');
 const plan=JSON.parse(job.plan_json) as Plan,result=JSON.parse(job.result_json) as CleanupPreview;
 if(!cleanupTotal(result.counts))throw new HttpError(409,'沒有可清理的紀錄');
 const m=JSON.stringify(plan.messages),n=JSON.stringify(plan.notifications),h=JSON.stringify(plan.handovers),a=JSON.stringify(plan.audits),operation=crypto.randomUUID(),cutoff=job.cutoff;
 const gate='EXISTS(SELECT 1 FROM record_cleanup_jobs WHERE id=? AND operation_token=?)';
 const member=(table:string,json:string)=>`${table}.id IN(SELECT json_extract(value,'$.id') FROM json_each(${json}))`;
 const statements=[
  // 所有目標都仍可刪除才取得本次執行權；同一 D1 batch 內驗證、刪除及稽核一併提交。
  db.prepare(`UPDATE record_cleanup_jobs SET state='running',operation_token=? WHERE id=? AND actor_id=? AND state='preview' AND expires_at>?
   AND (SELECT count(*) FROM messages m JOIN json_each(?) j ON m.id=json_extract(j.value,'$.id') AND (SELECT conversation_version FROM teachers WHERE id=m.teacher_id)=json_extract(j.value,'$.teacher_version') WHERE ${messageWhere})=?
   AND (SELECT count(*) FROM notifications n JOIN json_each(?) j ON n.id=json_extract(j.value,'$.id') AND n.version=json_extract(j.value,'$.version') WHERE ${noticeWhere})=?
   AND (SELECT count(*) FROM handovers h JOIN json_each(?) j ON h.id=json_extract(j.value,'$.id') AND h.version=json_extract(j.value,'$.version') WHERE ${handoverWhere})=?
   AND (SELECT count(*) FROM audit_logs a WHERE ${member('a','?')} AND a.created_at<? AND a.action!='records_cleanup')=?`)
   .bind(operation,jobId,actor.id,time,m,cutoff,time,plan.messages.length,n,cutoff,cutoff,time,m,plan.notifications.length,h,cutoff,cutoff,time,plan.handovers.length,a,cutoff,plan.audits.length),
  db.prepare(`UPDATE send_requests SET archived_at=? WHERE id IN(SELECT request_id FROM notifications n WHERE ${member('n','?')}) AND ${gate}`).bind(now,n,jobId,operation),
  db.prepare(`DELETE FROM undo_actions WHERE ((target_type='notification' AND target_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))) OR (target_type='handover' AND target_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)))) AND ${gate}`).bind(n,h,jobId,operation),
  db.prepare(`DELETE FROM messages WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(m,jobId,operation),
  db.prepare(`DELETE FROM notifications WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(n,jobId,operation),
  db.prepare(`UPDATE audit_logs SET handover_id=NULL WHERE handover_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(h,jobId,operation),
  db.prepare(`DELETE FROM handover_revisions WHERE handover_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(h,jobId,operation),
  db.prepare(`DELETE FROM handovers WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(h,jobId,operation),
  db.prepare(`DELETE FROM audit_logs WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(a,jobId,operation),
  db.prepare(`INSERT INTO audit_logs(id,actor_id,action,result,details,created_at) SELECT ?,?,'records_cleanup','success',?,? WHERE ${gate}`).bind(operation,actor.id,JSON.stringify({before:result.before,counts:result.counts}),now,jobId,operation),
  // 完成後不長期保存目標清單，只留防重複執行與清理摘要。
  db.prepare(`UPDATE record_cleanup_jobs SET state='completed',completed_at=?,plan_json=NULL WHERE id=? AND operation_token=?`).bind(now,jobId,operation)
 ];
 await db.batch(statements);
 const done=await db.prepare('SELECT state,result_json FROM record_cleanup_jobs WHERE id=?').bind(jobId).first<any>();
 if(done.state!=='completed')throw new HttpError(409,'紀錄已更新，尚未刪除任何資料，請重新預覽','CLEANUP_CHANGED');
 return JSON.parse(done.result_json) as CleanupPreview;
}

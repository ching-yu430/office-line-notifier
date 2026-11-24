import{type Env,type Actor,HttpError,iso,audit}from'./types';
import{limit}from'./auth';
export async function line(env:Env,path:string,body:unknown,retry?:string){
 return fetch('https://api.line.me/v2/bot/'+path,{method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json',...(retry?{'X-Line-Retry-Key':retry}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
}
export async function recover(db:D1Database){await db.prepare("UPDATE notifications SET send_status='uncertain',error_code='worker_interrupted' WHERE send_status='sending' AND claimed_at<?").bind(new Date(Date.now()-120000).toISOString()).run();}
export type ReplyCompletion={complete:boolean;lastInboundId:string|null};
export async function dispatch(env:Env,actor:Actor,nid:string,reply?:ReplyCompletion){
 if(env.LINE_SEND_ENABLED!=='true'||!env.LINE_CHANNEL_ACCESS_TOKEN)throw new HttpError(409,'真實發送尚未啟用，請先完成測試與核准');
 await limit(env,'dispatch:global',60,60);
 await recover(env.DB);
 // UPDATE RETURNING 原子領取，只有一個請求能呼叫 LINE。
 const n=await env.DB.prepare(`UPDATE notifications SET send_status='sending',claimed_at=? WHERE id=? AND send_status='queued' RETURNING *`).bind(iso(),nid).first<any>();
 if(!n)return;
 if(n.pickup_item_id){const item=await env.DB.prepare('SELECT status FROM pickup_items WHERE id=?').bind(n.pickup_item_id).first<any>();if(item?.status!=='待領取'){await env.DB.prepare("UPDATE notifications SET send_status='failed',error_code='item_closed' WHERE id=? AND send_status='sending'").bind(nid).run();return;}}
 const teacher=await env.DB.prepare('SELECT line_user_id,binding_version,active FROM teachers WHERE id=?').bind(n.teacher_id).first<any>();
 if(!teacher?.active||!teacher.line_user_id||teacher.binding_version!==n.binding_version){await env.DB.prepare("UPDATE notifications SET send_status='failed',error_code='binding_changed' WHERE id=? AND send_status='sending'").bind(nid).run();return;}
 let outcome='uncertain',error:string|null='network_or_timeout';
 try{
  const response=await line(env,'message/push',{to:teacher.line_user_id,messages:[{type:'text',text:n.content}]},n.retry_key);
  if(response.ok||(response.status===409&&response.headers.has('x-line-accepted-request-id'))){outcome='accepted';error=null;}
  else{outcome=response.status>=500?'uncertain':'failed';error='line_http_'+response.status;}
  await response.body?.cancel();
 }catch{/* 結果未明不自動重送，避免教師收到重複通知。 */}
 const now=iso();const statements=[env.DB.prepare("UPDATE notifications SET send_status=?,error_code=?,sent_at=? WHERE id=? AND send_status='sending'").bind(outcome,error,outcome==='accepted'?now:null,nid),audit(env.DB,actor.id,'dispatch',n.teacher_id,outcome)];
 if(outcome==='accepted'){
  statements.push(env.DB.prepare(`INSERT INTO messages(id,teacher_id,direction,content,created_at,notification_id,processing_status) VALUES(?,?,'out',?,?,?,'accepted') ON CONFLICT(notification_id) DO NOTHING`).bind(crypto.randomUUID(),n.teacher_id,n.content,now,nid));
  statements.push(env.DB.prepare('UPDATE teachers SET last_notified_at=? WHERE id=?').bind(now,n.teacher_id));
  if(n.kind==='reply'){
   // 完成的是這次回覆；包裹／信件的實際領取紀錄不隨之結案。
   statements.push(env.DB.prepare("UPDATE notifications SET status='已完成',completed_at=?,completed_by=? WHERE id=?").bind(now,n.sender_id,nid));
   if(reply){
    // 使用訊息識別碼確認仍是行政人員預覽時看過的內容。
    // 新訊息在 LINE 請求期間或預覽後抵達時，不把它一起標記完成。
    const gate=reply.complete?"coalesce((SELECT id FROM messages WHERE teacher_id=? AND direction='in' ORDER BY rowid DESC LIMIT 1),'')=?":"1=1";
    const args=reply.complete?[n.teacher_id,reply.lastInboundId??'']:[];
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at) SELECT ?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),n.sender_id,reply.complete?'reply_complete':'reply_pending',n.teacher_id,now,...args));
    statements.push(env.DB.prepare(`INSERT INTO conversations(teacher_id,status,updated_at) SELECT ?,?,? WHERE ${gate} ON CONFLICT(teacher_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).bind(n.teacher_id,reply.complete?'已完成':'待回覆',now,...args));
   }
  }
 }
 await env.DB.batch(statements);
}

import{type Env,iso,unix,HttpError}from'./types';
import{verifySignature,parseEvents,hashCode,limitedBody}from'./security';
import{line}from'./line';
const successReply='身分綁定成功，日後辦公室通知將透過此帳號傳送';
const unsupported='文件及附件請使用辦公室 Email 傳送';
export async function webhook(req:Request,env:Env){
 if(req.method!=='POST')throw new HttpError(405,'只接受 POST');
 let raw:string;try{raw=await limitedBody(req,1000000);}catch{throw new HttpError(413,'請求過大');}
 if(!await verifySignature(raw,req.headers.get('x-line-signature'),env.LINE_CHANNEL_SECRET||''))throw new HttpError(401,'簽章無效');
 let events:any[];try{events=parseEvents(raw);for(const e of events){if(!Number.isFinite(e.timestamp)||e.timestamp<0||e.timestamp>Date.now()+300000)throw Error();if(e.source.type==='user'&&typeof e.source.userId!=='string')throw Error();if(e.type==='message'&&(!e.message||typeof e.message.id!=='string'||typeof e.message.type!=='string'||(e.message.type==='text'&&typeof e.message.text!=='string')))throw Error();if(e.type==='unsend'&&typeof e.unsend?.messageId!=='string')throw Error();}}catch{throw new HttpError(400,'事件格式錯誤');}
 if(!events.length)return new Response('OK');
 if(!env.BINDING_PEPPER||env.BINDING_PEPPER.length<32)throw new HttpError(503,'尚未設定綁定金鑰');
 // 一次批次交易涵蓋整包事件，避免大量事件超過免費方案每次請求的 D1 呼叫上限。
 const plans=[];for(const e of events)plans.push(await plan(env,e));
 await env.DB.batch(plans.flatMap(p=>p.statements));
 const fresh=(await env.DB.prepare('SELECT id,claim_token,outcome FROM webhook_events WHERE claim_token IN (SELECT value FROM json_each(?))').bind(JSON.stringify(plans.map(p=>p.claim))).all<{id:string;claim_token:string;outcome:string}>()).results;
 const replies: {id:string;token:string;content:string}[]=[];
 for(const plan of plans){const result=fresh.find(r=>r.id===plan.e.webhookEventId&&r.claim_token===plan.claim);if(!result)continue;const e=plan.e;let content:string|undefined;
  if(e.source.type==='user'&&e.type==='follow')content='歡迎加入辦公室通知帳號，請輸入行政人員提供的一次性綁定碼。文件及附件請使用辦公室 Email 傳送。';
  if(result.outcome==='bound')content=successReply;
  if(result.outcome==='invalid_code')content='綁定碼無效、已使用或已過期，請向辦公室確認。';
  if(result.outcome==='rate_limited')content='嘗試次數過多，請一小時後再試，或聯絡辦公室。';
  if(content&&e.replyToken)replies.push({id:e.webhookEventId,token:e.replyToken,content});
 }
 // 單次最多 40 次 LINE 回覆。大量加入好友時保留處理狀態；文字／綁定資料不會因回覆額度受限而遺失。
 replies.sort((a,b)=>Number(b.content===successReply)-Number(a.content===successReply));
 const marks:D1PreparedStatement[]=[];
 for(let i=0;i<replies.length;i++){
  const reply=replies[i];let status='reply_not_configured';
  if(i>=40)status='reply_skipped_limit';
  else if(env.LINE_CHANNEL_ACCESS_TOKEN){try{const r=await line(env,'message/reply',{replyToken:reply.token,messages:[{type:'text',text:reply.content}]});status=r.ok?'replied':'reply_failed';await r.body?.cancel();}catch{status='reply_failed';}}
  marks.push(env.DB.prepare('UPDATE webhook_events SET reply_status=? WHERE id=?').bind(status,reply.id));
 }
 if(marks.length)await env.DB.batch(marks);
 return new Response('OK');
}
async function plan(env:Env,e:any){
 const db=env.DB,eventId=e.webhookEventId,claim=crypto.randomUUID(),now=iso(),when=new Date(e.timestamp).toISOString(),uid=e.source.type==='user'?e.source.userId:null;
 const gate='EXISTS(SELECT 1 FROM webhook_events WHERE id=? AND claim_token=?)';
 const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO webhook_events(id,claim_token,line_user_id,kind,event_time,outcome,created_at) VALUES(?,?,?,?,?,'processed',?) ON CONFLICT(id) DO NOTHING`).bind(eventId,claim,uid,e.type,when,now)];
 if(uid&&e.type==='message'){
  if(e.message.type==='text'){
   const digest=await hashCode(e.message.text,env.BINDING_PEPPER),key='bind-user:'+await hashCode(uid,env.BINDING_PEPPER),seconds=unix();
   for(const [k,expiry]of [[key,seconds+3600],['bind-global',seconds+3600]]as const)statements.push(db.prepare(`INSERT INTO rate_limits(key,hits,expires_at) SELECT ?,1,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM teachers WHERE line_user_id=?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).bind(k,expiry,eventId,claim,uid,seconds,seconds));
   statements.push(db.prepare(`UPDATE teachers SET line_user_id=?,bound_at=?,binding_version=binding_version+1,bound_event_id=?,binding_event_time=?,updated_at=? WHERE active=1 AND line_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM teachers WHERE line_user_id=?) AND id IN(SELECT teacher_id FROM binding_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>? AND issued_at<=?) AND (SELECT hits FROM rate_limits WHERE key=?)<=10 AND (SELECT hits FROM rate_limits WHERE key='bind-global')<=1000 AND ${gate}`).bind(uid,now,eventId,when,now,uid,digest,seconds,when,key,eventId,claim));
   statements.push(db.prepare(`UPDATE binding_codes SET used_at=? WHERE teacher_id IN(SELECT id FROM teachers WHERE bound_event_id=? AND line_user_id=?) AND used_at IS NULL AND ${gate}`).bind(now,eventId,uid,eventId,claim));
   statements.push(db.prepare(`INSERT INTO audit_logs(id,action,teacher_id,created_at) SELECT ?,'line_bound',id,? FROM teachers WHERE bound_event_id=? AND line_user_id=? AND ${gate}`).bind(crypto.randomUUID(),now,eventId,uid,eventId,claim));
  }
  const type=e.message.type,mid=e.message.id;
  const isCode=type==='text'&&/^[A-HJ-NP-Z2-9]{12}$/.test(e.message.text.trim().toUpperCase().replace(/[ -]/g,''));
  const content=type==='text'?(isCode?'（此帳號已完成綁定，綁定碼不會再次使用）':e.message.text.slice(0,5000)):`（收到不支援的訊息類型：${safeType(type)}；${unsupported}）`;
  const sourceHash=await hashCode(uid,env.BINDING_PEPPER);
  statements.push(db.prepare(`INSERT INTO messages(id,teacher_id,direction,content,message_type,created_at,line_event_id,line_message_id,withdrawn,processing_status,line_source_hash)
   SELECT ?,t.id,'in',CASE WHEN EXISTS(SELECT 1 FROM unsend_tombstones WHERE line_message_id=? AND line_user_id=?) THEN '（訊息已撤回）' ELSE ? END,?,?,?, ?,EXISTS(SELECT 1 FROM unsend_tombstones WHERE line_message_id=? AND line_user_id=?),?,?
   FROM teachers t WHERE t.line_user_id=? AND t.active=1 AND coalesce(t.binding_event_time,t.bound_at)<=? AND (t.bound_event_id IS NULL OR t.bound_event_id!=?) AND ${gate} ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),mid,uid,content,type,when,eventId,mid,mid,uid,type==='text'?'received':'unsupported',sourceHash,uid,when,eventId,eventId,claim));
  statements.push(db.prepare(`INSERT INTO conversations(teacher_id,status,updated_at) SELECT teacher_id,'待回覆',? FROM messages WHERE line_event_id=? AND withdrawn=0 AND ${gate} ON CONFLICT(teacher_id) DO UPDATE SET status='待回覆',updated_at=excluded.updated_at`).bind(now,eventId,eventId,claim));
  statements.push(db.prepare(`UPDATE webhook_events SET outcome=CASE WHEN EXISTS(SELECT 1 FROM teachers WHERE bound_event_id=? AND line_user_id=?) THEN 'bound' WHEN EXISTS(SELECT 1 FROM messages WHERE line_event_id=?) THEN 'received' WHEN EXISTS(SELECT 1 FROM teachers WHERE line_user_id=?) THEN 'ignored' WHEN kind='message' AND ?='text' AND ((SELECT hits FROM rate_limits WHERE key=?)>10 OR (SELECT hits FROM rate_limits WHERE key='bind-global')>1000) THEN 'rate_limited' WHEN ?='text' THEN 'invalid_code' ELSE 'ignored' END WHERE id=? AND claim_token=?`).bind(eventId,uid,eventId,uid,type,'bind-user:'+sourceHash,type,eventId,claim));
 }
 if(uid&&e.type==='unsend'){
  const mid=e.unsend.messageId,sourceHash=await hashCode(uid,env.BINDING_PEPPER);
  statements.push(db.prepare(`INSERT INTO unsend_tombstones(line_message_id,line_user_id,created_at) SELECT ?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`).bind(mid,uid,now,eventId,claim));
  // 根據原訊息來源比對：解除或重新綁定後仍可正確撤回；不會撤回其他教師的訊息。
  statements.push(db.prepare(`UPDATE messages SET content='（訊息已撤回）',withdrawn=1,processing_status='withdrawn' WHERE line_message_id=? AND direction='in' AND line_source_hash=? AND ${gate}`).bind(mid,sourceHash,eventId,claim));
 }
 return {e,claim,statements};
}
function safeType(type:string){return ['image','video','audio','file','sticker','location'].includes(type)?({image:'圖片',video:'影片',audio:'語音',file:'檔案',sticker:'貼圖',location:'位置'}as Record<string,string>)[type]:'其他';}

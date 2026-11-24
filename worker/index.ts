import{type Env,HttpError,iso,unix,rows,audit}from'./types';
import{login,session,csrf,cookie}from'./auth';
import{limitedBody}from'./security';
import{command}from'./commands';
import{webhook}from'./webhook';
import{recover}from'./line';
import{operationalFailure}from'./errors';
import{APP_VERSION}from'../src/version';
import{notificationHistory}from'./notification-history';
import {pickupFields} from './pickup-items';
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  const url=new URL(req.url),path=url.pathname;
  // 靜態資源交給 Pages；Webhook 與登入後 API 都由相同 Workers 程式處理。
  if(!path.startsWith('/api/')){
   if(!env.ASSETS)return new Response('辦公室 API 服務',{headers:securityHeaders});
   const response=await env.ASSETS.fetch(req);const headers=new Headers(response.headers);for(const [k,v]of Object.entries(securityHeaders))headers.set(k,v);
   headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
   return new Response(response.body,{status:response.status,headers});
  }
  const origin=req.headers.get('origin'),allowed=env.ALLOWED_ORIGIN;
  const headers=new Headers({...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});
  if(origin&&origin===allowed){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Credentials','true');headers.set('Access-Control-Allow-Headers','Content-Type,X-CSRF-Token,If-None-Match');headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
   if(env.COOKIE_SECURE==='false'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new HttpError(503,'公開服務必須啟用安全 Cookie 設定');
   if(path==='/api/line/webhook'){
    try{return await webhook(req,env);}catch(e){if(e instanceof HttpError)return json({error:e.message,...(e.code?{code:e.code}:{})},e.status);return json({error:'暫時無法處理，請 LINE 重送'},500);}
   }
   // 公開資訊不包含帳號、憑證或資料庫內容；用於預覽網址導回正式登入。
   if(path==='/api/public-info'&&req.method==='GET'){
    let publicOrigin:string|null=null;
    try{const target=new URL(allowed);if(target.origin===allowed&&(target.protocol==='https:'||(['localhost','127.0.0.1'].includes(target.hostname)&&target.protocol==='http:')))publicOrigin=target.origin;}catch{}
    return json({name:'辦公室小幫手',origin:publicOrigin,version:APP_VERSION});
   }
   if(origin&&origin!==allowed)throw new HttpError(403,'目前網址無法登入，請從正式網站開啟','ORIGIN_NOT_ALLOWED');
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(!['GET','POST'].includes(req.method))throw new HttpError(405,'不支援的請求方法');
   if(req.method==='POST'&&(!origin||origin!==allowed))throw new HttpError(403,'缺少正確的網頁來源');
   if(req.method==='POST'&&!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'請使用 JSON 格式');
   if(path==='/api/health'&&req.method==='GET')return json({ok:true,service:'辦公室小幫手 API'});
   let body:any;
   if(req.method==='POST'){let raw;try{raw=await limitedBody(req,100000);}catch{throw new HttpError(413,'請求過大');}try{body=JSON.parse(raw);}catch{throw new HttpError(400,'JSON 格式錯誤');}if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'請求格式錯誤');}
   if(path==='/api/login'&&req.method==='POST'){
    const result=await login(req,env,body);headers.set('Set-Cookie',result.cookie);return json({actor:result.actor,csrf:result.csrf});
   }
   const s=await session(req,env);if(req.method==='POST')await csrf(req,s);
   if(path==='/api/session'&&req.method==='GET')return json({actor:{id:s.id,username:s.username,display_name:s.display_name,role:s.role},csrf:s.csrf_token});
   if(path==='/api/logout'&&req.method==='POST'){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(s.token_hash),audit(env.DB,s.id,'logout')]);headers.set('Set-Cookie',cookie('',env,0));return json({ok:true});}
   if(path==='/api/notifications/query'&&req.method==='POST'){
    const filters=new URLSearchParams();for(const key of ['page','teacher','status','send','query','from','to']){if(body[key]!=null){if(typeof body[key]!=='string')throw new HttpError(400,'查詢欄位格式錯誤');filters.set(key,body[key]);}}
    return json(await notificationHistory(env,s,filters));
   }
   if(path==='/api/conversation'&&req.method==='GET'){
    const tid=url.searchParams.get('teacher_id');if(!tid||!/^[a-zA-Z0-9_-]{1,80}$/.test(tid))throw new HttpError(400,'教師識別碼格式錯誤');
    if(!await env.DB.prepare('SELECT id FROM teachers WHERE id=?').bind(tid).first())throw new HttpError(404,'找不到教師');
    const cursorText=url.searchParams.get('before'), knownText=url.searchParams.get('known_from');
    const parseSequence=(value:string|null)=>{if(value===null)return null;if(!/^[1-9]\d{0,14}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new HttpError(400,'訊息分頁格式錯誤');return Number(value);};
    const cursor=parseSequence(cursorText),known=parseSequence(knownText);
    const messageSql=`SELECT m.id,m.teacher_id,m.direction,m.content,m.message_type,m.created_at,m.notification_id,m.withdrawn,m.sequence,a.display_name AS sender_name
      FROM (SELECT rowid AS sequence,* FROM messages WHERE teacher_id=? ${cursor?'AND rowid<?':''} ORDER BY rowid DESC LIMIT 201) m
      LEFT JOIN notifications n ON n.id=m.notification_id LEFT JOIN admins a ON a.id=n.sender_id ORDER BY m.sequence DESC`;
    const results=await env.DB.batch([
     env.DB.prepare(messageSql).bind(tid,...(cursor?[cursor]:[])),
     env.DB.prepare('SELECT '+pickupFields+" FROM pickup_items p WHERE p.teacher_id=? AND p.status='待領取' ORDER BY p.created_at DESC LIMIT 200").bind(tid),
     env.DB.prepare('SELECT id FROM messages WHERE teacher_id=? AND withdrawn=1 AND rowid>=?').bind(tid,known||Number.MAX_SAFE_INTEGER)
    ]);
    const all=results[0].results as any[],messages=all.slice(0,200).reverse();
    return json({messages,pickups:results[1].results,has_more:all.length>200,next_before:messages[0]?.sequence??null,withdrawn_ids:results[2].results.map((row:any)=>row.id)});
   }
   // 高頻檢查只讀一列版本；不查聊天歷史、不清理資料、不呼叫 LINE。
   if(path==='/api/changes'&&req.method==='GET'){
    const version=(await env.DB.prepare('SELECT version FROM system_meta WHERE id=1').first<{version:number}>())!.version;
    const etag=`"${s.id}-${s.role}-${version}"`;headers.set('ETag',etag);
    if(req.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
    return json({changed:true});
   }
   if(path==='/api/data'&&req.method==='GET'){
    await recover(env.DB);
    await env.DB.batch([env.DB.prepare('DELETE FROM reply_presence WHERE expires_at<=?').bind(unix()),env.DB.prepare('DELETE FROM undo_actions WHERE expires_at<?').bind(unix()-86400),env.DB.prepare('DELETE FROM pickup_item_undo WHERE expires_at<?').bind(unix()-600)]);
    const version=(await env.DB.prepare('SELECT version FROM system_meta WHERE id=1').first<{version:number}>())!.version;
    const etag=`"${s.id}-${s.role}-${version}"`;headers.set('ETag',etag);
    if(req.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
    const names=['teachers','notifications','messages','staff','templates','audit_logs','conversations','handovers','internal_notes','handover_revisions','inbox','presence','pickup_items','summary'];
    // 不向瀏覽器暴露 LINE User ID、密碼雜湊、Session、綁定碼雜湊。
    const queries=[
     'SELECT id,name,department,notes,active,bound_at,last_notified_at,conversation_version FROM teachers ORDER BY name LIMIT 1000',
     'SELECT id,teacher_id,kind,pickup_name,pickup_item_id,content,important,sender_id,send_status,status,error_code,created_at,sent_at,completed_at,completed_by,version FROM notifications ORDER BY created_at DESC LIMIT 500',
     'SELECT id,teacher_id,direction,content,message_type,created_at,line_event_id,line_message_id,notification_id,withdrawn,processing_status,sequence FROM (SELECT rowid AS sequence,* FROM messages ORDER BY rowid DESC LIMIT 500) ORDER BY created_at,sequence',
     s.role==='admin'?'SELECT id,username,display_name,role,active FROM admins ORDER BY created_at':'SELECT id,display_name,role,active FROM admins ORDER BY created_at',
     'SELECT * FROM templates',
     s.role==='admin'?'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500':'SELECT * FROM audit_logs WHERE 0',
     'SELECT * FROM conversations',
     'SELECT id,content,created_by,creator_name,handover_name,created_at,completed_at,completed_by,completed_name,finisher_name,version,teacher_id FROM handovers WHERE completed_at IS NULL OR id IN(SELECT id FROM handovers WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 200) ORDER BY completed_at IS NOT NULL,created_at DESC',
     'SELECT * FROM internal_notes ORDER BY created_at DESC LIMIT 500',
     'SELECT id,handover_id,action,actor_id,actor_name,before_data,after_data,reason,created_at FROM handover_revisions ORDER BY created_at DESC LIMIT 500',
     `SELECT t.id AS teacher_id,m.content AS latest_content,m.created_at AS latest_at,m.direction AS latest_direction,
       (SELECT id FROM messages WHERE teacher_id=t.id AND direction='in' ORDER BY rowid DESC LIMIT 1) AS latest_inbound_id,
       (SELECT count(*) FROM messages WHERE teacher_id=t.id AND direction='in' AND withdrawn=0 AND rowid>coalesce(v.last_seen_seq,0)) AS unread_count
      FROM teachers t LEFT JOIN messages m ON m.rowid=(SELECT max(rowid) FROM messages WHERE teacher_id=t.id)
      LEFT JOIN conversation_views v ON v.teacher_id=t.id AND v.admin_id=? WHERE t.active=1`,
     `SELECT p.teacher_id,p.admin_id,a.display_name,p.expires_at FROM reply_presence p JOIN admins a ON a.id=p.admin_id WHERE a.active=1 AND p.expires_at>?`,
     'SELECT '+pickupFields+" FROM pickup_items p WHERE p.status='待領取' ORDER BY p.created_at DESC LIMIT 200",
     `SELECT (SELECT count(*) FROM pickup_items WHERE status='待領取') AS pickup_count,
       (SELECT count(*) FROM handovers WHERE completed_at IS NULL) AS handover_count,
       (SELECT count(*) FROM notifications WHERE send_status IN ('failed','uncertain') AND status!='已完成') AS attention_count,
       (SELECT count(*) FROM notifications WHERE send_status='accepted' AND sent_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','+8 hours','start of day','-8 hours')) AS sent_today,
       (SELECT count(*) FROM pickup_items WHERE status='已完成' AND completed_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','+8 hours','start of day','-8 hours')) AS picked_today,
       (SELECT count(*) FROM handovers WHERE completed_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','+8 hours','start of day','-8 hours')) AS handovers_today`

    ];
    const results=await env.DB.batch(queries.map((q,i)=>i===10?env.DB.prepare(q).bind(s.id):i===11?env.DB.prepare(q).bind(unix()):env.DB.prepare(q)));
    const data=Object.fromEntries(names.map((name,i)=>[name,results[i].results]));
    data.summary=(data.summary as any[])[0];
    for(const name of ['teachers','staff'])for(const row of data[name]as any[])row.active=!!row.active;
    for(const row of data.handover_revisions as any[]){row.before_data=row.before_data?JSON.parse(row.before_data):null;row.after_data=JSON.parse(row.after_data);}
    return json(data);
   }
   if(path==='/api/command'&&req.method==='POST'){
    if(typeof body.action!=='string'||(body.payload!=null&&(typeof body.payload!=='object'||Array.isArray(body.payload))))throw new HttpError(400,'操作格式錯誤');
    return json(await command(env,s,body.action,body.payload||{}));
   }
   throw new HttpError(404,'找不到 API');
  }catch(e){
   if(e instanceof HttpError)return json({error:e.message,...(e.code?{code:e.code}:{})},e.status);
   // 不輸出 SQL、參數、密碼或 LINE 原始錯誤內容。
   const message=e instanceof Error?e.message:'';
   if(message.includes('last_admin'))return json({error:'必須保留至少一位啟用中的管理員'},409);
   if(message.includes('pickup_notice_pending'))return json({error:'此物品仍有待發送或結果未明的通知，請先核對紀錄'},409);
   if(message.includes('invalid_pickup_item'))return json({error:'物品已更新或不再待領取'},409);
   if(message.includes('invalid_binding'))return json({error:'教師尚未綁定、已停用或綁定已變更'},409);
   if(message.includes('UNIQUE constraint'))return json({error:'帳號或資料已存在，請重新確認'},409);
   const operational=operationalFailure(e);if(operational)return json({error:operational.message,code:operational.code},503);
   return json({error:'操作失敗，請稍後重試或聯絡管理員',code:'INTERNAL_ERROR'},500);
  }
 },
 async scheduled(_event:ScheduledEvent,env:Env,ctx:ExecutionContext){ctx.waitUntil(env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(unix()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(unix())]).then(()=>recover(env.DB)));}
};

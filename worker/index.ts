import{type Env,HttpError,iso,unix,rows,audit}from'./types';
import{login,session,csrf,cookie}from'./auth';
import{limitedBody}from'./security';
import{command}from'./commands';
import{webhook}from'./webhook';
import{recover}from'./line';
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
    try{return await webhook(req,env);}catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);return json({error:'暫時無法處理，請 LINE 重送'},500);}
   }
   if(origin&&origin!==allowed)throw new HttpError(403,'來源不允許');
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
   if(path==='/api/data'&&req.method==='GET'){
    await recover(env.DB);
    const version=(await env.DB.prepare('SELECT version FROM system_meta WHERE id=1').first<{version:number}>())!.version;
    const etag=`"${s.id}-${s.role}-${version}"`;headers.set('ETag',etag);
    if(req.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
    const names=['teachers','notifications','messages','staff','templates','audit_logs','conversations','handovers','internal_notes','handover_revisions'];
    // 不向瀏覽器暴露 LINE User ID、密碼雜湊、Session、綁定碼雜湊。
    const queries=[
     'SELECT id,name,department,notes,active,bound_at,last_notified_at FROM teachers ORDER BY name LIMIT 1000',
     'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 500',
     'SELECT id,teacher_id,direction,content,message_type,created_at,line_event_id,line_message_id,notification_id,withdrawn,processing_status FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 500) ORDER BY created_at',
     s.role==='admin'?'SELECT id,username,display_name,role,active FROM admins ORDER BY created_at':'SELECT id,display_name,role,active FROM admins ORDER BY created_at',
     'SELECT * FROM templates',
     s.role==='admin'?'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500':'SELECT * FROM audit_logs WHERE 0',
     'SELECT * FROM conversations',
     'SELECT id,content,created_by,creator_name,handover_name,created_at,completed_at,completed_by,completed_name,finisher_name,version FROM handovers ORDER BY completed_at IS NOT NULL,created_at DESC LIMIT 1000',
     'SELECT * FROM internal_notes ORDER BY created_at DESC LIMIT 500',
     'SELECT id,handover_id,action,actor_id,actor_name,before_data,after_data,reason,created_at FROM handover_revisions ORDER BY created_at DESC LIMIT 500'
    ];
    const results=await env.DB.batch(queries.map(q=>env.DB.prepare(q)));
    const data=Object.fromEntries(names.map((name,i)=>[name,results[i].results]));
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
   if(e instanceof HttpError)return json({error:e.message},e.status);
   // 不輸出 SQL、參數、密碼或 LINE 原始錯誤內容。
   const message=e instanceof Error?e.message:'';
   if(message.includes('last_admin'))return json({error:'必須保留至少一位啟用中的管理員'},409);
   if(message.includes('invalid_binding'))return json({error:'教師尚未綁定、已停用或綁定已變更'},409);
   if(message.includes('UNIQUE constraint'))return json({error:'帳號或資料已存在，請重新確認'},409);
   return json({error:'操作失敗，請稍後重試或聯絡管理員'},500);
  }
 },
 async scheduled(_event:ScheduledEvent,env:Env,ctx:ExecutionContext){ctx.waitUntil(env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(unix()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(unix())]).then(()=>recover(env.DB)));}
};

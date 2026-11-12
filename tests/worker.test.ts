import type{D1Database}from'@cloudflare/workers-types';
import{beforeAll,beforeEach,afterAll,it,expect,describe}from'vitest';
import{Miniflare}from'miniflare';
import{build}from'esbuild';
import{readFileSync}from'node:fs';
import{randomUUID,randomBytes,createHmac}from'node:crypto';
import{passwordHash,sha256}from'../worker/security';
let mf:Miniflare,db:D1Database;
const origin='http://localhost:5173',authPepper=randomBytes(32).toString('hex'),bindingPepper=randomBytes(32).toString('hex'),lineSecret=randomBytes(32).toString('hex');
const credentials={username:'test-'+randomUUID(),password:randomBytes(24).toString('hex')};
let cookie='',csrf='',staffCookie='',staffCsrf='',timeOffset=0;
let calls:{url:string;body:any;retry:string|null}[]=[],lineStatus=200,lineThrows=false;
const now=()=>new Date(Date.now()+timeOffset).toISOString();
beforeAll(async()=>{
 const output=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'browser',write:false});
 mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-07-01',d1Databases:['DB'],bindings:{ALLOWED_ORIGIN:origin,COOKIE_SECURE:'false',AUTH_PEPPER:authPepper,BINDING_PEPPER:bindingPepper,LINE_CHANNEL_SECRET:lineSecret,LINE_CHANNEL_ACCESS_TOKEN:randomBytes(32).toString('hex'),LINE_SEND_ENABLED:'true'},outboundService:async(req:any)=>{
  calls.push({url:req.url,body:await req.json(),retry:req.headers.get('x-line-retry-key')});if(lineThrows)throw Error('simulated transport failure');return new Response('{}',{status:lineStatus});
 }});
 db=await mf.getD1Database('DB') as unknown as D1Database;
 const sql=readFileSync('migrations/0001_initial.sql','utf8').replace(/--[^\n]*/g,'');
 const statements=sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean);
 await db.batch(statements.map(sql=>db.prepare(sql)));
},60000);
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
 calls=[];lineStatus=200;lineThrows=false;timeOffset=0;
 for(const name of ['handover_revisions','audit_logs','internal_notes','handovers','messages','conversations','notifications','send_requests','unsend_tombstones','webhook_events','binding_codes','teachers','sessions','rate_limits','admins'])await db.prepare(`DELETE FROM ${name}`).run();
 const hash=await passwordHash(credentials.password,authPepper);
 await db.prepare('INSERT INTO admins VALUES(?,?,?,?,?,?,?,?)').bind('test-admin',credentials.username,'測試管理員',hash,'admin',1,now(),now()).run();
 await db.prepare('INSERT INTO admins VALUES(?,?,?,?,?,?,?,?)').bind('test-staff',credentials.username+'-staff','測試行政人員',hash,'staff',1,now(),now()).run();
 const result=await login();cookie=result.cookie;csrf=result.csrf;
 const staff=await login(credentials.username+'-staff');staffCookie=staff.cookie;staffCsrf=staff.csrf;
});
async function request(path:string,body?:any,c=cookie,token=csrf,extra:Record<string,string>={}){return mf.dispatchFetch('http://localhost/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),Cookie:c,'X-CSRF-Token':token,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function login(username=credentials.username,password=credentials.password){const response=await request('/login',{username,password},'','');expect(response.status).toBe(200);const body:any=await response.json();return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:body.csrf};}
async function cmd(action:string,payload:any={},c=cookie,token=csrf){return request('/command',{action,payload},c,token);}
async function teacher(bound=false){const response=await cmd('teacher_save',{name:'虛構測試教師',department:'測試單位',notes:'',active:true});expect(response.status).toBe(200);const tid=(await response.json() as any).id;if(bound)await db.prepare('UPDATE teachers SET line_user_id=?,bound_at=?,binding_version=1 WHERE id=?').bind('U'+randomUUID(),new Date(Date.now()-1000).toISOString(),tid).run();return tid;}
async function issue(tid:string){const r=await cmd('issue_code',{teacher_id:tid});expect(r.status).toBe(200);return (await r.json() as any).code;}
function ev(text:string,uid='U'+randomUUID(),eventId=randomUUID(),messageId=randomUUID()){return {webhookEventId:eventId,type:'message',timestamp:Date.now(),source:{type:'user',userId:uid},message:{id:messageId,type:'text',text},replyToken:randomBytes(16).toString('hex')};}
async function hook(events:any[],raw?:string,sig?:string){const body=raw??JSON.stringify({events});return mf.dispatchFetch('http://localhost/api/line/webhook',{method:'POST',headers:{'x-line-signature':sig??createHmac('sha256',lineSecret).update(body).digest('base64')},body});}
async function get<T=any>(sql:string,...args:any[]){return db.prepare(sql).bind(...args).first<T>();}
describe('Workers / D1 真實本機 Runtime 整合（LINE HTTP 以 Mock 替代）',()=>{
 it('登入、HttpOnly Cookie、CSRF、登出及 Session 到期',async()=>{
  const r=await request('/login',credentials,'','');expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('SameSite=Lax');
  expect((await request('/session',undefined,'')).status).toBe(401);
  expect((await cmd('teacher_save',{},cookie,'wrong')).status).toBe(403);
  expect((await request('/command',{action:'send'},cookie,csrf,{Origin:'https://wrong.example'})).status).toBe(403);
  expect((await request('/logout',{})).status).toBe(200);expect((await request('/session')).status).toBe(401);
  const fresh=await login();cookie=fresh.cookie;csrf=fresh.csrf;await db.prepare('UPDATE sessions SET expires_at=0').run();expect((await request('/session')).status).toBe(401);
 });
 it('登入錯誤限制、停用帳號、雜湊不含明碼',async()=>{
  const saved=await get('SELECT password_hash FROM admins WHERE id=?','test-admin');expect(saved.password_hash).not.toContain(credentials.password);
  for(let i=0;i<4;i++)expect((await request('/login',{username:credentials.username,password:randomUUID()},'','')).status).toBe(401);
  expect((await request('/login',credentials,'','')).status).toBe(429);
  await db.prepare('UPDATE admins SET active=0 WHERE id=?').bind('test-staff').run();expect((await request('/session',undefined,staffCookie,staffCsrf)).status).toBe(401);
 });
 it('所有管理操作由後端拒絕一般行政；Mock 動作不存在',async()=>{
  for(const action of ['teacher_save','issue_code','unbind','staff_save','template_save','system_status'])expect((await cmd(action,{},staffCookie,staffCsrf)).status).toBe(403);
  expect((await cmd('mock_bind',{code:'x'})).status).toBe(400);
 });
 it('新增與停用帳號、重設密碼撤銷 Session、不可降級自身或最後管理員',async()=>{
  const username='new-'+randomUUID(),password=randomBytes(20).toString('hex');const r=await cmd('staff_save',{username,password,display_name:'虛構行政人員',role:'staff',active:true});expect(r.status).toBe(200);const sid=(await r.json() as any).id;
  const logged=await login(username,password);expect((await request('/session',undefined,logged.cookie,logged.csrf)).status).toBe(200);
  expect((await cmd('staff_save',{id:sid,username,display_name:'虛構行政人員',role:'staff',active:false})).status).toBe(200);expect((await request('/session',undefined,logged.cookie,logged.csrf)).status).toBe(401);
  expect((await cmd('staff_save',{id:'test-admin',display_name:'測試管理員',role:'staff',active:true})).status).toBe(409);
  await expect(db.prepare("UPDATE admins SET role='staff' WHERE id='test-admin'").run()).rejects.toThrow();
 });
 it('綁定成功、僅存 HMAC、使用一次，與原子唯一身分約束',async()=>{
  const tid=await teacher(),code=await issue(tid);const row=await get('SELECT * FROM binding_codes WHERE teacher_id=?',tid);expect(row.code_hash).toHaveLength(64);expect(JSON.stringify(row)).not.toContain(code);
  const event=ev(code),duplicate=ev(code);const responses=await Promise.all([hook([event]),hook([duplicate])]);expect(responses.every(r=>r.status===200)).toBe(true);
  const t=await get('SELECT * FROM teachers WHERE id=?',tid);expect([event.source.userId,duplicate.source.userId]).toContain(t.line_user_id);expect((await get('SELECT * FROM binding_codes WHERE teacher_id=?',tid)).used_at).toBeTruthy();
  expect((await get('SELECT count(*) AS n FROM audit_logs WHERE action=?','line_bound')).n).toBe(1);
  expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(0);expect(calls.some(c=>c.body.messages[0].text.includes('身分綁定成功'))).toBe(true);
  await expect(db.prepare('UPDATE teachers SET line_user_id=? WHERE id=?').bind(t.line_user_id,await teacher()).run()).rejects.toThrow();
 });
 it('7 天有效期、重發失效、已用碼與解除綁定後舊碼拒絕',async()=>{
  const tid=await teacher(),old=await issue(tid),code=await issue(tid);expect(code).not.toBe(old);await hook([ev(old)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
  await db.prepare('UPDATE binding_codes SET expires_at=? WHERE teacher_id=?').bind(Math.floor(Date.now()/1000)-1,tid).run();await hook([ev(code)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
  const fresh=await issue(tid);const t=await get('SELECT expires_at,issued_at FROM binding_codes WHERE teacher_id=?',tid);expect(t.expires_at-Math.floor(new Date(t.issued_at).getTime()/1000)).toBe(604800);
  await hook([ev(fresh)]);expect((await cmd('unbind',{teacher_id:tid})).status).toBe(200);await hook([ev(fresh)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
 });
 it('同一 LINE 帳號不能綁多位老師；已綁帳號輸入碼視為普通文字',async()=>{
  const first=await teacher(),second=await teacher(),uid='U'+randomUUID();await hook([ev(await issue(first),uid)]);await hook([ev(await issue(second),uid)]);expect((await get('SELECT line_user_id FROM teachers WHERE id=?',second)).line_user_id).toBeNull();
 });
 it('同一 LINE 身分每小時最多 10 次猜測，重送不重複計次',async()=>{
  const tid=await teacher(),code=await issue(tid),uid='U'+randomUUID(),wrong=ev(randomUUID(),uid);await hook([wrong]);await hook([wrong]);
  for(let i=0;i<9;i++)await hook([ev(randomUUID(),uid)]);await hook([ev(code,uid)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
  expect((await get("SELECT outcome FROM webhook_events ORDER BY rowid DESC LIMIT 1")).outcome).toBe('rate_limited');
 });
 it('簽章、異常 JSON／事件、過大本文、群組事件及空 Verify',async()=>{
  expect((await hook([])).status).toBe(200);expect((await hook([],'bad','bad')).status).toBe(401);expect((await hook([],'bad')).status).toBe(400);
  expect((await hook([{type:'message'}])).status).toBe(400);expect((await hook([{...ev('text'),timestamp:NaN}])).status).toBe(400);expect((await hook([],'x'.repeat(1000001))).status).toBe(413);
  const group={...ev('group'),source:{type:'group',groupId:'test-group'}};expect((await hook([group])).status).toBe(200);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(0);
 });
 it('文字回覆正確對應教師、事件與訊息雙重去重，快照更新且不洩漏秘密欄位',async()=>{
  const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),event=ev('測試回覆',t.line_user_id);const before=await request('/data');const etag=before.headers.get('etag')!;
  expect((await request('/data',undefined,cookie,csrf,{'If-None-Match':etag})).status).toBe(304);
  await hook([event]);await hook([event]);await hook([{...event,webhookEventId:randomUUID()}]);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(1);expect((await get('SELECT * FROM messages')).teacher_id).toBe(tid);expect((await get('SELECT * FROM conversations')).status).toBe('待回覆');
  const response=await request('/data',undefined,cookie,csrf,{'If-None-Match':etag});expect(response.status).toBe(200);const data:any=await response.json();expect(data.messages[0].content).toBe('測試回覆');const raw=JSON.stringify(data);for(const field of ['line_user_id','password_hash','code_hash','csrf_hash','token_hash'])expect(raw).not.toContain(field);
 });
 it('老師附件只記錄類型與 Email 提示，沒有下載 HTTP 請求',async()=>{
  const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);const event={...ev('',t.line_user_id),message:{id:randomUUID(),type:'file',fileName:'should-not-save.pdf',fileSize:100}};await hook([event]);const m=await get('SELECT * FROM messages');expect(m.message_type).toBe('file');expect(m.content).toContain('文件及附件請使用辦公室 Email 傳送');expect(JSON.stringify(m)).not.toContain('should-not-save');expect(calls).toHaveLength(0);
 });
 it('撤回、撤回早於文字、偽冒其他老師撤回、解除綁定後舊事件',async()=>{
  const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),event=ev('撤回文字',t.line_user_id);await hook([event]);
  const unsend={webhookEventId:randomUUID(),type:'unsend',timestamp:Date.now(),source:event.source,unsend:{messageId:event.message.id}};await hook([{...unsend,webhookEventId:randomUUID(),source:{type:'user',userId:'U'+randomUUID()}}]);expect((await get('SELECT content FROM messages')).content).toBe('撤回文字');
  await hook([unsend]);expect((await get('SELECT * FROM messages')).withdrawn).toBe(1);
  const future=ev('不應顯示',t.line_user_id);await hook([{...unsend,webhookEventId:randomUUID(),unsend:{messageId:future.message.id}}]);await hook([future]);expect((await get('SELECT content FROM messages WHERE line_message_id=?',future.message.id)).content).toBe('（訊息已撤回）');
  const old=ev('舊綁定回覆',t.line_user_id);old.timestamp=Date.now()-100000;await hook([old]);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(2);
 });
 it('通知送出保留固定重試鍵與逐人紀錄；同請求不重送，內容不一致拒絕',async()=>{
  const tid=await teacher(true),payload={request_id:randomUUID(),teacher_ids:[tid],kind:'parcel',content:'虛構測試通知'};
  expect((await cmd('send',payload,staffCookie,staffCsrf)).status).toBe(200);expect((await cmd('send',payload,staffCookie,staffCsrf)).status).toBe(200);
  const n=await get('SELECT * FROM notifications');expect(n.send_status).toBe('accepted');expect(n.status).toBe('待領取');expect(n.sender_id).toBe('test-staff');expect(calls).toHaveLength(1);expect(calls[0].retry).toBe(n.retry_key);expect(calls[0].body.messages[0].type).toBe('text');
  expect((await cmd('send',{...payload,content:'另一則'} ,staffCookie,staffCsrf)).status).toBe(409);
  expect((await cmd('complete',{id:n.id,status:'已完成'})).status).toBe(200);expect((await get('SELECT completed_by FROM notifications')).completed_by).toBe('test-admin');
 });
 it('批次通知含未綁定教師全部回滾；綁定變更後不再處理待發送',async()=>{
  const bound=await teacher(true),unbound=await teacher();expect((await cmd('send',{request_id:randomUUID(),teacher_ids:[bound,unbound],kind:'mail',content:'測試'})).status).toBe(409);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(0);expect(calls).toHaveLength(0);
 });
 it('LINE 429 記失敗，5xx 記結果未明；中斷發送也不自動重送',async()=>{
  const tid=await teacher(true);lineStatus=429;await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'contact',content:'測試一'});expect((await get('SELECT send_status FROM notifications')).send_status).toBe('failed');
  lineStatus=503;await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'contact',content:'測試二'});const n=await get("SELECT * FROM notifications WHERE send_status='uncertain'");expect(n).toBeTruthy();const count=calls.length;await cmd('dispatch',{id:n.id});expect(calls.length).toBe(count);
  await db.prepare("UPDATE notifications SET send_status='sending',claimed_at=? WHERE id=?").bind(new Date(Date.now()-180000).toISOString(),n.id).run();await request('/data');expect((await get('SELECT send_status,error_code FROM notifications WHERE id=?',n.id)).error_code).toBe('worker_interrupted');
 });
 it('內部備註不送 LINE，交接更正／恢復保留前後版本，並拒絕過期修改',async()=>{
  const tid=await teacher(true),noteId=randomUUID(),hid=randomUUID();expect((await cmd('internal_note_create',{id:noteId,teacher_id:tid,content:'內部事項'},staffCookie,staffCsrf)).status).toBe(200);await cmd('internal_note_create',{id:noteId,teacher_id:tid,content:'內部事項'},staffCookie,staffCsrf);expect((await get('SELECT count(*) AS n FROM internal_notes')).n).toBe(1);expect(calls).toHaveLength(0);
  expect((await cmd('handover_create',{id:hid,content:'交接',handover_name:'測試交接人'},staffCookie,staffCsrf)).status).toBe(200);
  expect((await cmd('handover_complete',{id:hid,expected_version:1,finisher_name:'測試完成人'})).status).toBe(200);
  expect((await cmd('handover_edit',{id:hid,expected_version:1,content:'舊版',handover_name:'測試交接人'})).status).toBe(409);
  expect((await cmd('handover_reopen',{id:hid,expected_version:2,reason:'需再確認'})).status).toBe(200);
  expect((await get('SELECT * FROM handovers')).completed_at).toBeNull();expect((await get('SELECT count(*) AS n FROM handover_revisions')).n).toBe(3);
  const change=await get("SELECT * FROM handover_revisions WHERE action='handover_reopen'");expect(JSON.parse(change.before_data).finisher_name).toBe('測試完成人');expect(calls).toHaveLength(0);
 });
});

it('整包 100 筆教師文字及相同包重送，不超額也不重複保存',async()=>{
 const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),events=Array.from({length:100},(_,i)=>ev('批次測試文字 '+i,t.line_user_id));
 expect((await hook(events)).status).toBe(200);expect((await hook(events)).status).toBe(200);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(100);expect((await get('SELECT count(*) AS n FROM webhook_events')).n).toBe(100);expect(calls).toHaveLength(0);
});
it('同包先綁定再接收較早送出的後續訊息，使用事件時間避免丟失',async()=>{
 const tid=await teacher(),code=await issue(tid),uid='U'+randomUUID(),binding=ev(code,uid);await new Promise(r=>setTimeout(r,5));const incoming=ev('老師在等待 Webhook 時繼續回覆',uid);await new Promise(r=>setTimeout(r,5));
 expect((await hook([binding,incoming])).status).toBe(200);expect((await get('SELECT content FROM messages')).content).toBe('老師在等待 Webhook 時繼續回覆');
});
it('解除綁定後仍可撤回原 LINE 身分的舊訊息，其他帳號不能撤回',async()=>{
 const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),incoming=ev('稍後撤回',t.line_user_id);await hook([incoming]);await cmd('unbind',{teacher_id:tid});await hook([{webhookEventId:randomUUID(),type:'unsend',timestamp:Date.now(),source:incoming.source,unsend:{messageId:incoming.message.id}}]);expect((await get('SELECT withdrawn,content FROM messages')).withdrawn).toBe(1);
});
it('LINE 自動回覆失敗仍保留綁定，重送不再次回覆',async()=>{
 const tid=await teacher(),event=ev(await issue(tid));lineStatus=500;expect((await hook([event])).status).toBe(200);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeTruthy();expect((await get('SELECT reply_status FROM webhook_events')).reply_status).toBe('reply_failed');const count=calls.length;await hook([event]);expect(calls.length).toBe(count);
});
it('大量加入好友保留所有事件，40 次自動回覆後標記略過',async()=>{
 const events=Array.from({length:45},()=>({webhookEventId:randomUUID(),timestamp:Date.now(),type:'follow',source:{type:'user',userId:'U'+randomUUID()},replyToken:randomUUID()}));expect((await hook(events)).status).toBe(200);expect(calls).toHaveLength(40);expect((await get("SELECT count(*) AS n FROM webhook_events WHERE reply_status='reply_skipped_limit'")).n).toBe(5);
});
it('全域猜測限流、已停用教師與碼過期邊界',async()=>{
 const tid=await teacher(),code=await issue(tid);await db.prepare("INSERT INTO rate_limits VALUES('bind-global',1000,?)").bind(Math.floor(Date.now()/1000)+3600).run();await hook([ev(code)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
 await db.prepare('DELETE FROM rate_limits').run();await cmd('teacher_save',{teacher_id:tid,name:'虛構停用教師',active:false});expect((await cmd('issue_code',{teacher_id:tid})).status).toBe(409);await hook([ev(code)]);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeNull();
});
it('批次 100 位逐人私訊建立、僅前 5 筆處理；換綁後 queued 不再發送',async()=>{
 const ids=Array.from({length:100},()=>randomUUID()),time=new Date(Date.now()-1000).toISOString();await db.batch(ids.map(tid=>db.prepare('INSERT INTO teachers(id,name,line_user_id,bound_at,binding_version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(tid,'虛構批次教師','U'+randomUUID(),time,time,time)));
 const response=await cmd('send',{request_id:randomUUID(),teacher_ids:ids,kind:'mail',content:'批次測試'});expect(response.status).toBe(200);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(100);expect((await get("SELECT count(*) AS n FROM notifications WHERE send_status='accepted'")).n).toBe(5);expect(calls).toHaveLength(5);
 const queued=await get("SELECT * FROM notifications WHERE send_status='queued' LIMIT 1");await cmd('unbind',{teacher_id:queued.teacher_id});await cmd('dispatch',{id:queued.id});expect(calls).toHaveLength(5);expect((await get('SELECT error_code FROM notifications WHERE id=?',queued.id)).error_code).toBe('binding_changed');
});
it('一般行政僅取得顯示名稱與空操作紀錄，猜測無效 session 不能讀資料',async()=>{
 const response=await request('/data',undefined,staffCookie,staffCsrf),data:any=await response.json();expect(data.audit_logs).toEqual([]);expect(data.staff[0]).not.toHaveProperty('username');expect((await request('/data',undefined,'office_session='+randomBytes(32).toString('hex'))).status).toBe(401);
});
it('公開網域拒絕使用本機非 Secure Cookie 設定，惡意來源不能登入',async()=>{
 const response=await mf.dispatchFetch('https://public.example/api/health');expect(response.status).toBe(503);
 expect((await request('/login',credentials,'','',{Origin:'https://untrusted.example'})).status).toBe(403);
});
it('已使用綁定碼與帳號密碼不會進入對外快照或聊天正文',async()=>{
 const tid=await teacher(),code=await issue(tid),uid='U'+randomUUID();await hook([ev(code,uid)]);await hook([ev(code,uid)]);
 const response=await request('/data'),data:any=await response.json(),serialized=JSON.stringify(data);expect(serialized).not.toContain(code);expect(serialized).not.toContain(credentials.password);expect(serialized).not.toContain('line_source_hash');expect(data.messages[0].content).toContain('已完成綁定');
});
it('D1 交易異常回 500 不洩漏 SQL，整包回滾後可用同事件重送',async()=>{
 const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),incoming=ev('故障後重送文字',t.line_user_id);
 await db.prepare("CREATE TRIGGER simulate_failure BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'private_sql_debug'); END").run();
 try{const response=await hook([incoming]);expect(response.status).toBe(500);expect(await response.text()).not.toContain('private_sql_debug');expect((await get('SELECT count(*) AS n FROM webhook_events')).n).toBe(0);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(0);}finally{await db.prepare('DROP TRIGGER simulate_failure').run();}
 expect((await hook([incoming])).status).toBe(200);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(1);
});

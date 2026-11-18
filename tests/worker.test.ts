import {migrationStatements} from './migrations';
import {APP_VERSION} from '../src/version';
import{productionCryptoLimit}from'./production-crypto';
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
let calls:{url:string;body:any;retry:string|null}[]=[],lineStatus=200,lineThrows=false,botStatus=200;
let duringPush:(()=>Promise<void>)|undefined;
const now=()=>new Date(Date.now()+timeOffset).toISOString();
beforeAll(async()=>{
 const output=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'browser',write:false});
 mf=new Miniflare({modules:true,script:productionCryptoLimit+output.outputFiles[0].text,compatibilityDate:'2026-07-01',d1Databases:['DB'],bindings:{ALLOWED_ORIGIN:origin,COOKIE_SECURE:'false',AUTH_PEPPER:authPepper,BINDING_PEPPER:bindingPepper,LINE_CHANNEL_SECRET:lineSecret,LINE_CHANNEL_ACCESS_TOKEN:randomBytes(32).toString('hex'),LINE_SEND_ENABLED:'true'},outboundService:async(req:any)=>{
  if(req.url.endsWith('/v2/bot/info'))return new Response(JSON.stringify({basicId:'@office-test'}),{status:botStatus});
  calls.push({url:req.url,body:await req.json(),retry:req.headers.get('x-line-retry-key')});if(lineThrows)throw Error('simulated transport failure');if(req.url.endsWith('/message/push'))await duringPush?.();return new Response('{}',{status:lineStatus});
 }});
 db=await mf.getD1Database('DB') as unknown as D1Database;
 const statements=migrationStatements();
 await db.batch(statements.map(sql=>db.prepare(sql)));
},60000);
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
 calls=[];lineStatus=200;lineThrows=false;botStatus=200;timeOffset=0;duringPush=undefined;
 for(const name of ['record_cleanup_jobs','undo_actions','reply_presence','conversation_views','handover_revisions','audit_logs','internal_notes','handovers','messages','conversations','notifications','send_requests','unsend_tombstones','webhook_events','binding_codes','teachers','sessions','rate_limits','admins'])await db.prepare(`DELETE FROM ${name}`).run();
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
const cleanupInput={before:'2026-01-01',contact:true,handovers:true,audits:true};
async function cleanupFixture(){
 const tid=await teacher(true),requests=[randomUUID(),randomUUID()];
 for(const request_id of requests)expect((await cmd('send',{request_id,teacher_ids:[tid],kind:'reply',content:'虛構歷史聯絡',last_inbound_id:null})).status).toBe(200);
 const old='2024-01-01T00:00:00.000Z';
 await db.prepare('UPDATE notifications SET created_at=?,completed_at=?,sent_at=? WHERE teacher_id=?').bind(old,old,old,tid).run();
 await db.prepare('UPDATE messages SET created_at=? WHERE teacher_id=?').bind(old,tid).run();
 const hid=randomUUID();await cmd('handover_create',{id:hid,content:'虛構已完成交接',handover_name:'虛構交接人'});await cmd('handover_complete',{id:hid,expected_version:1,finisher_name:'虛構完成人'});
 await db.prepare('UPDATE handovers SET created_at=?,completed_at=? WHERE id=?').bind(old,old,hid).run();await db.prepare('UPDATE undo_actions SET expires_at=0').run();
 await db.prepare("INSERT INTO audit_logs(id,actor_id,action,created_at) VALUES(?,'test-admin','login',?)").bind(randomUUID(),old).run();
 return {tid,hid,requests};
}
async function cleanupPreview(p=cleanupInput){const response=await cmd('records_cleanup_preview',p);expect(response.status).toBe(200);return await response.json() as any;}
it('清理預覽與執行均要求登入、來源、CSRF 及後端管理員權限',async()=>{
 for(const action of ['records_cleanup_preview','records_cleanup_execute']){
  expect((await cmd(action,cleanupInput,'','')).status).toBe(401);expect((await cmd(action,cleanupInput,cookie,'wrong')).status).toBe(403);expect((await cmd(action,cleanupInput,staffCookie,staffCsrf)).status).toBe(403);
  expect((await request('/command',{action,payload:cleanupInput},cookie,csrf,{Origin:'https://untrusted.example'})).status).toBe(403);
 }
 expect((await get('SELECT count(*) AS n FROM record_cleanup_jobs')).n).toBe(0);
});
it('清理日期與範圍須驗證，預覽不刪資料，錯誤確認文字不能執行',async()=>{
 await cleanupFixture();
 for(const p of [{...cleanupInput,before:'2026-02-30'},{...cleanupInput,before:'2099-01-01'},{...cleanupInput,before:"' OR 1=1 --"},{...cleanupInput,contact:'true'},{...cleanupInput,contact:false,handovers:false,audits:false}])expect((await cmd('records_cleanup_preview',p)).status).toBe(400);
 const p=await cleanupPreview();expect(p.counts).toEqual({messages:1,notifications:1,handovers:1,revisions:2,audits:1});expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(2);
 expect(JSON.stringify(p)).not.toContain('虛構');expect((await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除'})).status).toBe(400);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(2);
});
it('清理原子刪除關聯資料，保留最新訊息、身分及清理稽核，重送不再刪除或發送',async()=>{
 const f=await cleanupFixture(),latest=await get('SELECT id,rowid FROM messages ORDER BY rowid DESC LIMIT 1'),p=await cleanupPreview(),payload={job_id:p.job_id,confirmation:'刪除紀錄'},before=calls.length;
 const results=await Promise.all([cmd('records_cleanup_execute',payload),cmd('records_cleanup_execute',payload)]);expect(results.every(r=>r.status===200)).toBe(true);
 expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(1);expect((await get('SELECT id FROM messages')).id).toBe(latest.id);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(1);
 expect((await get('SELECT count(*) AS n FROM handovers')).n).toBe(0);expect((await get('SELECT count(*) AS n FROM handover_revisions')).n).toBe(0);expect((await get('SELECT count(*) AS n FROM audit_logs WHERE handover_id IS NOT NULL')).n).toBe(0);
 const log=await get("SELECT * FROM audit_logs WHERE action='records_cleanup'");expect(log.actor_id).toBe('test-admin');expect(JSON.parse(log.details).counts).toEqual(p.counts);expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='records_cleanup'")).n).toBe(1);
 expect((await get('SELECT plan_json,state FROM record_cleanup_jobs WHERE id=?',p.job_id)).plan_json).toBeNull();expect((await get('SELECT line_user_id FROM teachers WHERE id=?',f.tid)).line_user_id).toBeTruthy();
 expect((await cmd('send',{request_id:f.requests[0],teacher_ids:[f.tid],kind:'reply',content:'虛構歷史聯絡',last_inbound_id:null})).status).toBe(409);expect(calls).toHaveLength(before);
 const again:any=await(await cmd('records_cleanup_execute',payload)).json();expect(again.already_applied).toBe(true);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(1);
});
it('預覽後交接恢復待處理，整批拒絕刪除；不同管理員與逾時預覽不能使用',async()=>{
 const f=await cleanupFixture(),p=await cleanupPreview();await cmd('handover_reopen',{id:f.hid,expected_version:2});
 const r=await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'});expect(r.status).toBe(409);expect((await r.json() as any).code).toBe('CLEANUP_CHANGED');expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(2);
 await db.prepare("UPDATE record_cleanup_jobs SET actor_id='test-staff' WHERE id=?").bind(p.job_id).run();expect((await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'})).status).toBe(404);
 const next=await cleanupPreview();await db.prepare('UPDATE record_cleanup_jobs SET expires_at=0 WHERE id=?').bind(next.job_id).run();expect((await cmd('records_cleanup_execute',{job_id:next.job_id,confirmation:'刪除紀錄'})).status).toBe(409);
});
it('預覽後老師新訊息抵達，整批拒絕；未完成、傳送中與可復原紀錄均保留',async()=>{
 const f=await cleanupFixture(),p=await cleanupPreview(),t=await get('SELECT line_user_id FROM teachers WHERE id=?',f.tid);await hook([ev('預覽期間的新訊息',t.line_user_id)]);
 expect((await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'})).status).toBe(409);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(2);
 await db.prepare("UPDATE notifications SET status='待領取',send_status='uncertain' WHERE request_id=?").bind(f.requests[0]).run();
 await db.prepare('UPDATE undo_actions SET expires_at=?').bind(Math.floor(Date.now()/1000)+60).run();const next=await cleanupPreview();expect(next.counts.messages).toBe(0);expect(next.counts.notifications).toBe(0);expect(next.counts.handovers).toBe(0);
});
it('清理發生 SQL 失敗時整批回滾，通知、訊息及防重送帳本不部分更動',async()=>{
 await cleanupFixture();const p=await cleanupPreview();await db.prepare("CREATE TRIGGER test_cleanup_abort BEFORE DELETE ON handovers BEGIN SELECT RAISE(ABORT,'test_cleanup_failure'); END").run();
 try{expect((await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'})).status).toBe(500);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(2);expect((await get('SELECT count(*) AS n FROM send_requests WHERE archived_at IS NOT NULL')).n).toBe(0);expect((await get('SELECT state FROM record_cleanup_jobs WHERE id=?',p.job_id)).state).toBe('preview');expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='records_cleanup'")).n).toBe(0);}finally{await db.prepare('DROP TRIGGER test_cleanup_abort').run();}
});
it('聊天清理有分批上限，保留最後訊息與 Webhook 去重，未查看序號不倒退',async()=>{
 const tid=await teacher(true),t=await get('SELECT line_user_id FROM teachers WHERE id=?',tid),first=ev('虛構舊訊息',t.line_user_id),last=ev('保留的最後訊息',t.line_user_id);
 await hook([first]);await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<349) INSERT INTO messages(id,teacher_id,direction,content,created_at) SELECT 'cleanup-msg-'||n,?,'in','舊聊天','2024-01-01T00:00:00.000Z' FROM seq`).bind(tid).run();await hook([last]);await cmd('conversation_status',{teacher_id:tid,status:'已完成'});await db.prepare("UPDATE messages SET created_at='2024-01-01T00:00:00.000Z'").run();
 const latest=await get('SELECT id,rowid FROM messages ORDER BY rowid DESC LIMIT 1');await cmd('conversation_view',{teacher_id:tid,message_id:latest.id});
 const p=await cleanupPreview();expect(p.counts.messages).toBe(300);expect(p.limited).toBe(true);expect((await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'})).status).toBe(200);
 const next=await cleanupPreview();expect(next.counts.messages).toBe(50);await cmd('records_cleanup_execute',{job_id:next.job_id,confirmation:'刪除紀錄'});expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(1);
 await hook([first]);expect((await get('SELECT count(*) AS n FROM messages')).n).toBe(1);await hook([ev('新的回覆',t.line_user_id)]);expect((await get('SELECT max(rowid) AS seq FROM messages')).seq).toBeGreaterThan(latest.rowid);
 const data:any=await(await request('/data')).json();expect(data.inbox.find((i:any)=>i.teacher_id===tid).unread_count).toBe(1);
});
it('以台灣日期界線清理，保留較新紀錄及歷次清理摘要',async()=>{
 const tid=await teacher(true);for(const [key,at]of [['before','2025-12-31T15:59:59.999Z'],['at','2025-12-31T16:00:00.000Z']])await db.prepare("INSERT INTO audit_logs(id,actor_id,action,created_at) VALUES(?,'test-admin','login',?)").bind(key,at).run();
 await db.prepare("INSERT INTO audit_logs(id,actor_id,action,created_at) VALUES('old-cleanup','test-admin','records_cleanup','2024-01-01T00:00:00.000Z')").run();
 const p=await cleanupPreview({...cleanupInput,contact:false,handovers:false});expect(p.counts.audits).toBe(1);await cmd('records_cleanup_execute',{job_id:p.job_id,confirmation:'刪除紀錄'});expect(await get("SELECT id FROM audit_logs WHERE id='before'")).toBeNull();expect(await get("SELECT id FROM audit_logs WHERE id='at'")).toBeTruthy();expect(await get("SELECT id FROM audit_logs WHERE id='old-cleanup'")).toBeTruthy();expect(await get('SELECT id FROM teachers WHERE id=?',tid)).toBeTruthy();
});
it('預覽登入指引僅公開正式網址與版本，不暴露憑證且不放寬登入及資料權限',async()=>{
 const before=await get("SELECT count(*) AS n FROM audit_logs WHERE action='login'");
 const info=await request('/public-info',undefined,'','',{Origin:'https://preview.example'});expect(info.status).toBe(200);
 const data:any=await info.json();expect(data.origin).toBe(origin);expect(data.version).toBe(APP_VERSION);expect(Object.keys(data).sort()).toEqual(['name','origin','version']);
 const serialized=JSON.stringify(data);expect(serialized).not.toContain(authPepper);expect(serialized).not.toContain(bindingPepper);expect(serialized).not.toContain(lineSecret);
 const denied=await request('/login',credentials,'','',{Origin:'https://preview.example'});expect(denied.status).toBe(403);expect((await denied.json() as any).code).toBe('ORIGIN_NOT_ALLOWED');
 expect((await request('/data',undefined,cookie,csrf,{Origin:'https://preview.example'})).status).toBe(403);expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='login'")).n).toBe(before.n);
});
it('通知歷史可查超過 500 筆的舊紀錄，支援篩選與真正資料庫分頁且不洩漏 LINE 身分',async()=>{
 const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid),recent=new Date().toISOString();
 await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<530)
 INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,send_status,status,created_at,sent_at)
 SELECT 'archive-'||n,'archive-request-'||n,?,'mail',CASE WHEN n=1 THEN '較早的通知100%_測試' ELSE '一般通知'||n END,'test-admin',1,'archive-retry-'||n,'accepted','待領取',
 CASE WHEN n=1 THEN '2025-11-16T16:01:00.000Z' WHEN n=2 THEN '2025-11-16T15:59:00.000Z' ELSE ? END,
 CASE WHEN n=1 THEN '2025-11-16T16:01:00.000Z' WHEN n=2 THEN '2025-11-16T15:59:00.000Z' ELSE ? END FROM seq`).bind(tid,recent,recent).run();
 const snapshot:any=await(await request('/data')).json();expect(snapshot.notifications).toHaveLength(500);expect(snapshot.notifications.some((n:any)=>n.id==='archive-1')).toBe(false);
 const query=async(filters:any={},c=cookie,token=csrf)=>request('/notifications/query',filters,c,token);
 const first:any=await(await query({},staffCookie,staffCsrf)).json();expect(first.total).toBe(530);expect(first.notices).toHaveLength(10);expect(first.pages).toBe(53);
 const old:any=await(await query({query:'100%_',teacher:tid,from:'2025-11-17',to:'2025-11-17'})).json();expect(old.total).toBe(1);expect(old.notices[0].id).toBe('archive-1');
 expect(JSON.stringify(old)).not.toContain(t.line_user_id);expect(old.notices[0].retry_key).toBeUndefined();expect(old.notices[0].operation_token).toBeUndefined();
 const last:any=await(await query({page:'999'})).json();expect(last.page).toBe(53);expect(last.notices).toHaveLength(10);
 const empty:any=await(await query({send:'failed'})).json();expect(empty.total).toBe(0);expect(empty.notices).toHaveLength(0);
});
it('通知查詢驗證登入、CSRF、來源及查詢格式，錯誤條件不能當 SQL 執行',async()=>{
 expect((await request('/notifications/query',{},'','')).status).toBe(401);expect((await request('/notifications/query',{},cookie,'wrong')).status).toBe(403);
 expect((await request('/notifications/query',{},cookie,csrf,{Origin:'https://untrusted.example'})).status).toBe(403);
 for(const body of [{page:'0'},{page:'1 OR 1=1'},{status:'不支援'},{send:'不支援'},{from:'2026-02-30'},{from:'2026-11-18',to:'2026-11-17'},{query:'a'.repeat(201)},{query:123}])expect((await request('/notifications/query',body)).status).toBe(400);
 const literal:any=await(await request('/notifications/query',{query:"' OR 1=1 --"})).json();expect(literal.total).toBe(0);
});
it('未查看依登入人員分開計算，僅更新實際查看的訊息，不倒退或清掉後續訊息',async()=>{
 const tid=await teacher(true),other=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);
 await hook([ev('第一則',t.line_user_id)]);const first=await get("SELECT id FROM messages WHERE teacher_id=?",tid);
 const inbox=async(c=cookie,token=csrf)=>(await (await request('/data',undefined,c,token)).json() as any).inbox.find((i:any)=>i.teacher_id===tid);
 expect((await inbox()).unread_count).toBe(1);
 expect((await cmd('conversation_view',{teacher_id:other,message_id:first.id})).status).toBe(409);
 await cmd('conversation_view',{teacher_id:tid,message_id:first.id});expect((await inbox()).unread_count).toBe(0);expect((await inbox(staffCookie,staffCsrf)).unread_count).toBe(1);
 await hook([ev('第二則',t.line_user_id)]);await cmd('conversation_view',{teacher_id:tid,message_id:first.id});expect((await inbox()).unread_count).toBe(1);
 const last=await get("SELECT id FROM messages WHERE teacher_id=? ORDER BY rowid DESC LIMIT 1",tid);await cmd('conversation_view',{teacher_id:tid,message_id:last.id});await cmd('conversation_view',{teacher_id:tid,message_id:first.id});expect((await inbox()).unread_count).toBe(0);
 expect((await get('SELECT status FROM conversations WHERE teacher_id=?',tid)).status).toBe('待回覆');expect(calls).toHaveLength(0);
});
it('正在回覆提示不儲存草稿，同一人不同分頁獨立，停用及逾期自動隱藏',async()=>{
 const tid=await teacher(true),one=randomUUID(),two=randomUUID();
 expect((await cmd('presence',{teacher_id:tid,client_id:one,typing:true},staffCookie,staffCsrf)).status).toBe(200);
 await cmd('presence',{teacher_id:tid,client_id:two,typing:true},staffCookie,staffCsrf);
 await cmd('presence',{teacher_id:tid,client_id:one,typing:false},staffCookie,staffCsrf);expect((await get('SELECT count(*) AS n FROM reply_presence')).n).toBe(1);
 let data:any=await(await request('/data')).json();expect(data.presence[0].display_name).toBe('測試行政人員');expect(data.presence[0].client_id).toBeUndefined();
 await db.prepare('UPDATE admins SET active=0 WHERE id=?').bind('test-staff').run();data=await(await request('/data')).json();expect(data.presence).toHaveLength(0);
 await db.prepare('UPDATE reply_presence SET expires_at=0').run();await request('/data');expect((await get('SELECT count(*) AS n FROM reply_presence')).n).toBe(0);expect(calls).toHaveLength(0);
});
it('領取完成可以快速復原，限原操作人且保留稽核；已使用不能再復原',async()=>{
 const tid=await teacher(true);await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'parcel',content:'測試包裹'});
 const n=await get('SELECT * FROM notifications'),response=await cmd('complete',{id:n.id,status:'已完成',expected_version:1},staffCookie,staffCsrf),result:any=await response.json();expect(result.undo.id).toBeTruthy();
 expect((await cmd('undo',{id:result.undo.id})).status).toBe(404);
 expect((await cmd('undo',{id:result.undo.id},staffCookie,staffCsrf)).status).toBe(200);
 const restored=await get('SELECT * FROM notifications');expect(restored.status).toBe('待領取');expect(restored.completed_at).toBeNull();expect(restored.completed_by).toBeNull();expect(restored.version).toBe(3);
 expect((await cmd('undo',{id:result.undo.id},staffCookie,staffCsrf)).status).toBe(409);expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='undo'")).n).toBe(1);expect(calls).toHaveLength(1);
});
it('紀錄被其他人更新或快速復原過期，拒絕覆蓋；過期版本的完成也拒絕',async()=>{
 const tid=await teacher(true);await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'mail',content:'測試信件'});
 const n=await get('SELECT * FROM notifications'),result:any=await(await cmd('complete',{id:n.id,status:'已完成',expected_version:1})).json();
 expect((await cmd('complete',{id:n.id,status:'待領取',expected_version:1})).status).toBe(409);
 await cmd('complete',{id:n.id,status:'待領取',expected_version:2},staffCookie,staffCsrf);expect((await cmd('undo',{id:result.undo.id})).status).toBe(409);
 const next:any=await(await cmd('complete',{id:n.id,status:'已完成',expected_version:3})).json();await db.prepare('UPDATE undo_actions SET expires_at=0 WHERE id=?').bind(next.undo.id).run();expect((await cmd('undo',{id:next.undo.id})).status).toBe(409);expect((await get('SELECT status FROM notifications')).status).toBe('已完成');
});
it('交接快速復原保留完成人及修改前後版本，之後仍能重新完成',async()=>{
 const hid=randomUUID();await cmd('handover_create',{id:hid,content:'測試交接',handover_name:'測試交接人'});
 const done:any=await(await cmd('handover_complete',{id:hid,expected_version:1,finisher_name:'測試完成人'})).json();
 expect((await cmd('undo',{id:done.undo.id})).status).toBe(200);const h=await get('SELECT * FROM handovers');expect(h.completed_at).toBeNull();expect(h.finisher_name).toBeNull();expect(h.version).toBe(3);
 const rev=await get("SELECT * FROM handover_revisions WHERE action='handover_undo'");expect(JSON.parse(rev.before_data).finisher_name).toBe('測試完成人');expect(JSON.parse(rev.after_data).finisher_name).toBeNull();
 expect((await cmd('handover_complete',{id:hid,expected_version:3,finisher_name:'再次完成者'})).status).toBe(200);
});
it('查看、輸入提示與復原 API 必須登入並通過 CSRF',async()=>{
 for(const action of ['presence','conversation_view','undo']){
  expect((await cmd(action,{},'','')).status).toBe(401);expect((await cmd(action,{},cookie,'wrong')).status).toBe(403);
 }
});
it('個別教師的較早訊息與待領取可單獨載入，不受全站最近 500 筆限制',async()=>{
 const tid=await teacher(true),other=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);
 await hook([ev('較早的測試對話',t.line_user_id)]);await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'mail',content:'較早信件'});
 await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<501) INSERT INTO messages(id,teacher_id,direction,content,created_at) SELECT 'later-'||n,?,'in','其他教師後續訊息',? FROM seq`).bind(other,new Date(Date.now()+1000).toISOString()).run();
 const snapshot:any=await(await request('/data')).json();expect(snapshot.messages.some((m:any)=>m.teacher_id===tid)).toBe(false);
 const r=await request('/conversation?teacher_id='+tid);expect(r.status).toBe(200);const data:any=await r.json();expect(data.messages.some((m:any)=>m.content==='較早的測試對話')).toBe(true);expect(data.pickups[0].kind).toBe('mail');expect(JSON.stringify(data)).not.toContain(t.line_user_id);expect(data.messages[0].line_source_hash).toBeUndefined();
 expect((await request('/conversation?teacher_id='+tid,undefined,'')).status).toBe(401);
});
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
  it('回覆成功自動完成對話與這筆回覆，保留包裹待領取及經辦紀錄；重試不重複結案',async()=>{
   const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);
   await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'parcel',content:'包裹測試'});
   await hook([ev('收到，稍後領取',t.line_user_id)]);
   const inbound=await get("SELECT id FROM messages WHERE direction='in'");
   const payload={request_id:randomUUID(),teacher_ids:[tid],kind:'reply',content:'好的',complete_conversation:true,last_inbound_id:inbound.id};
   const response=await cmd('send',payload,staffCookie,staffCsrf);expect(response.status).toBe(200);expect((await response.json() as any).results[0].send_status).toBe('accepted');
   expect((await get('SELECT status FROM conversations')).status).toBe('已完成');
   const n=await get("SELECT * FROM notifications WHERE kind='reply'");expect(n.status).toBe('已完成');expect(n.completed_by).toBe('test-staff');expect(n.completed_at).toBeTruthy();
   expect((await get("SELECT status FROM notifications WHERE kind='parcel'")).status).toBe('待領取');
   await hook([ev('追加問題',t.line_user_id)]);expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   await cmd('send',payload,staffCookie,staffCsrf);expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='reply_complete'")).n).toBe(1);
   expect((await cmd('send',{...payload,complete_conversation:false},staffCookie,staffCsrf)).status).toBe(409);
  });
  it('可取消自動完成；沒有入站訊息的主動回覆亦可完成對話',async()=>{
   const tid=await teacher(true),payload={teacher_ids:[tid],kind:'reply',content:'測試',last_inbound_id:null};
   await cmd('send',{...payload,request_id:randomUUID(),complete_conversation:true});expect((await get('SELECT status FROM conversations')).status).toBe('已完成');
   await cmd('send',{...payload,request_id:randomUUID(),complete_conversation:false});expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   expect((await cmd('send',{...payload,request_id:randomUUID(),complete_conversation:'false'})).status).toBe(400);
  });
  it('預覽後或 LINE 發送期間收到新訊息，均保留待回覆；不自動結案其他通知',async()=>{
   const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);
   await hook([ev('第一題',t.line_user_id)]);const old=await get("SELECT id FROM messages WHERE direction='in'");
   await hook([ev('第二題',t.line_user_id)]);
   const payload={teacher_ids:[tid],kind:'reply',content:'回答第一題',complete_conversation:true,last_inbound_id:old.id};
   await cmd('send',{...payload,request_id:randomUUID()});expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   const latest=await get("SELECT id FROM messages WHERE direction='in' ORDER BY rowid DESC LIMIT 1");
   duringPush=async()=>{expect((await hook([ev('第三題',t.line_user_id)])).status).toBe(200);};
   await cmd('send',{...payload,request_id:randomUUID(),last_inbound_id:latest.id});expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='reply_complete'")).n).toBe(0);
  });
  it('回覆被 LINE 拒絕或結果未明不結案；舊版前端不帶查看範圍時也不誤結案',async()=>{
   const tid=await teacher(true),t=await get('SELECT * FROM teachers WHERE id=?',tid);await hook([ev('尚待處理',t.line_user_id)]);
   const m=await get("SELECT id FROM messages WHERE direction='in'"),payload={teacher_ids:[tid],kind:'reply',content:'測試回覆',complete_conversation:true,last_inbound_id:m.id};
   for(const status of [401,429,503]){
    lineStatus=status;const response=await cmd('send',{...payload,request_id:randomUUID()});const result:any=await response.json();expect(result.results[0].error_code).toBe('line_http_'+status);expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
   }
   expect((await get("SELECT count(*) AS n FROM notifications WHERE status='已完成'")).n).toBe(0);
   lineStatus=200;await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'reply',content:'舊版前端回覆'});expect((await get('SELECT status FROM conversations')).status).toBe('待回覆');
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
it('舊密碼格式對所有帳號回相同維護提示，避免 500 及帳號存在資訊差異',async()=>{
 await db.prepare("UPDATE admins SET password_hash=replace(password_hash,'$100000$','$600000$') WHERE id='test-admin'").run();
 const known=await request('/login',credentials,'',''),unknown=await request('/login',{username:'unknown-'+randomUUID(),password:randomBytes(24).toString('hex')},'','');
 expect(known.status).toBe(503);expect(unknown.status).toBe(503);expect(await known.json()).toEqual(await unknown.json());
});
it('維護修復保留原帳號與教師，撤銷 Session 並恢復登入',async()=>{
 const {passwordRepairSql}=await import('../scripts/admin-password.mjs');const tid=await teacher(true),before=await get('SELECT id,username,role,active FROM admins WHERE id=?','test-admin');
 await db.prepare("UPDATE admins SET password_hash=replace(password_hash,'$100000$','$600000$') WHERE id='test-admin'").run();
 const sql=passwordRepairSql(credentials.username,credentials.password,authPepper).replace(/--[^\n]*/g,'');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 expect(await get('SELECT id,username,role,active FROM admins WHERE id=?','test-admin')).toEqual(before);expect((await get('SELECT id FROM teachers WHERE id=?',tid)).id).toBe(tid);
 expect((await request('/session')).status).toBe(401);expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='password_repair'")).n).toBe(1);const repaired=await login();expect((await request('/session',undefined,repaired.cookie,repaired.csrf)).status).toBe(200);
});
it('資料庫未套用完整結構時回安全的明確提示，不洩漏 SQL',async()=>{
 await db.prepare('ALTER TABLE rate_limits RENAME TO temporary_rate_limits').run();
 try{const response=await request('/login',credentials,'','');expect(response.status).toBe(503);const body:any=await response.json();expect(body.code).toBe('DATABASE_SCHEMA_MISSING');expect(JSON.stringify(body)).not.toContain('SELECT');}finally{await db.prepare('ALTER TABLE temporary_rate_limits RENAME TO rate_limits').run();}
});

it('個人綁定連結使用官方帳號識別並預填同一個一次性碼，失敗時可手動綁定',async()=>{
 const tid=await teacher(),r=await cmd('issue_code',{teacher_id:tid}),body:any=await r.json();
 expect(body.binding_link).toBe('https://line.me/R/oaMessage/%40office-test/?'+body.code);
 expect(JSON.stringify(body)).not.toContain(bindingPepper);expect((await get('SELECT code_hash FROM binding_codes WHERE teacher_id=?',tid)).code_hash).not.toBe(body.code);
 const other=await teacher();botStatus=401;const fallback:any=await(await cmd('issue_code',{teacher_id:other})).json();expect(fallback.binding_link).toBeNull();expect(fallback.code).toHaveLength(12);
 expect((await hook([ev(body.code)])).status).toBe(200);expect((await get('SELECT bound_at FROM teachers WHERE id=?',tid)).bound_at).toBeTruthy();
});
async function pickupNotices(tid:string,count=2){
 for(let i=0;i<count;i++){const r=await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:i%2?'mail':'parcel',content:'虛構領件 '+i,duplicate_confirmed:true});expect(r.status).toBe(200);}
 return (await db.prepare('SELECT id,version FROM notifications WHERE teacher_id=? ORDER BY id').bind(tid).all<any>()).results;
}
it('多筆領件驗證相同教師及版本，保留完成經辦、逐筆稽核並可整批一次復原',async()=>{
 const tid=await teacher(true),items=(await pickupNotices(tid)).map(n=>({id:n.id,expected_version:n.version})),payload={request_id:randomUUID(),teacher_id:tid,items};calls=[];
 const r=await cmd('pickup_many',payload,staffCookie,staffCsrf);expect(r.status).toBe(200);const body:any=await r.json();expect(body.undo.ids).toHaveLength(2);
 expect((await get("SELECT count(*) AS n FROM notifications WHERE status='已完成' AND completed_by='test-staff' AND completed_at IS NOT NULL")).n).toBe(2);
 expect((await get("SELECT count(*) AS n FROM audit_logs WHERE action='pickup_many'")).n).toBe(2);expect(calls).toHaveLength(0);
 expect((await cmd('pickup_many',payload,staffCookie,staffCsrf)).status).toBe(200);expect((await get('SELECT count(*) AS n FROM undo_actions')).n).toBe(2);
 expect((await cmd('undo_many',{request_id:randomUUID(),ids:body.undo.ids})).status).toBe(409);
 const undo={request_id:randomUUID(),ids:body.undo.ids};expect((await cmd('undo_many',undo,staffCookie,staffCsrf)).status).toBe(200);expect((await cmd('undo_many',undo,staffCookie,staffCsrf)).status).toBe(200);
 expect((await get("SELECT count(*) AS n FROM notifications WHERE status='待領取' AND completed_at IS NULL AND completed_by IS NULL")).n).toBe(2);
 expect((await cmd('pickup_many',payload,staffCookie,staffCsrf)).status).toBe(200);expect((await get("SELECT count(*) AS n FROM notifications WHERE status='已完成'")).n).toBe(0);
});
it('多筆領件任一筆過時、跨教師或格式異常時整批不變更，未登入與 CSRF 仍拒絕',async()=>{
 const tid=await teacher(true),other=await teacher(true),notices=await pickupNotices(tid),make=()=>({request_id:randomUUID(),teacher_id:tid,items:notices.map(n=>({id:n.id,expected_version:n.version}))});
 const stale=make();stale.items[1].expected_version=999;expect((await cmd('pickup_many',stale)).status).toBe(409);
 expect((await cmd('pickup_many',{...make(),teacher_id:other})).status).toBe(409);expect((await cmd('pickup_many',{...make(),items:[make().items[0],make().items[0]]})).status).toBe(400);
 expect((await cmd('pickup_many',make(),'','')).status).toBe(401);expect((await cmd('pickup_many',make(),cookie,'wrong')).status).toBe(403);
 expect((await get("SELECT count(*) AS n FROM notifications WHERE status='待領取'")).n).toBe(2);expect((await get('SELECT count(*) AS n FROM undo_actions')).n).toBe(0);
});
it('整批復原任一筆被同事更新或逾期便全部拒絕，不覆蓋其他資料',async()=>{
 const tid=await teacher(true),items=(await pickupNotices(tid)).map(n=>({id:n.id,expected_version:n.version}));
 const r:any=await(await cmd('pickup_many',{request_id:randomUUID(),teacher_id:tid,items})).json();
 await cmd('complete',{id:items[0].id,status:'待回覆',expected_version:2});expect((await cmd('undo_many',{request_id:randomUUID(),ids:r.undo.ids})).status).toBe(409);
 expect((await get("SELECT status FROM notifications WHERE id=?",items[1].id)).status).toBe('已完成');expect((await get('SELECT count(*) AS n FROM undo_actions WHERE used_at IS NOT NULL')).n).toBe(0);
 await db.prepare('UPDATE undo_actions SET expires_at=0').run();expect((await cmd('undo_many',{request_id:randomUUID(),ids:[r.undo.ids[1]]})).status).toBe(409);
});
it('已有待領取須明確確認才發新通知；確認後重試不重複，其他聯絡不受影響',async()=>{
 const tid=await teacher(true);await pickupNotices(tid,1);calls=[];
 const pre:any=await(await cmd('notification_preflight',{teacher_ids:[tid]})).json();expect(pre.pending[0].count).toBe(1);
 const payload={request_id:randomUUID(),teacher_ids:[tid],kind:'mail',content:'新信件'};
 const blocked=await cmd('send',payload);expect(blocked.status).toBe(409);expect((await blocked.json() as any).code).toBe('DUPLICATE_NOTICE');expect(calls).toHaveLength(0);
 expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(1);expect(await get('SELECT id FROM send_requests WHERE id=?',payload.request_id)).toBeNull();
 expect((await cmd('send',{...payload,duplicate_confirmed:true})).status).toBe(200);expect((await cmd('send',{...payload,duplicate_confirmed:true})).status).toBe(200);expect(calls).toHaveLength(1);
 expect((await cmd('send',{request_id:randomUUID(),teacher_ids:[tid],kind:'contact',content:'其他行政聯絡'})).status).toBe(200);
});
it('兩位行政同時發送相同教師的新領件通知時，未確認的第二批被擋下',async()=>{
 const tid=await teacher(true),send=()=>({request_id:randomUUID(),teacher_ids:[tid],kind:'parcel',content:'同時測試'});
 const results=await Promise.all([cmd('send',send()),cmd('send',send(),staffCookie,staffCsrf)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect((await get('SELECT count(*) AS n FROM notifications')).n).toBe(1);
});
it('交接搜尋查詢完整資料庫，依台灣完成日期、交接人及完成人篩選並驗證權限格式',async()=>{
 const now=new Date().toISOString();await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1010) INSERT INTO handovers(id,content,created_by,creator_name,handover_name,created_at,completed_at,completed_by,finisher_name) SELECT 'history-'||n,CASE WHEN n=1 THEN '較早交接100%_' ELSE '一般交接'||n END,'test-admin','管理員',CASE WHEN n=1 THEN '交接甲' ELSE '其他交接人' END,?,CASE WHEN n=1 THEN '2025-11-16T16:01:00.000Z' ELSE ? END,'test-admin',CASE WHEN n=1 THEN '完成乙' ELSE '其他完成人' END FROM seq`).bind(now,now).run();
 for(const query of ['100%_','交接甲','完成乙']){const r=await cmd('handover_history',{page:1,period:'date',date:'2025-11-17',query},staffCookie,staffCsrf);expect(r.status).toBe(200);const body:any=await r.json();expect(body.total).toBe(1);expect(body.items[0].id).toBe('history-1');}
 const page:any=await(await cmd('handover_history',{page:2,period:'today'})).json();expect(page.items).toHaveLength(5);expect(page.total).toBe(1009);
 expect((await cmd('handover_history',{page:1,period:'date',date:'2026-02-30'})).status).toBe(400);expect((await cmd('handover_history',{page:1,period:'today'},'','')).status).toBe(401);
});
it('一百筆領件與復原使用固定數量查詢，不超過 D1 批次參數上限',async()=>{
 const tid=await teacher(true),now=new Date().toISOString();
 await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100) INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,send_status,status,created_at,sent_at) SELECT 'bulk-pickup-'||n,'bulk-request-'||n,?,'mail','虛構百筆測試','test-admin',1,'bulk-retry-'||n,'accepted','待領取',?,? FROM seq`).bind(tid,now,now).run();
 const items=Array.from({length:100},(_,i)=>({id:'bulk-pickup-'+(i+1),expected_version:1}));
 const r=await cmd('pickup_many',{request_id:randomUUID(),teacher_id:tid,items});expect(r.status).toBe(200);const body:any=await r.json();expect(body.undo.ids).toHaveLength(100);expect((await get("SELECT count(*) AS n FROM notifications WHERE status='已完成'")).n).toBe(100);
 const undo=await cmd('undo_many',{request_id:randomUUID(),ids:body.undo.ids});expect(undo.status).toBe(200);expect((await get("SELECT count(*) AS n FROM notifications WHERE status='待領取'")).n).toBe(100);expect(calls).toHaveLength(0);
});
it('自填待領物品正確儲存、聊天與歷史顯示，單筆及多筆領取可復原',async()=>{
 const tid=await teacher(true),payload={request_id:randomUUID(),teacher_ids:[tid],kind:'pickup',pickup_name:'借用器材',content:'請來辦公室領取',duplicate_confirmed:true};
 const r=await cmd('send',payload,staffCookie,staffCsrf);expect(r.status).toBe(200);const n=await get('SELECT * FROM notifications WHERE request_id=?',payload.request_id);expect(n.kind).toBe('custom');expect(n.pickup_name).toBe('借用器材');expect(n.status).toBe('待領取');
 expect(calls.at(-1)!.body.messages[0].text).toBe('請來辦公室領取');const c:any=await(await request('/conversation?teacher_id='+tid)).json();expect(c.pickups[0].pickup_name).toBe('借用器材');
 const history:any=await(await request('/notifications/query',{query:'借用器材'})).json();expect(history.total).toBe(1);expect(history.notices[0].pickup_name).toBe('借用器材');
 const done:any=await(await cmd('complete',{id:n.id,status:'已完成',expected_version:1})).json();expect(done.undo.id).toBeTruthy();await cmd('undo',{id:done.undo.id});
 const current=await get('SELECT * FROM notifications WHERE id=?',n.id),batch:any=await(await cmd('pickup_many',{request_id:randomUUID(),teacher_id:tid,items:[{id:n.id,expected_version:current.version}]})).json();expect(batch.undo.ids).toHaveLength(1);expect((await cmd('undo_many',{request_id:randomUUID(),ids:batch.undo.ids})).status).toBe(200);
});
it('自填物品名稱必填、限八十字、不能混入一般訊息；也要通過綁定與重複通知檢查',async()=>{
 const tid=await teacher(true),base={request_id:randomUUID(),teacher_ids:[tid],kind:'pickup',content:'測試文字'};
 for(const pickup_name of [undefined,'','   ','物'.repeat(81),123])expect((await cmd('send',{...base,pickup_name})).status).toBe(400);
 expect((await cmd('send',{...base,kind:'custom',pickup_name:'不可混用'})).status).toBe(400);
 expect((await cmd('send',{...base,pickup_name:'教材'})).status).toBe(200);
 const duplicate=await cmd('send',{...base,request_id:randomUUID(),pickup_name:'另一件'});expect(duplicate.status).toBe(409);expect((await duplicate.json() as any).code).toBe('DUPLICATE_NOTICE');
 const pending:any=await(await cmd('notification_preflight',{teacher_ids:[tid]})).json();expect(pending.pending[0].count).toBe(1);
 const unbound=await teacher();expect((await cmd('send',{...base,request_id:randomUUID(),teacher_ids:[unbound],pickup_name:'教材'})).status).toBe(409);
 expect((await cmd('send',{...base,pickup_name:'更改名稱',duplicate_confirmed:true})).status).toBe(409);
});
it('輕量版本檢查有 Session 與來源保護，無變更回 304 且不產生操作或限流寫入',async()=>{
 const data=await request('/data'),tag=data.headers.get('etag')!,before=await get('SELECT version FROM system_meta WHERE id=1'),audits=await get('SELECT count(*) AS n FROM audit_logs'),rates=await get('SELECT count(*) AS n FROM rate_limits');
 const r=await request('/changes',undefined,cookie,csrf,{'If-None-Match':tag});expect(r.status).toBe(304);expect(await r.text()).toBe('');expect((await get('SELECT version FROM system_meta WHERE id=1')).version).toBe(before.version);expect((await get('SELECT count(*) AS n FROM audit_logs')).n).toBe(audits.n);expect((await get('SELECT count(*) AS n FROM rate_limits')).n).toBe(rates.n);
 const tid=await teacher(true),changed=await request('/changes',undefined,cookie,csrf,{'If-None-Match':tag});expect(changed.status).toBe(200);expect(await changed.json()).toEqual({changed:true});
 expect((await request('/changes',undefined,'','')).status).toBe(401);expect((await request('/changes',undefined,cookie,csrf,{Origin:'https://other.example'})).status).toBe(403);
 const t=await get('SELECT * FROM teachers WHERE id=?',tid),v=t.conversation_version;await hook([ev('新文字',t.line_user_id)]);expect((await get('SELECT conversation_version FROM teachers WHERE id=?',tid)).conversation_version).toBeGreaterThan(v);
});

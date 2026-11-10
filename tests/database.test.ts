import{PGlite}from'@electric-sql/pglite';
import{readFileSync}from'node:fs';
import{beforeAll,afterAll,describe,it,expect}from'vitest';
let db:PGlite;
const admin='00000000-0000-4000-8000-000000000001',staff='00000000-0000-4000-8000-000000000002', outsider='00000000-0000-4000-8000-000000000003';
let seq=0;
const cmd=async(actor:string,action:string,payload:any)=> (await db.query<{v:any}>('select public.office_command($1,$2,$3::jsonb) v',[actor,action,JSON.stringify(payload)])).rows[0].v;
const teacher=async()=> (await cmd(admin,'teacher_save',{name:'虛構測試教師',department:'測試',notes:''})).teacher_id as string;
const issue=(t:string,d:string)=>cmd(admin,'issue_code',{teacher_id:t,digest:d});
const event=async(uid:string,digest:string,extra:any={})=>(await db.query<{v:any}>('select public.line_event($1::jsonb,$2) v',[JSON.stringify({webhookEventId:'e'+(++seq),type:'message',source:{type:'user',userId:uid},message:{id:'m'+seq,type:'text',text:'測試回覆'},...extra}),digest])).rows[0].v;
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create publication supabase_realtime;insert into auth.users values('${admin}'),('${staff}'),('${outsider}');`);await db.exec(readFileSync('supabase/migrations/20261110023211_office_schema.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261110062132_handovers.sql','utf8'));await db.exec(`insert into public.staff values('${admin}','測試管理員','admin',true),('${staff}','測試行政','staff',true)`);},30000);
afterAll(async()=>{await db?.close();});
describe('真實 PostgreSQL 引擎：交易、綁定、權限與通知',()=>{
 it('有效碼成功綁定、用後刪除並留下時間與稽核',async()=>{const t=await teacher();await issue(t,'valid');expect((await event('Uvalid','valid')).reply).toContain('身分綁定成功');expect((await db.query('select * from private.binding_codes where teacher_id=$1',[t])).rows).toHaveLength(0);expect((await db.query<any>('select bound_at from public.teachers where id=$1',[t])).rows[0].bound_at).toBeTruthy();});
 it('已過期碼不綁定',async()=>{const t=await teacher();await issue(t,'expired');await db.query("update private.binding_codes set expires_at=now()-interval '1 second' where teacher_id=$1",[t]);expect((await event('Uexpired','expired')).reply).toContain('過期');expect((await db.query('select * from private.bindings where teacher_id=$1',[t])).rows).toHaveLength(0);});
 it('重新產生使舊碼失效',async()=>{const t=await teacher();await issue(t,'old');await issue(t,'new');expect((await event('Unew','old')).reply).toContain('無效');expect((await event('Unew','new')).reply).toContain('成功');});
 it('單次使用：第二個 LINE 帳號不得重複綁定',async()=>{const t=await teacher();await issue(t,'once');await event('Uonce1','once');expect((await event('Uonce2','once')).reply).toContain('無效');expect((await db.query('select * from private.bindings where teacher_id=$1',[t])).rows).toHaveLength(1);await expect(issue(t,'again')).rejects.toThrow();});
 it('同一 LINE 帳號不會綁定第二位教師',async()=>{const a=await teacher(),b=await teacher();await issue(a,'a');await issue(b,'b');await event('Utwo','a');await event('Utwo','b');expect((await db.query('select * from private.bindings where line_user_id=$1',['Utwo'])).rows).toHaveLength(1);expect((await db.query('select * from private.bindings where teacher_id=$1',[b])).rows).toHaveLength(0);});
 it('錯誤次數超過每小時 10 次被阻擋',async()=>{for(let i=0;i<10;i++)await event('Uguess','bad');expect((await event('Uguess','bad')).reply).toContain('次數過多');});
 it('一般行政與未知帳號不能管理綁定；停用權限立即生效',async()=>{await expect(cmd(staff,'teacher_save',{name:'越權'})).rejects.toThrow('權限');await expect(cmd(outsider,'unbind',{teacher_id:await teacher()})).rejects.toThrow('未授權');await db.query('update public.staff set active=false where id=$1',[staff]);await expect(cmd(staff,'complete',{})).rejects.toThrow('未授權');await db.query('update public.staff set active=true where id=$1',[staff]);});
 it('停用教師無法產生綁定碼',async()=>{const t=await teacher();await cmd(admin,'teacher_save',{teacher_id:t,name:'停用測試',active:false});await expect(issue(t,'disabled')).rejects.toThrow();});
 it('重複 Webhook ID 只儲存一次',async()=>{const t=await teacher();await issue(t,'dup');await event('Udup','dup');const e={webhookEventId:'fixed-event',message:{id:'fixed-message',type:'text',text:'您好'}};await event('Udup','none',e);expect((await event('Udup','none',e)).duplicate).toBe(true);expect((await db.query('select * from public.messages where line_message_id=$1',['fixed-message'])).rows).toHaveLength(1);});
 it('群組事件不建立教師綁定',async()=>{const t=await teacher();await issue(t,'group');expect((await event('Ugroup','group',{source:{type:'group',userId:'Ugroup',groupId:'G'}})).ignored).toBe(true);});
 it('收回事件可早於訊息，且刪除原文',async()=>{const t=await teacher();await issue(t,'unsend');await event('Uunsend','unsend');await event('Uunsend','none',{type:'unsend',unsend:{messageId:'later'}});await event('Uunsend','none',{message:{id:'later',type:'text',text:'不應留存'}});const m=(await db.query<any>('select * from public.messages where line_message_id=$1',['later'])).rows[0];expect(m.withdrawn).toBe(true);expect(m.content).not.toContain('不應留存');});
 it('未綁定不可發送；同批有未綁定對象則整批回滾',async()=>{const t=await teacher(),b=await teacher();await issue(t,'batch');await event('Ubatch','batch');const req=crypto.randomUUID();await expect(cmd(staff,'send',{teacher_ids:[t,b],content:'測試',kind:'mail',request_id:req})).rejects.toThrow();expect((await db.query('select * from public.notifications where request_id=$1',[req])).rows).toHaveLength(0);});
 it('請求防重複、發送鎖定、解除綁定保護、API 接受與完成狀態',async()=>{const t=await teacher();await issue(t,'send');await event('Usend','send');const payload={teacher_ids:[t],content:'通知測試',kind:'mail',request_id:crypto.randomUUID()};const ids=await cmd(staff,'send',payload);expect(await cmd(staff,'send',payload)).toEqual(ids);const claim=(await db.query<any>('select public.claim_delivery($1) v',[ids[0]])).rows[0].v;expect(claim.to).toBe('Usend');expect((await db.query<any>('select public.claim_delivery($1) v',[ids[0]])).rows[0].v).toBeNull();await expect(cmd(admin,'unbind',{teacher_id:t})).rejects.toThrow('傳送中');await db.query('select public.finish_delivery($1,$2,$3)',[ids[0],'accepted',null]);await cmd(staff,'complete',{id:ids[0],status:'已完成'});const n=(await db.query<any>('select * from public.notifications where id=$1',[ids[0]])).rows[0];expect(n.send_status).toBe('accepted');expect(n.completed_by).toBe(staff);await cmd(admin,'unbind',{teacher_id:t});expect((await db.query('select * from private.bindings where teacher_id=$1',[t])).rows).toHaveLength(0);});
 it('重新綁定後的舊訊息不會誤歸屬新教師，舊訊息仍可收回',async()=>{const a=await teacher(),b=await teacher();await issue(a,'late-a');await event('Ulate','late-a');await event('Ulate','none',{message:{id:'original-late',type:'text',text:'舊對話'}});await cmd(admin,'unbind',{teacher_id:a});await issue(b,'late-b');await event('Ulate','late-b');expect((await event('Ulate','none',{timestamp:1,message:{id:'old-delayed',type:'text',text:'延遲舊訊息'}})).ignored).toBe(true);expect((await db.query('select * from public.messages where line_message_id=$1',['old-delayed'])).rows).toHaveLength(0);await event('Ulate','none',{type:'unsend',unsend:{messageId:'original-late'}});expect((await db.query<any>('select withdrawn from public.messages where line_message_id=$1',['original-late'])).rows[0].withdrawn).toBe(true);});
 it('RLS：非行政看不到教師；前端不能修改資料或呼叫內部 RPC',async()=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${outsider}';`);try{expect((await db.query('select * from public.teachers')).rows).toHaveLength(0);await expect(db.query("insert into public.teachers(name) values('越權')")).rejects.toThrow('permission');await expect(db.query('select public.line_event($1::jsonb,$2)',['{}','x'])).rejects.toThrow('permission');await expect(db.query('select * from private.bindings')).rejects.toThrow('permission');}finally{await db.exec('reset role');}});
 it('RLS：行政可讀教師；資料表沒有 LINE User ID、碼或雜湊',async()=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${staff}';`);try{const row=(await db.query<any>('select * from public.teachers limit 1')).rows[0];expect(row).toBeTruthy();expect(row).not.toHaveProperty('line_user_id');expect(row).not.toHaveProperty('digest');expect((await db.query('select * from public.audit_logs')).rows).toHaveLength(0);}finally{await db.exec('reset role');}});
});

const handover=async(actor:string,action:string,payload:any)=>(await db.query<{v:any}>('select public.handover_command($1,$2,$3::jsonb) v',[actor,action,JSON.stringify(payload)])).rows[0].v;
describe('獨立交接事項',()=>{
 it('一般行政可新增交接，不產生通知或訊息；建立人由後端決定',async()=>{
  const before=(await db.query<any>('select count(*)::int n from public.notifications')).rows[0].n;
  const h=await handover(staff,'handover_create',{id:crypto.randomUUID(),content:'  測試交接，不發 LINE  ',created_by:admin,creator_name:'偽造姓名'});
  expect(h.content).toBe('測試交接，不發 LINE');expect(h.created_by).toBe(staff);expect(h.creator_name).toBe('測試行政');expect(h.completed_at).toBeNull();
  expect((await db.query<any>('select count(*)::int n from public.notifications')).rows[0].n).toBe(before);
  expect((await db.query('select * from public.audit_logs where handover_id=$1',[h.id])).rows).toHaveLength(1);
 });
 it('新增請求可重試，但不可用同編號變更內容或冒用他人',async()=>{
  const payload={id:crypto.randomUUID(),content:'請下一班確認'};const h=await handover(admin,'handover_create',payload);
  expect(await handover(admin,'handover_create',payload)).toEqual(h);
  await expect(handover(staff,'handover_create',payload)).rejects.toThrow('不一致');await expect(handover(admin,'handover_create',{...payload,content:'變更'})).rejects.toThrow('不一致');
  expect((await db.query('select * from public.audit_logs where handover_id=$1',[h.id])).rows).toHaveLength(1);
 });
 it('他人可完成交接，重複完成保留第一位經辦人與時間',async()=>{
  const h=await handover(admin,'handover_create',{id:crypto.randomUUID(),content:'確認值班工作'});
  const completed=await handover(staff,'handover_complete',{id:h.id,completed_by:admin});expect(completed.completed_by).toBe(staff);expect(completed.completed_name).toBe('測試行政');expect(completed.completed_at).toBeTruthy();
  expect(await handover(admin,'handover_complete',{id:h.id})).toEqual(completed);
  expect((await db.query('select * from public.audit_logs where handover_id=$1',[h.id])).rows).toHaveLength(2);
 });
 it('拒絕空白、超長內容、未知或停用帳號，以及不存在的交接',async()=>{
  for(const content of ['   ','字'.repeat(2001)])await expect(handover(staff,'handover_create',{id:crypto.randomUUID(),content})).rejects.toThrow('2000');
  await expect(handover(outsider,'handover_create',{id:crypto.randomUUID(),content:'越權'})).rejects.toThrow('未授權');
  await db.query('update public.staff set active=false where id=$1',[staff]);try{await expect(handover(staff,'handover_create',{id:crypto.randomUUID(),content:'越權'})).rejects.toThrow('未授權');}finally{await db.query('update public.staff set active=true where id=$1',[staff]);}
  await expect(handover(staff,'handover_complete',{id:crypto.randomUUID()})).rejects.toThrow('不存在');
 });
 it('RLS 限制讀取；一般前端不可直接寫入、假造經辦人或呼叫內部 RPC',async()=>{
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${staff}';`);
  try{expect((await db.query('select * from public.handovers')).rows.length).toBeGreaterThan(0);await expect(db.query("insert into public.handovers(id,content,created_by,creator_name) values(gen_random_uuid(),'越權',$1,'偽造')",[staff])).rejects.toThrow('permission');await expect(db.query('select public.handover_command($1,$2,$3::jsonb)',[staff,'handover_create','{}'])).rejects.toThrow('permission');}finally{await db.exec('reset role');}
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${outsider}';`);try{expect((await db.query('select * from public.handovers')).rows).toHaveLength(0);}finally{await db.exec('reset role');}
 });
});

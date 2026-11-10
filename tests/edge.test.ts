import{beforeAll,beforeEach,afterAll,describe,it,expect,vi}from'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),line:vi.fn(),getUser:vi.fn(),staff:vi.fn(),env:vi.fn()}));
vi.mock('../supabase/functions/_shared/runtime.ts',()=>({env:mocks.env,rpc:mocks.rpc,line:mocks.line,db:{auth:{getUser:mocks.getUser},from:()=>({select:()=>({eq:()=>({single:mocks.staff})})})}}));
let admin:(req:Request)=>Promise<Response>,webhook:(req:Request)=>Promise<Response>;
beforeAll(async()=>{const handlers:any[]=[];vi.stubGlobal('Deno',{serve:(h:any)=>handlers.push(h)});const adminPath='../supabase/functions/admin-api/index.ts',webhookPath='../supabase/functions/line-webhook/index.ts';await import(adminPath);await import(webhookPath);[admin,webhook]=handlers;});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{vi.clearAllMocks();mocks.env.mockImplementation((name:string)=>({ALLOWED_ORIGIN:'http://localhost:5173',BINDING_PEPPER:'test-only-pepper-at-least-32-characters',LINE_CHANNEL_SECRET:'test-secret',LINE_SEND_ENABLED:'false'} as Record<string,string>)[name]||'');mocks.getUser.mockResolvedValue({data:{user:{id:'test-user'}},error:null});mocks.staff.mockResolvedValue({data:{role:'staff',active:true}});mocks.rpc.mockResolvedValue({});mocks.line.mockResolvedValue(new Response('{}',{status:200}));});
const request=(body:any,token?:string)=>new Request('http://local/admin-api',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
async function signed(raw:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));return new Request('http://local/line-webhook',{method:'POST',headers:{'x-line-signature':btoa(String.fromCharCode(...bytes))},body:raw});}
describe('Edge HTTP 處理器（依賴 Mock，不連真實服務）',()=>{
 it('沒有 JWT 拒絕操作',async()=>{expect((await admin(request({action:'unbind'}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('無效 JWT 與停用帳號被拒絕',async()=>{mocks.getUser.mockResolvedValueOnce({data:{user:null},error:Error('invalid')});expect((await admin(request({action:'send'},'invalid'))).status).toBe(401);mocks.staff.mockResolvedValueOnce({data:{role:'admin',active:false}});expect((await admin(request({action:'send'},'valid'))).status).toBe(403);});
 it('一般行政無法產碼或修改權限',async()=>{for(const action of ['issue_code','unbind','staff_save','teacher_save'])expect((await admin(request({action},'valid'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('真實發送未開啟時拒絕，且不會呼叫 LINE',async()=>{expect((await admin(request({action:'send'},'valid'))).status).toBe(409);expect(mocks.line).not.toHaveBeenCalled();});
 it('管理員產碼只將 HMAC 交給資料庫',async()=>{mocks.staff.mockResolvedValueOnce({data:{role:'admin',active:true}});const response=await admin(request({action:'issue_code',payload:{teacher_id:'teacher-test'}},'valid'));const body=await response.json();expect(body.code).toHaveLength(12);const payload=mocks.rpc.mock.calls[0][1].payload;expect(payload.digest).toHaveLength(64);expect(JSON.stringify(payload)).not.toContain(body.code);});
 it('簽章錯誤不解析也不進資料庫',async()=>{const r=await webhook(new Request('http://local/webhook',{method:'POST',body:'bad'}));expect(r.status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('LINE Verify 空事件回 200，已簽名但格式錯誤回 400',async()=>{expect((await webhook(await signed('{"events":[]}'))).status).toBe(200);expect((await webhook(await signed('bad'))).status).toBe(400);});
 it('資料庫失敗回 500 允許重送，重複事件不再次回覆',async()=>{const raw=JSON.stringify({events:[{webhookEventId:'e',type:'follow',source:{type:'user',userId:'Utest'},replyToken:'test-reply'}]});mocks.rpc.mockRejectedValueOnce(Error('database unavailable'));expect((await webhook(await signed(raw))).status).toBe(500);mocks.rpc.mockResolvedValueOnce({duplicate:true});expect((await webhook(await signed(raw))).status).toBe(200);expect(mocks.line).not.toHaveBeenCalled();});
 it('LINE 回覆失敗不撤回綁定，保留失敗標記',async()=>{const raw=JSON.stringify({events:[{webhookEventId:'e2',type:'message',source:{type:'user',userId:'Utest'},message:{type:'text',text:'TESTCODE'},replyToken:'test-reply'}]});mocks.rpc.mockResolvedValueOnce({reply:'身分綁定成功'});mocks.line.mockRejectedValueOnce(Error('timeout'));expect((await webhook(await signed(raw))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('finish_event',{event_id:'e2',outcome:'reply_failed'});});
 it('push 逾時標記結果未明，傳遞同一重試鍵',async()=>{mocks.env.mockImplementation((name:string)=>name==='LINE_SEND_ENABLED'?'true':name==='ALLOWED_ORIGIN'?'http://localhost:5173':'');mocks.rpc.mockResolvedValueOnce(['notice']).mockResolvedValueOnce({to:'Utest',content:'測試通知',retry_key:'fixed-key'}).mockResolvedValueOnce(null);mocks.line.mockRejectedValueOnce(Error('timeout'));expect((await admin(request({action:'send',payload:{}},'valid'))).status).toBe(200);expect(mocks.line).toHaveBeenCalledWith('message/push',{to:'Utest',messages:[{type:'text',text:'測試通知'}]},'fixed-key');expect(mocks.rpc).toHaveBeenCalledWith('finish_delivery',{nid:'notice',outcome:'uncertain',err:'network_or_timeout'});});
});

it('一般行政建立交接不需開啟 LINE 發送，且只呼叫交接 RPC',async()=>{
 const response=await admin(request({action:'handover_create',payload:{id:'handover-test',content:'測試交接',created_by:'spoofed'}},'valid'));expect(response.status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith('handover_command',{actor:'test-user',action:'handover_create',payload:{id:'handover-test',content:'測試交接',created_by:'spoofed'}});expect(mocks.line).not.toHaveBeenCalled();
});

it('內部備註、更正與恢復在 LINE 停用時仍可操作，完全不呼叫 LINE',async()=>{
 for(const action of ['internal_note_create','handover_edit','handover_reopen']){mocks.rpc.mockClear();const response=await admin(request({action,payload:{id:'test',teacher_id:'teacher',content:'內部事項'}},'valid'));expect(response.status).toBe(200);expect(mocks.rpc.mock.calls[0][0]).toBe(action==='internal_note_create'?'internal_note_command':'handover_command');expect(mocks.rpc.mock.calls[0][1].actor).toBe('test-user');}
 expect(mocks.line).not.toHaveBeenCalled();
});

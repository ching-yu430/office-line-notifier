import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Data} from '../src/api';
const sample=(name:string)=>({teachers:[{id:randomUUID(),name}],notifications:[],messages:[],staff:[],templates:[],audit_logs:[],conversations:[],handovers:[],internal_notes:[],handover_revisions:[]}) as unknown as Data;
let sendData:(value:Response)=>void,held:Promise<Response>,count:number;
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_APP_MODE','cloudflare');vi.stubGlobal('window',new EventTarget());held=new Promise(resolve=>{sendData=resolve;});count=0;});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('同時讀取合併成一個快照請求，保持更新時的用量',async()=>{
 const data=sample('虛構教師甲');vi.stubGlobal('fetch',vi.fn(()=>{count++;return held;}));const api=await import('../src/api');const one=api.load(),two=api.load();expect(count).toBe(1);sendData(Response.json(data,{headers:{etag:'test-tag'}}));expect(await one).toEqual(data);expect(await two).toEqual(data);
});
it('完成寫入後的重新載入等待舊請求再取新快照，不以舊資料當成功結果',async()=>{
 const before=sample('寫入前的虛構資料'),after=sample('寫入後的虛構資料');vi.stubGlobal('fetch',vi.fn(()=>++count===1?held:Promise.resolve(Response.json(after,{headers:{etag:'after'}}))));const api=await import('../src/api');const pending=api.load(),fresh=api.load(true);expect(count).toBe(1);sendData(Response.json(before,{headers:{etag:'before'}}));expect(await pending).toEqual(before);expect(await fresh).toEqual(after);expect(count).toBe(2);
});
it('登出重登後較晚完成的舊請求不能覆寫新使用者快照',async()=>{
 const oldData=sample('舊帳號的虛構資料'),newData=sample('新帳號的虛構資料');vi.stubGlobal('fetch',vi.fn((url:string)=>{if(url.endsWith('/logout'))return Promise.resolve(Response.json({ok:true}));if(url.endsWith('/login'))return Promise.resolve(Response.json({actor:{id:randomUUID(),role:'staff'},csrf:randomUUID()}));if(url.endsWith('/changes'))return Promise.resolve(new Response(null,{status:304}));return ++count===1?held:Promise.resolve(Response.json(newData,{headers:{etag:'new-tag'}}));}));
 const api=await import('../src/api');const pending=api.load().catch(e=>e);await api.signOut();await api.signIn('test-'+randomUUID(),randomUUID());expect(await api.load()).toEqual(newData);sendData(Response.json(oldData,{headers:{etag:'old-tag'}}));expect((await pending).code).toBe('SESSION_CHANGED');expect(await api.pollData()).toBeNull();expect(await api.load()).toEqual(newData);
});
it('舊帳號較晚抵達的 401 不得清除新登入的 Session 與 CSRF',async()=>{
 let finish:(value:Response)=>void=()=>{},expired=0,newHeader='';const old=new Promise<Response>(resolve=>{finish=resolve;});window.addEventListener('office-session-expired',()=>expired++);
 let commands=0;vi.stubGlobal('fetch',vi.fn((url:string,options:any)=>{if(url.endsWith('/logout'))return Promise.resolve(Response.json({ok:true}));if(url.endsWith('/login'))return Promise.resolve(Response.json({actor:{id:randomUUID(),role:'admin'},csrf:'new-csrf-test'}));if(++commands===1)return old;newHeader=options.headers['X-CSRF-Token'];return Promise.resolve(Response.json({ok:true}));}));
 const api=await import('../src/api'),pending=api.command('records_backup_page').catch(e=>e);await api.signOut();await api.signIn('test-account','synthetic-password');finish(Response.json({error:'請先登入'},{status:401}));expect((await pending).status).toBe(401);await api.command('system_status');expect(expired).toBe(0);expect(newHeader).toBe('new-csrf-test');
});

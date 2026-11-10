
import { db,env,rpc,line } from '../_shared/runtime.ts';
import { generateCode,hashCode } from '../_shared/security.ts';
Deno.serve(async req=>{
 const origin=env('ALLOWED_ORIGIN');
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Content-Type':'application/json'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
 if(req.method!=='POST') return reply({error:'只接受 POST'},405);
 if(req.headers.get('origin') && req.headers.get('origin')!==origin) return reply({error:'來源不允許'},403);
 try {
 const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!bearer) return reply({error:'請先登入'},401);
 const {data:{user},error}=await db.auth.getUser(bearer);
 if(error||!user) return reply({error:'登入已失效'},401);
 const {data:staff}=await db.from('staff').select('role,active').eq('id',user.id).single();
 if(!staff?.active) return reply({error:'未授權的行政帳號'},403);
 const raw=await req.text();if(raw.length>100000) return reply({error:'請求過大'},413);
 const {action,payload={}}=JSON.parse(raw);
 if(['teacher_save','issue_code','unbind','staff_save','template_save'].includes(action)&&staff.role!=='admin') return reply({error:'需要管理員權限'},403);
 if(action==='system_status') return reply({send_enabled:env('LINE_SEND_ENABLED')==='true',line_configured:!!env('LINE_CHANNEL_ACCESS_TOKEN')&&!!env('LINE_CHANNEL_SECRET'),binding_configured:env('BINDING_PEPPER').length>=32});
 if(action==='issue_code') {
 if(env('BINDING_PEPPER').length<32) return reply({error:'後端尚未設定足夠長度的綁定金鑰'},503);
 const code=generateCode();await rpc('office_command',{actor:user.id,action,payload:{teacher_id:payload.teacher_id,digest:await hashCode(code,env('BINDING_PEPPER'))}});
 return reply({code,expires_at:new Date(Date.now()+7*86400000).toISOString()});
 }
 if(['handover_create','handover_complete','handover_edit','handover_reopen'].includes(action)) return reply({data:await rpc('handover_command',{actor:user.id,action,payload})});
 if(action==='internal_note_create') return reply({data:await rpc('internal_note_command',{actor:user.id,payload})});
 if(['send','dispatch'].includes(action) && env('LINE_SEND_ENABLED')!=='true') return reply({error:'真實發送尚未啟用，請先完成測試與核准'},409);
 const data=await rpc('office_command',{actor:user.id,action,payload});
 if(['send','dispatch'].includes(action)) {
 for(const id of data.slice(0,5)) {
 const item=await rpc('claim_delivery',{nid:id});if(!item) continue;
 let outcome='uncertain',err:string|null='network_or_timeout';
 try {
 const response=await line('message/push',{to:item.to,messages:[{type:'text',text:item.content}]},item.retry_key);
 if(response.ok||(response.status===409&&response.headers.has('x-line-accepted-request-id'))) {outcome='accepted';err=null;}
 else {outcome=response.status>=500?'uncertain':'failed';err='line_http_'+response.status;}
 } catch { /* No automatic resend: ambiguous results must be reconciled first. */ }
 await rpc('finish_delivery',{nid:id,outcome,err});
 }
 }
 return reply({data});
 }catch(e) {
 const code=(e as {code?:string}).code;
 return reply({error:code==='42501'?'權限不足':(e as {message?:string}).message||'操作失敗，請稍後再試'},code==='42501'?403:400);
 }
});

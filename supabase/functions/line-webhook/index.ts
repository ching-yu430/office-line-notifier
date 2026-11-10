
import { env,rpc,line } from '../_shared/runtime.ts';
import { verifySignature,hashCode,parseEvents } from '../_shared/security.ts';
Deno.serve(async req=>{
 if(req.method!=='POST') return new Response('只接受 POST',{status:405});
 const raw=await req.text();
 if(raw.length>1000000) return new Response('請求過大',{status:413});
 if(!await verifySignature(raw,req.headers.get('x-line-signature'),env('LINE_CHANNEL_SECRET'))) return new Response('簽章無效',{status:401});
 let events;try{events=parseEvents(raw);}catch{return new Response('格式錯誤',{status:400});}
 if(env('BINDING_PEPPER').length<32) return new Response('服務未設定',{status:503});
 try {
 for(const e of events) {
 const digest=await hashCode(e.message?.type==='text'?e.message.text:'',env('BINDING_PEPPER'));
 const result=await rpc('line_event',{e,code_digest:digest});
 if(result.reply && e.replyToken) {
 let status='reply_failed';
 try {const response=await line('message/reply',{replyToken:e.replyToken,messages:[{type:'text',text:result.reply}]});status=response.ok?'replied':'reply_failed';}catch{}
 // Binding is already committed. Never undo it if LINE reply fails; admin can see bound_at.
 await rpc('finish_event',{event_id:e.webhookEventId,outcome:status});
 }
 }
 return new Response('OK');
 }catch{return new Response('暫時無法處理，請重送',{status:500});}
});

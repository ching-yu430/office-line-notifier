import type {Data,Notice} from './api';
export {kindLabel} from './notice';
import {isPickup} from './notice';
export function noticeStatus(n:Pick<Notice,'kind'|'status'|'pickup_name'>){
 if(n.status!=='已完成')return n.status;
 return isPickup(n)?'已領取':n.kind==='reply'?'已回覆':'已處理';
}
export function failureText(code?:string|null){
 if(code==='line_http_401'||code==='line_http_403')return 'LINE 連線設定需要更新，請通知管理員檢查。';
 if(code==='line_http_429')return 'LINE 訊息額度或發送頻率受限，請通知管理員檢查。';
 if(code==='binding_changed')return '教師的 LINE 綁定已變更，請確認身分後再發送。';
 if(code==='line_http_400')return 'LINE 無法處理這則訊息，請通知管理員檢查教師綁定及內容。';
 if(code==='network_or_timeout'||code==='worker_interrupted'||/^line_http_5/.test(code||''))return '發送結果尚未確認，請先查詢紀錄，避免重複發送。';
 return '訊息未能送出，內容已保留，請通知管理員協助。';
}
export function inboxFor(data:Data,id:string){
 const supplied=data.inbox?.find(i=>i.teacher_id===id);if(supplied)return supplied;
 const messages=data.messages.filter(m=>m.teacher_id===id),latest=messages.at(-1);
 return {teacher_id:id,latest_content:latest?.content||'',latest_at:latest?.created_at||'',latest_direction:latest?.direction||'',latest_inbound_id:messages.filter(m=>m.direction==='in').at(-1)?.id??null,unread_count:0};
}
export function conversationStatus(data:Data,id:string){return data.conversations.find(c=>c.teacher_id===id)?.status||(inboxFor(data,id).latest_direction==='in'?'待回覆':'已完成');}
export function sortedConversations(data:Data,query='',filter='all'){
 return data.teachers.filter(t=>t.active&&t.bound_at&&(t.name+t.department).toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(filter==='all'||(filter==='pending'?conversationStatus(data,t.id)==='待回覆':inboxFor(data,t.id).unread_count>0)))
 .sort((a,b)=>Number(conversationStatus(data,b.id)==='待回覆')-Number(conversationStatus(data,a.id)==='待回覆')||(inboxFor(data,b.id).latest_at||'').localeCompare(inboxFor(data,a.id).latest_at||'')||a.name.localeCompare(b.name,'zh-TW'));
}

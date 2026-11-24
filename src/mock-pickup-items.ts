import type {Data, Notice, PickupItem} from './api';
import {isPickup} from './notice';

type Demo=Data & {operation_requests?:Record<string,{actor:string;fingerprint:string}>;pickup_undo?:Record<string,{actor:string;before:PickupItem[];expires_at:number;used?:boolean}>};
export function syncMockPickups(data:Data) {
 data.pickup_items ||= [];
 for(const notice of data.notifications){
  if(!isPickup(notice))continue;
  if(!notice.pickup_item_id){
   notice.pickup_item_id=notice.id;
   if(!data.pickup_items.some(item=>item.id===notice.id))data.pickup_items.push({...notice,is_item:true,status:notice.status==='已完成'?'已完成':'待領取',created_by:notice.sender_id});
  }
 }
 for(const item of data.pickup_items){
  item.version ??=1;
  const latest=data.notifications.filter(notice=>notice.pickup_item_id===item.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).at(0);
  item.send_status=latest?.send_status||'not_sent';item.error_code=latest?.error_code;item.last_notice_content=latest?.content;
 }
}
export function mockPickupItems(action:string,p:any,data:Demo,actor:string){
 if(action==='pickup_items_query'){
  const filtered=(data.pickup_items||[]).filter(item=>(p.status==='全部'||item.status===(p.status||'待領取'))&&(!p.teacher_id||item.teacher_id===p.teacher_id)&&(item.content+(item.pickup_name||'')+(data.teachers.find(t=>t.id===item.teacher_id)?.name||'')).toLowerCase().includes((p.query||'').toLowerCase())).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const pages=Math.max(1,Math.ceil(filtered.length/10)),page=Math.min(p.page||1,pages);return {items:filtered.slice((page-1)*10,page*10),total:filtered.length,pages,page};
 }
 if(!['pickup_register','pickup_cancel','pickup_items_complete','pickup_items_undo'].includes(action))return undefined;
 data.pickup_items ||= [];data.operation_requests ||= {};data.pickup_undo ||= {};
 const request=p.request_id||p.id;
 if(action==='pickup_items_undo'){
  const undo=data.pickup_undo[request];
  if(!undo||undo.actor!==actor||undo.used||undo.expires_at<=Date.now()/1000||undo.before.some(old=>data.pickup_items!.find(item=>item.id===old.id)?.version!==(old.version||1)+1))throw Error('快速復原已逾時或物品已更新');
  for(const old of undo.before){const item=data.pickup_items.find(item=>item.id===old.id)!;Object.assign(item,old,{version:(item.version||1)+1});for(const notice of data.notifications.filter(n=>n.pickup_item_id===item.id&&n.send_status==='accepted'))Object.assign(notice,{status:'待領取',completed_at:null,completed_by:null,version:(notice.version||1)+1});}
  undo.used=true;data.audit_logs.unshift({id:crypto.randomUUID(),actor_id:actor,action,created_at:new Date().toISOString()});return {};
 }
 const fingerprint=JSON.stringify({action,...p}),old=data.operation_requests[request];
 if(old){if(old.actor!==actor||old.fingerprint!==fingerprint)throw Error('重複請求內容不一致');return {already_applied:true,item_id:request};}
 if(action==='pickup_register'){
  if(!data.teachers.some(t=>t.id===p.teacher_id&&t.active))throw Error('教師已停用或不存在');
  if(!p.content?.trim()||p.content.length>5000||(p.kind==='pickup'&&!p.pickup_name?.trim()))throw Error('請填寫物品及通知內容');
  data.pickup_items.push({id:request,is_item:true,teacher_id:p.teacher_id,kind:p.kind==='pickup'?'custom':p.kind,pickup_name:p.kind==='pickup'?p.pickup_name.trim():null,content:p.content,important:false,status:'待領取',send_status:'not_sent',created_at:new Date().toISOString(),created_by:actor,sender_id:actor,version:1});
  data.operation_requests[request]={actor,fingerprint};data.audit_logs.unshift({id:crypto.randomUUID(),actor_id:actor,action,teacher_id:p.teacher_id,created_at:new Date().toISOString()});return {item_id:request};
 }
 const entries=action==='pickup_cancel'?[{id:p.id,expected_version:p.expected_version}]:p.items;
 if(!Array.isArray(entries)||!entries.length||entries.length>100||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('物品資料格式錯誤');
 const items=entries.map(entry=>{const item=data.pickup_items!.find(item=>item.id===entry.id);if(!item||item.status!=='待領取'||item.version!==entry.expected_version)throw Error('物品已被更新，請重新確認');return item;});
 const before=structuredClone(items),now=new Date().toISOString();
 for(const item of items){Object.assign(item,{status:action==='pickup_cancel'?'已取消':'已完成',completed_at:action==='pickup_cancel'?null:now,completed_by:action==='pickup_cancel'?null:actor,cancelled_at:action==='pickup_cancel'?now:null,cancelled_by:action==='pickup_cancel'?actor:null,cancellation_reason:p.reason||null,version:(item.version||1)+1});for(const notice of data.notifications.filter(n=>n.pickup_item_id===item.id&&n.send_status==='accepted'))Object.assign(notice,{status:'已完成',completed_at:now,completed_by:actor,version:(notice.version||1)+1});}
 data.operation_requests[request]={actor,fingerprint};data.pickup_undo[request]={actor,before,expires_at:Date.now()/1000+60};data.audit_logs.unshift({id:crypto.randomUUID(),actor_id:actor,action,created_at:now});
 return {undo:{id:request,action:'pickup_items_undo',expires_at:Date.now()/1000+60}};
}

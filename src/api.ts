
import {createClient} from '@supabase/supabase-js';
import {functionErrorMessage} from './function-errors';
export const mock=import.meta.env.VITE_APP_MODE!=='supabase';
export const client=!mock&&import.meta.env.VITE_SUPABASE_URL&&import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY):null;
export type Teacher={id:string;name:string;department:string;notes:string;active:boolean;bound_at:string|null;last_notified_at:string|null};
export type Notice={id:string;teacher_id:string;kind:string;content:string;important:boolean;send_status:string;status:string;created_at:string;sender_id:string;completed_at?:string;completed_by?:string;error_code?:string};
export type Message={id:string;teacher_id:string;direction:string;content:string;created_at:string;notification_id?:string;withdrawn?:boolean};
export type Handover={id:string;content:string;created_by:string;creator_name:string;handover_name:string;created_at:string;completed_at:string|null;completed_by:string|null;completed_name:string|null;finisher_name:string|null;version:number};
export type InternalNote={id:string;teacher_id:string;content:string;author_id:string;author_name:string;created_at:string};
export type HandoverRevision={id:string;handover_id:string;action:string;actor_id:string;actor_name:string;before_data:Handover|null;after_data:Handover;reason:string|null;created_at:string};
export type Staff={id:string;display_name:string;role:string;active:boolean};
export type Template={kind:string;label:string;content:string};
export type Data={teachers:Teacher[];notifications:Notice[];messages:Message[];staff:Staff[];templates:Template[];audit_logs:any[];conversations:any[];handovers:Handover[];internal_notes:InternalNote[];handover_revisions:HandoverRevision[]};
const now=()=>new Date().toISOString();
const defaults:Data={internal_notes:[],handover_revisions:[],handovers:[],conversations:[],teachers:[{id:'demo-1',name:'示範教師甲',department:'教務處',notes:'虛構示範資料',active:true,bound_at:now(),last_notified_at:now()},{id:'demo-2',name:'示範教師乙',department:'學務處',notes:'虛構示範資料',active:true,bound_at:null,last_notified_at:null},{id:'demo-3',name:'示範教師丙',department:'總務處',notes:'虛構示範資料',active:true,bound_at:now(),last_notified_at:now()}],notifications:[{id:'n1',teacher_id:'demo-1',kind:'parcel',content:'您的包裹已送達辦公室，請撥空領取。',important:false,send_status:'accepted',status:'待領取',created_at:now(),sender_id:'demo-admin'},{id:'n2',teacher_id:'demo-3',kind:'contact',content:'辦公室有事項需要與您聯繫。',important:true,send_status:'accepted',status:'待回覆',created_at:now(),sender_id:'demo-admin'}],messages:[{id:'m1',teacher_id:'demo-1',direction:'out',content:'您的包裹已送達辦公室，請撥空領取。',created_at:now()},{id:'m2',teacher_id:'demo-1',direction:'in',content:'謝謝通知，我會在午休時間到辦公室領取。',created_at:now()}],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[{kind:'mail',label:'實體信件',content:'您的信件已送達辦公室，請撥空領取。'},{kind:'parcel',label:'包裹通知',content:'您的包裹已送達辦公室，請撥空領取。'},{kind:'contact',label:'行政聯絡',content:'辦公室有事項需要與您聯繫。'},{kind:'custom',label:'自訂訊息',content:''}],audit_logs:[]};
const storageKey='office-line-demo-v1';
let demo:Data=JSON.parse(localStorage.getItem(storageKey)||'null')||structuredClone(defaults);
function normalize(){demo.conversations ||= [];demo.handovers ||= [];demo.internal_notes ||= [];demo.handover_revisions ||= [];for(const h of demo.handovers){h.handover_name ??=h.creator_name;h.finisher_name ??=h.completed_name;h.version ??=1;}}
normalize();
function readLatestDemo(){const saved=localStorage.getItem(storageKey);if(saved)demo=JSON.parse(saved);normalize();}
let demoRole='admin';
// Volatile only: do not persist plaintext demo codes.
const codes=new Map<string,{teacher_id:string;expires:number}>();
function persist(){localStorage.setItem(storageKey,JSON.stringify(demo));window.dispatchEvent(new Event('office-refresh'));}
export function changeDemoRole(role:string){demoRole=role;}
export async function load():Promise<Data>{
 if(mock){readLatestDemo();return structuredClone(demo);}
 if(!client)throw Error('尚未設定 Supabase 網址與公開金鑰，請參閱 README。');
 const names=['teachers','notifications','messages','staff','templates','audit_logs','conversations','handovers','internal_notes','handover_revisions'] as const;
 const values=await Promise.all(names.map(async name=>{const q=client.from(name).select('*');if(name==='handovers'){const {data,error}=await q.order('completed_at',{ascending:false,nullsFirst:true}).order('created_at',{ascending:false}).limit(1000);if(error)throw error;return data||[];}const {data,error}=await (['messages','notifications','audit_logs','internal_notes','handover_revisions'].includes(name)?q.order('created_at',{ascending:false}).limit(500):q.limit(1000));if(error)throw error;return name==='messages'?(data||[]).reverse():data||[];}));
 return Object.fromEntries(names.map((n,i)=>[n,values[i]])) as Data;
}
export async function command(action:string,payload:any={}):Promise<any>{
 if(!mock){if(!client)throw Error('Supabase 尚未設定');const {data,error}=await client.functions.invoke('admin-api',{body:{action,payload}});if(error)throw Error(await functionErrorMessage(error,data?.error||'操作失敗，請確認登入、權限及後端設定。'));if(data.error)throw Error(data.error);return data;}
 readLatestDemo();
 if(['teacher_save','issue_code','unbind','staff_save','template_save'].includes(action)&&demoRole!=='admin')throw Error('需要管理員權限');
 const t=demo.teachers.find(t=>t.id===payload.teacher_id);
 let result:any={};
 const actor=demoRole==='admin'?'demo-admin':'demo-staff',actorName=demo.staff.find(s=>s.id===actor)?.display_name||'行政人員';
 const revision=(h:Handover,before:Handover|null)=>demo.handover_revisions.unshift({id:crypto.randomUUID(),handover_id:h.id,action,actor_id:actor,actor_name:actorName,before_data:before,after_data:structuredClone(h),reason:payload.reason?.trim()||null,created_at:now()});
 if(action==='teacher_save'){if(t)Object.assign(t,{name:payload.name,department:payload.department,notes:payload.notes,active:payload.active});else demo.teachers.push({id:crypto.randomUUID(),...payload,bound_at:null,last_notified_at:null});}
 if(action==='issue_code'){if(!t?.active||t.bound_at)throw Error('教師已綁定或已停用');for(const [key,v] of codes)if(v.teacher_id===t.id)codes.delete(key);const code=Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');codes.set(code,{teacher_id:t.id,expires:Date.now()+7*86400000});result={code,expires_at:new Date(Date.now()+7*86400000).toISOString()};}
 if(action==='unbind'&&t){t.bound_at=null;for(const [key,v]of codes)if(v.teacher_id===t.id)codes.delete(key);}
 if(action==='mock_bind'){const c=codes.get(payload.code.trim().toUpperCase().replace(/[ -]/g,''));if(!c||c.expires<=Date.now())throw Error('綁定碼無效或已過期');const teacher=demo.teachers.find(t=>t.id===c.teacher_id)!;if(!teacher.active||teacher.bound_at)throw Error('無法重複綁定');teacher.bound_at=now();codes.delete(payload.code.trim().toUpperCase().replace(/[ -]/g,''));}
 if(action==='send'){
 for(const id of payload.teacher_ids){const teacher=demo.teachers.find(t=>t.id===id);if(!teacher?.active||!teacher.bound_at)throw Error('教師尚未綁定或已停用');}
 for(const id of payload.teacher_ids){if(demo.notifications.some((n:any)=>n.request_id===payload.request_id&&n.teacher_id===id))continue;const notificationId=crypto.randomUUID();demo.notifications.unshift({id:notificationId,...payload,teacher_id:id,send_status:'accepted',status:['mail','parcel'].includes(payload.kind)?'待領取':'待回覆',sender_id:demoRole==='admin'?'demo-admin':'demo-staff',created_at:now()});demo.messages.push({id:crypto.randomUUID(),teacher_id:id,notification_id:notificationId,direction:'out',content:payload.content,created_at:now()});demo.teachers.find(t=>t.id===id)!.last_notified_at=now();}
 }
 if(action==='mock_inbound'){if(!t?.bound_at)throw Error('請先綁定');const conv=demo.conversations.find(c=>c.teacher_id===t.id);if(conv)conv.status='待回覆';else demo.conversations.push({teacher_id:t.id,status:'待回覆'});demo.messages.push({id:crypto.randomUUID(),teacher_id:t.id,direction:'in',content:payload.content,created_at:now()});}
 if(action==='conversation_status'){const c=demo.conversations.find(c=>c.teacher_id===payload.teacher_id);if(c)c.status=payload.status;else demo.conversations.push(payload);}
 if(action==='complete'){const n=demo.notifications.find(n=>n.id===payload.id);if(n)Object.assign(n,{status:payload.status,completed_at:payload.status==='已完成'?now():null,completed_by:demoRole==='admin'?'demo-admin':'demo-staff'});}
 if(action==='handover_create'){
  const content=String(payload.content||'').trim();if(!content||content.length>2000)throw Error('請輸入 1 至 2000 字的交接內容');
  const name=String(payload.handover_name||'').trim();if(!name||name.length>80)throw Error('請填寫 1 至 80 字的交接人姓名');
  const actor=demoRole==='admin'?'demo-admin':'demo-staff';const old=demo.handovers.find(h=>h.id===payload.id);
  if(old){if(old.content!==content||old.created_by!==actor||old.handover_name!==name)throw Error('重複請求內容不一致');return {data:old};}
  const entry:Handover={id:payload.id,content,created_by:actor,creator_name:demo.staff.find(s=>s.id===actor)!.display_name,handover_name:name,created_at:now(),completed_at:null,completed_by:null,completed_name:null,finisher_name:null,version:1};demo.handovers.unshift(entry);revision(entry,null);result={data:entry};
 }
 if(action==='handover_complete'){
  const h=demo.handovers.find(h=>h.id===payload.id);if(!h)throw Error('交接事項不存在');if(h.completed_at)return {data:h};
  if(payload.expected_version!=null&&payload.expected_version!==h.version)throw Error('交接事項已被更新，請重新整理後再操作');
  const before=structuredClone(h);
  const name=String(payload.finisher_name||'').trim();if(!name||name.length>80)throw Error('請填寫 1 至 80 字的完成人姓名');
  const actor=demoRole==='admin'?'demo-admin':'demo-staff';Object.assign(h,{completed_at:now(),completed_by:actor,completed_name:demo.staff.find(s=>s.id===actor)!.display_name,finisher_name:name,version:h.version+1});revision(h,before);result={data:h};
 }
 if(action==='handover_edit'||action==='handover_reopen'){
  const h=demo.handovers.find(h=>h.id===payload.id);if(!h)throw Error('交接事項不存在');
  if(action==='handover_reopen'&&!h.completed_at)return {data:h};
  if(payload.expected_version!==h.version)throw Error('交接事項已被更新，請重新整理後再操作');
  if((payload.reason||'').length>500)throw Error('原因最多 500 字');
  const before=structuredClone(h);
  if(action==='handover_edit'){
   const content=String(payload.content||'').trim(),name=String(payload.handover_name||'').trim(),finisher=String(payload.finisher_name||'').trim();
   if(!content||content.length>2000)throw Error('請輸入 1 至 2000 字的交接內容');if(!name||name.length>80)throw Error('請填寫 1 至 80 字的交接人姓名');if(h.completed_at&&(!finisher||finisher.length>80))throw Error('請填寫 1 至 80 字的完成人姓名');
   if(h.content===content&&h.handover_name===name&&(!h.completed_at||h.finisher_name===finisher))return {data:h};
   Object.assign(h,{content,handover_name:name,finisher_name:h.completed_at?finisher:null,version:h.version+1});
  }else Object.assign(h,{completed_at:null,completed_by:null,completed_name:null,finisher_name:null,version:h.version+1});
  revision(h,before);result={data:h};
 }
 if(action==='internal_note_create'){
  const content=String(payload.content||'').trim();if(!content||content.length>2000)throw Error('請輸入 1 至 2000 字的內部備註');if(!t?.active)throw Error('教師已停用或不存在');
  const old=demo.internal_notes.find(n=>n.id===payload.id);if(old){if(old.teacher_id!==t.id||old.author_id!==actor||old.content!==content)throw Error('重複請求內容不一致');return {data:old};}
  const note:InternalNote={id:payload.id,teacher_id:t.id,content,author_id:actor,author_name:actorName,created_at:now()};demo.internal_notes.unshift(note);result={data:note};
 }
 if(action==='staff_save'){const s=demo.staff.find(s=>s.id===payload.id);if(s)Object.assign(s,payload);else demo.staff.push(payload);}
 if(action==='template_save'){const x=demo.templates.find(t=>t.kind===payload.kind);if(x)x.content=payload.content;}
 demo.audit_logs.unshift({id:crypto.randomUUID(),action,actor_id:demoRole==='admin'?'demo-admin':'demo-staff',teacher_id:payload.teacher_id,handover_id:action.startsWith('handover_')?payload.id:null,internal_note_id:action==='internal_note_create'?payload.id:null,created_at:now()});persist();return result;
}


export const mock=(import.meta.env.VITE_APP_MODE||'mock')==='mock';
const base=(import.meta.env.VITE_API_BASE||'/api').replace(/\/$/,'');
let csrfToken='',etag='',cached:Data|null=null;
export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
async function request(path:string,body?:unknown,extra:Record<string,string>={}){
 let response:Response;
 try{response=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'include',headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(path==='/command'?65000:20000)});}catch{throw new ApiError(0,path==='/command'?'連線中斷，操作可能已完成；請先查詢紀錄，避免重複操作':'無法連線至後端，請確認網路與服務狀態');}
 if(response.status===304)return response;
 if(!response.ok){let message='操作失敗，請稍後重試';try{message=(await response.json() as any).error||message;}catch{}if(response.status===401){csrfToken='';etag='';cached=null;window.dispatchEvent(new Event('office-session-expired'));}throw new ApiError(response.status,message);}
 return response;
}
export async function getSession(){try{const r=await request('/session');const result:any=await r.json();csrfToken=result.csrf;return result.actor;}catch(e){if(e instanceof ApiError&&e.status===401)return null;throw e;}}
export async function signIn(username:string,password:string){const result:any=await(await request('/login',{username,password})).json();csrfToken=result.csrf;etag='';cached=null;return result.actor;}
export async function signOut(){await request('/logout',{});csrfToken='';etag='';cached=null;}

export type Teacher={id:string;name:string;department:string;notes:string;active:boolean;bound_at:string|null;last_notified_at:string|null};
export type Notice={id:string;teacher_id:string;kind:string;content:string;important:boolean;send_status:string;status:string;created_at:string;sender_id:string;completed_at?:string;completed_by?:string;error_code?:string};
export type Message={id:string;teacher_id:string;direction:string;content:string;created_at:string;notification_id?:string;withdrawn?:boolean};
export type Handover={id:string;content:string;created_by:string;creator_name:string;handover_name:string;created_at:string;completed_at:string|null;completed_by:string|null;completed_name:string|null;finisher_name:string|null;version:number};
export type InternalNote={id:string;teacher_id:string;content:string;author_id:string;author_name:string;created_at:string};
export type HandoverRevision={id:string;handover_id:string;action:string;actor_id:string;actor_name:string;before_data:Handover|null;after_data:Handover;reason:string|null;created_at:string};
export type Staff={id:string;username?:string;display_name:string;role:string;active:boolean};
export type Template={kind:string;label:string;content:string};
export type Data={teachers:Teacher[];notifications:Notice[];messages:Message[];staff:Staff[];templates:Template[];audit_logs:any[];conversations:any[];handovers:Handover[];internal_notes:InternalNote[];handover_revisions:HandoverRevision[]};
const now=()=>new Date().toISOString();
const defaults:Data={internal_notes:[],handover_revisions:[],handovers:[],conversations:[],teachers:[{id:'demo-1',name:'示範教師甲',department:'教務處',notes:'虛構示範資料',active:true,bound_at:now(),last_notified_at:now()},{id:'demo-2',name:'示範教師乙',department:'學務處',notes:'虛構示範資料',active:true,bound_at:null,last_notified_at:null},{id:'demo-3',name:'示範教師丙',department:'總務處',notes:'虛構示範資料',active:true,bound_at:now(),last_notified_at:now()}],notifications:[{id:'n1',teacher_id:'demo-1',kind:'parcel',content:'您的包裹已送達辦公室，請撥空領取。',important:false,send_status:'accepted',status:'待領取',created_at:now(),sender_id:'demo-admin'},{id:'n2',teacher_id:'demo-3',kind:'contact',content:'辦公室有事項需要與您聯繫。',important:true,send_status:'accepted',status:'待回覆',created_at:now(),sender_id:'demo-admin'}],messages:[{id:'m1',teacher_id:'demo-1',direction:'out',content:'您的包裹已送達辦公室，請撥空領取。',created_at:now()},{id:'m2',teacher_id:'demo-1',direction:'in',content:'謝謝通知，我會在午休時間到辦公室領取。',created_at:now()}],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[{kind:'mail',label:'實體信件',content:'您的信件已送達辦公室，請撥空領取。'},{kind:'parcel',label:'包裹通知',content:'您的包裹已送達辦公室，請撥空領取。'},{kind:'contact',label:'行政聯絡',content:'辦公室有事項需要與您聯繫。'},{kind:'custom',label:'自訂訊息',content:''}],audit_logs:[]};
const storageKey='office-line-demo-v1';
function initialDemo():Data{if(mock){try{return JSON.parse(localStorage.getItem(storageKey)||'null')||structuredClone(defaults);}catch{}}return structuredClone(defaults);}
let demo:Data=initialDemo();
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
 const response=await request('/data',undefined,etag?{'If-None-Match':etag}:{});
 if(response.status===304&&cached)return structuredClone(cached);
 cached=await response.json();etag=response.headers.get('etag')||'';return structuredClone(cached!);
}
export async function command(action:string,payload:any={}):Promise<any>{
 if(!mock)return (await request('/command',{action,payload})).json();
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
 if(action==='staff_save'){const existing=demo.staff.find(s=>s.id===payload.id);const safe={id:payload.id||crypto.randomUUID(),username:payload.username,display_name:payload.display_name,role:payload.role,active:payload.active};if(existing)Object.assign(existing,safe);else demo.staff.push(safe);}
 if(action==='template_save'){const x=demo.templates.find(t=>t.kind===payload.kind);if(x)x.content=payload.content;}
 demo.audit_logs.unshift({id:crypto.randomUUID(),action,actor_id:demoRole==='admin'?'demo-admin':'demo-staff',teacher_id:payload.teacher_id,handover_id:action.startsWith('handover_')?payload.id:null,internal_note_id:action==='internal_note_create'?payload.id:null,created_at:now()});persist();return result;
}

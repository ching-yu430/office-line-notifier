import type {Data} from './api';
import {cleanupOptions,cleanupCutoff,cleanupLimits,cleanupTotal,type CleanupOptions,type CleanupPreview} from './cleanup';
type Demo=Data&{views?:{sequence:number}[];undo_actions?:{type:string;before:any;expires_at:number;used?:boolean}[];archived_requests?:string[]};
type Targets={messages:string[];notifications:string[];handovers:string[];audits:string[]};
const jobs=new Map<string,{actor:string;options:CleanupOptions;targets:Targets;versions:Record<string,number|undefined>;preview:CleanupPreview;messageStamp:Record<string,string>;done?:boolean}>();
function candidates(d:Demo,options:CleanupOptions,limited=true):Targets{
 const cutoff=cleanupCutoff(options.before),activeUndo=(type:string,id:string)=>d.undo_actions?.some(u=>u.type===type&&u.before.id===id&&!u.used&&u.expires_at>Date.now()/1000);
 const trim=<T,>(rows:T[],size:number)=>limited?rows.slice(0,size):rows;
 const messages=options.contact?trim(d.messages.filter(m=>m.created_at<cutoff&&d.conversations.some(c=>c.teacher_id===m.teacher_id&&c.status==='已完成')&&d.messages.filter(x=>x.teacher_id===m.teacher_id).at(-1)?.id!==m.id&&!d.notifications.some(n=>n.teacher_id===m.teacher_id&&(n.status!=='已完成'||['queued','sending','uncertain'].includes(n.send_status)||activeUndo('notification',n.id)))),cleanupLimits.messages).map(m=>m.id):[];
 const notifications=options.contact?trim(d.notifications.filter(n=>n.created_at<cutoff&&n.completed_at&&n.completed_at<cutoff&&n.status==='已完成'&&['accepted','failed'].includes(n.send_status)&&!activeUndo('notification',n.id)&&!d.messages.some(m=>m.notification_id===n.id&&!messages.includes(m.id))),cleanupLimits.notifications).map(n=>n.id):[];
 const handovers=options.handovers?trim(d.handovers.filter(h=>h.created_at<cutoff&&h.completed_at&&h.completed_at<cutoff&&!activeUndo('handover',h.id)),cleanupLimits.handovers).map(h=>h.id):[];
 const audits=options.audits?trim(d.audit_logs.filter(a=>a.created_at<cutoff&&a.action!=='records_cleanup'),cleanupLimits.audits).map(a=>a.id):[];
 return {messages,notifications,handovers,audits};
}
export function mockCleanup(action:string,p:any,d:Demo,actor:string){
 if(action==='mock_cleanup_seed'){
  const old='2020-01-01T00:00:00.000Z',tid='cleanup-demo-teacher';
  if(!d.teachers.some(t=>t.id===tid))d.teachers.push({id:tid,name:'虛構歷史教師',department:'展示資料',notes:'僅供紀錄清理測試',active:true,bound_at:old,last_notified_at:old});
  if(!d.notifications.some(n=>n.id==='cleanup-demo-notice'))d.notifications.push({id:'cleanup-demo-notice',teacher_id:tid,kind:'reply',content:'虛構歷史通知',important:false,send_status:'accepted',status:'已完成',created_at:old,completed_at:old,sender_id:actor,version:1});
  for(const [id,content]of [['cleanup-demo-old','可清理的舊訊息'],['cleanup-demo-last','保留的最後一則訊息']])if(!d.messages.some(m=>m.id===id)){const message={id,teacher_id:tid,direction:'out',content,created_at:old,...(id==='cleanup-demo-old'?{notification_id:'cleanup-demo-notice'}:{})},last=d.messages.findIndex(m=>m.id==='cleanup-demo-last');if(id==='cleanup-demo-old'&&last>=0)d.messages.splice(last,0,message);else d.messages.push(message);}
  if(!d.conversations.some(c=>c.teacher_id===tid))d.conversations.push({teacher_id:tid,status:'已完成',updated_at:old});
  if(!d.handovers.some(h=>h.id==='cleanup-demo-handover')){const h={id:'cleanup-demo-handover',content:'虛構已完成交接',created_by:actor,creator_name:'示範管理員',handover_name:'虛構交接人',created_at:old,completed_at:old,completed_by:actor,completed_name:'示範管理員',finisher_name:'虛構完成人',version:1};d.handovers.push(h);d.handover_revisions.push({id:crypto.randomUUID(),handover_id:h.id,action:'handover_complete',actor_id:actor,actor_name:'示範管理員',before_data:null,after_data:h,reason:null,created_at:old});}
  if(!d.audit_logs.some(a=>a.id==='cleanup-demo-log'))d.audit_logs.push({id:'cleanup-demo-log',actor_id:actor,action:'login',created_at:old});
  return {};
 }
 if(action==='records_cleanup_preview'){
  const options=cleanupOptions(p),targets=candidates(d,options),counts={messages:targets.messages.length,notifications:targets.notifications.length,handovers:targets.handovers.length,audits:targets.audits.length,revisions:d.handover_revisions.filter(r=>targets.handovers.includes(r.handover_id)).length};
  const preview:CleanupPreview={job_id:crypto.randomUUID(),before:options.before,counts,expires_at:Math.floor(Date.now()/1000)+600,limited:(Object.keys(cleanupLimits) as (keyof typeof cleanupLimits)[]).some(k=>counts[k]===cleanupLimits[k])};
  for(const [id,job] of jobs)if(job.preview.expires_at<Date.now()/1000&&!job.done)jobs.delete(id);
  jobs.set(preview.job_id,{actor,options,targets,preview,messageStamp:Object.fromEntries(d.messages.filter(m=>targets.messages.includes(m.id)).map(m=>[m.id,JSON.stringify(m)])),versions:Object.fromEntries([...d.notifications,...d.handovers].map(x=>[x.id,x.version]))});return preview;
 }
 if(action!=='records_cleanup_execute')return undefined;
 if(p.confirmation!=='刪除紀錄')throw Error('請輸入「刪除紀錄」確認');
 const job=jobs.get(p.job_id);if(!job||job.actor!==actor)throw Error('找不到清理預覽，請重新預覽');
 if(job.done)return {...job.preview,already_applied:true};
 if(job.preview.expires_at<=Date.now()/1000)throw Error('清理預覽已逾時，請重新預覽');
 if(!cleanupTotal(job.preview.counts))throw Error('沒有可清理的紀錄');
 const live=candidates(d,job.options,false),targets=job.targets;
 if(d.messages.some(m=>targets.messages.includes(m.id)&&job.messageStamp[m.id]!==JSON.stringify(m)))throw Error('紀錄已更新，尚未刪除任何資料，請重新預覽');
 if((Object.keys(targets) as (keyof Targets)[]).some(k=>targets[k].some(id=>!live[k].includes(id)))||[...d.notifications,...d.handovers].some(x=>(targets.notifications.includes(x.id)||targets.handovers.includes(x.id))&&x.version!==job.versions[x.id]))throw Error('紀錄已更新，尚未刪除任何資料，請重新預覽');
 const teachers=new Set([...d.messages.filter(m=>targets.messages.includes(m.id)).map(m=>m.teacher_id),...d.notifications.filter(n=>targets.notifications.includes(n.id)).map(n=>n.teacher_id)]);
 d.archived_requests ||= [];for(const n of d.notifications as any[])if(targets.notifications.includes(n.id)&&n.request_id)d.archived_requests.push(n.request_id);
 for(const view of d.views||[])view.sequence=d.messages.slice(0,view.sequence).filter(m=>!targets.messages.includes(m.id)).length;
 d.messages=d.messages.filter(m=>!targets.messages.includes(m.id));d.notifications=d.notifications.filter(n=>!targets.notifications.includes(n.id));
 d.handovers=d.handovers.filter(h=>!targets.handovers.includes(h.id));d.handover_revisions=d.handover_revisions.filter(r=>!targets.handovers.includes(r.handover_id));
 d.audit_logs=d.audit_logs.filter(a=>!targets.audits.includes(a.id));for(const a of d.audit_logs)if(targets.handovers.includes(a.handover_id))a.handover_id=null;
 d.undo_actions=d.undo_actions?.filter(u=>!(u.type==='notification'?targets.notifications:targets.handovers).includes(u.before.id));
 for(const t of d.teachers)if(teachers.has(t.id))t.conversation_version=(t.conversation_version||1)+1;
 d.audit_logs.unshift({id:crypto.randomUUID(),actor_id:actor,action:'records_cleanup',result:'success',details:JSON.stringify({before:job.preview.before,counts:job.preview.counts}),created_at:new Date().toISOString()});
 job.done=true;return job.preview;
}

export type CleanupOptions={before:string;contact:boolean;handovers:boolean;audits:boolean;failed?:boolean;all_dates?:boolean};
export type CleanupCounts={notifications:number;messages:number;handovers:number;revisions:number;audits:number;failed_notifications?:number};
export type CleanupPreview={job_id:string;before:string;counts:CleanupCounts;expires_at:number;limited:boolean;all_dates?:boolean};
export const cleanupLimits={messages:300,notifications:100,handovers:50,audits:300};
export const cleanupTotal=(counts:CleanupCounts)=>counts.notifications+counts.messages+counts.handovers+counts.audits;
export const cleanupLabels:Record<keyof CleanupCounts,string>={notifications:'通知',messages:'聊天訊息',handovers:'交接事項',revisions:'交接修改紀錄',audits:'操作紀錄',failed_notifications:'發送失敗通知'};
export function cleanupOptions(p:any,now=Date.now()):CleanupOptions{
 if(['failed','all_dates'].some(k=>p[k]!==undefined&&typeof p[k]!=='boolean'))throw Error('清理選項格式錯誤');
 const before=p.all_dates?new Date(now+8*3600000).toISOString().slice(0,10):p.before;
 if(typeof before!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(before))throw Error('請選擇有效的清理日期');
 const date=new Date(before+'T00:00:00+08:00');
 if(!Number.isFinite(date.getTime())||new Date(date.getTime()+8*3600000).toISOString().slice(0,10)!==before||date.getTime()>now||Number(before.slice(0,4))<2000)throw Error('清理日期須為有效的過去日期');
 if(['contact','handovers','audits'].some(k=>typeof p[k]!=='boolean')||!p.contact&&!p.handovers&&!p.audits&&!p.failed)throw Error('請至少選擇一種紀錄');
 return {before,contact:p.contact,handovers:p.handovers,audits:p.audits,failed:p.failed===true,all_dates:p.all_dates===true};
}
export const cleanupCutoff=(before:string)=>new Date(before+'T00:00:00+08:00').toISOString();
// 全部日期也固定在預覽當刻；執行時只處理原預覽的目標，不擴大到後來新增的資料。
export const cleanupPlanCutoff=(options:CleanupOptions,now=Date.now())=>options.all_dates?new Date(now).toISOString():cleanupCutoff(options.before);
export function defaultCleanupDate(){const d=new Date(Date.now()+8*3600000);d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10);}
export function cleanupSummary(value:unknown){
 try{const info=typeof value==='string'?JSON.parse(value):value;if(!info||typeof info!=='object')return '';const {before,counts,all_dates}=info as any;return (all_dates?'全部日期：':`${String(before)} 以前：`)+(['notifications','messages','handovers','audits'] as const).filter(k=>Number(counts?.[k])>0).map(k=>`${cleanupLabels[k]} ${Number(counts[k])} 筆`).join('、')+(Number(counts?.failed_notifications)>0?`（含發送失敗 ${Number(counts.failed_notifications)} 筆）`:'');}catch{return '';}
}

export type CleanupOptions={before:string;contact:boolean;handovers:boolean;audits:boolean};
export type CleanupCounts={notifications:number;messages:number;handovers:number;revisions:number;audits:number};
export type CleanupPreview={job_id:string;before:string;counts:CleanupCounts;expires_at:number;limited:boolean};
export const cleanupLimits={messages:300,notifications:100,handovers:50,audits:300};
export const cleanupTotal=(counts:CleanupCounts)=>counts.notifications+counts.messages+counts.handovers+counts.audits;
export const cleanupLabels:Record<keyof CleanupCounts,string>={notifications:'通知',messages:'聊天訊息',handovers:'交接事項',revisions:'交接修改紀錄',audits:'操作紀錄'};
export function cleanupOptions(p:any,now=Date.now()):CleanupOptions{
 if(typeof p.before!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.before))throw Error('請選擇有效的清理日期');
 const date=new Date(p.before+'T00:00:00+08:00');
 if(!Number.isFinite(date.getTime())||new Date(date.getTime()+8*3600000).toISOString().slice(0,10)!==p.before||date.getTime()>now||Number(p.before.slice(0,4))<2000)throw Error('清理日期須為有效的過去日期');
 if(['contact','handovers','audits'].some(k=>typeof p[k]!=='boolean')||!p.contact&&!p.handovers&&!p.audits)throw Error('請至少選擇一種紀錄');
 return {before:p.before,contact:p.contact,handovers:p.handovers,audits:p.audits};
}
export const cleanupCutoff=(before:string)=>new Date(before+'T00:00:00+08:00').toISOString();
export function defaultCleanupDate(){const d=new Date(Date.now()+8*3600000);d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10);}
export function cleanupSummary(value:unknown){
 try{const info=typeof value==='string'?JSON.parse(value):value;if(!info||typeof info!=='object')return '';const {before,counts}=info as any;return `${String(before)} 以前：`+(['notifications','messages','handovers','audits'] as const).filter(k=>Number(counts?.[k])>0).map(k=>`${cleanupLabels[k]} ${Number(counts[k])} 筆`).join('、');}catch{return '';}
}

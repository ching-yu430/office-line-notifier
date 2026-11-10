import type {Handover} from './api';
export type HistoryPeriod='today'|'week'|'date';
export function taipeiDay(date:Date):string{
 if(!Number.isFinite(date.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
 return `${get('year')}-${get('month')}-${get('day')}`;
}
export function filterHandoverHistory(items:Handover[],period:HistoryPeriod,selectedDate:string,now=new Date()):Handover[]{
 const today=taipeiDay(now),start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-6);
 const weekStart=start.toISOString().slice(0,10);
 return items.filter(h=>{
  if(!h.completed_at)return false;
  const day=taipeiDay(new Date(h.completed_at));if(!day)return false;
  return period==='date'?!!selectedDate&&day===selectedDate:period==='week'?day>=weekStart&&day<=today:day===today;
 }).sort((a,b)=>Date.parse(b.completed_at!)-Date.parse(a.completed_at!));
}

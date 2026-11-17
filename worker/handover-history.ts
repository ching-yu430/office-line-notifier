import {type Env,type Actor,HttpError,text} from './types';
import {boundary} from './notification-history';
const taipeiDay=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
import {limit} from './auth';
export async function handoverHistory(env:Env,actor:Actor,p:any){
 await limit(env,'handover-history:'+actor.id,90,60);
 const query=text(p.query??'','搜尋內容',200,0),period=p.period||'today';
 if(!['today','week','date'].includes(period)||!Number.isInteger(p.page)||p.page<1||p.page>9999999)throw new HttpError(400,'交接查詢格式錯誤');
 const today=taipeiDay(new Date()),from=period==='date'?text(p.date,'日期',10):period==='week'?taipeiDay(new Date(Date.now()-6*86400000)):today,to=period==='date'?from:today;
 const source=` FROM handovers WHERE completed_at>=? AND completed_at<? AND instr(lower(content || ' ' || handover_name || ' ' || coalesce(finisher_name,'')),lower(?))>0`,args=[boundary(from),boundary(to,true),query];
 const fields='SELECT id,content,created_by,creator_name,handover_name,created_at,completed_at,completed_by,completed_name,finisher_name,version';
 const select=(page:number)=>env.DB.prepare(fields+source+' ORDER BY completed_at DESC,id DESC LIMIT 5 OFFSET ?').bind(...args,(page-1)*5);
 const result=await env.DB.batch([env.DB.prepare('SELECT count(*) AS total'+source).bind(...args),select(p.page)]);
 const total=Number((result[0].results[0] as any).total),pages=Math.max(1,Math.ceil(total/5)),page=Math.min(p.page,pages);
 return {items:page===p.page?result[1].results:(await select(page).all()).results,total,pages,page};
}

import {type Env,type Actor,HttpError,id,text} from './types';
import {limit} from './auth';

export function boundary(value:string,end=false){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HttpError(400,'日期格式錯誤');
 const calendar=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value)throw new HttpError(400,'日期不存在');
 return new Date(new Date(value+'T00:00:00+08:00').getTime()+(end?86400000:0)).toISOString();
}

export async function notificationHistory(env:Env,actor:Actor,params:URLSearchParams){
 await limit(env,'notice-history:'+actor.id,90,60);
 const pageText=params.get('page')||'1';
 if(!/^[1-9]\d{0,6}$/.test(pageText))throw new HttpError(400,'分頁格式錯誤');
 const requested=Number(pageText),where:string[]=[],args:(string|number)[]=[];
 const teacher=params.get('teacher'),status=params.get('status'),send=params.get('send'),query=text(params.get('query')||'','搜尋內容',200,0),from=params.get('from'),to=params.get('to');
 if(teacher){where.push('n.teacher_id=?');args.push(id(teacher));}
 if(status){if(!['待領取','待回覆','已完成'].includes(status))throw new HttpError(400,'處理狀態錯誤');where.push('n.status=?');args.push(status);}
 if(send){
  if(send==='attention')where.push("n.send_status IN ('failed','uncertain')");
  else{if(!['queued','sending','accepted','failed','uncertain'].includes(send))throw new HttpError(400,'發送結果錯誤');where.push('n.send_status=?');args.push(send);}
 }
 if(query){where.push("instr(lower(t.name || ' ' || n.content),lower(?))>0");args.push(query);}
 if(from){where.push('coalesce(n.sent_at,n.created_at)>=?');args.push(boundary(from));}
 if(to){where.push('coalesce(n.sent_at,n.created_at)<?');args.push(boundary(to,true));}
 if(from&&to&&from>to)throw new HttpError(400,'起始日期需早於或等於結束日期');
 const source=' FROM notifications n JOIN teachers t ON t.id=n.teacher_id'+(where.length?' WHERE '+where.join(' AND '):'');
 const fields=`SELECT n.id,n.teacher_id,n.kind,n.content,n.important,n.sender_id,n.send_status,n.status,n.error_code,n.created_at,n.sent_at,n.completed_at,n.completed_by,n.version,
  (SELECT content FROM messages WHERE teacher_id=n.teacher_id AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1) AS latest_reply,
  (SELECT created_at FROM messages WHERE teacher_id=n.teacher_id AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1) AS latest_reply_at`;
 const select=(page:number)=>env.DB.prepare(fields+source+' ORDER BY coalesce(n.sent_at,n.created_at) DESC,n.id DESC LIMIT 10 OFFSET ?').bind(...args,(page-1)*10);
 const result=await env.DB.batch([env.DB.prepare('SELECT count(*) AS total'+source).bind(...args),select(requested)]);
 const total=Number((result[0].results[0] as any).total),pages=Math.max(1,Math.ceil(total/10)),page=Math.min(requested,pages);
 const notices=page===requested?result[1].results:(await select(page).all()).results;
 return {notices,total,page,pages,page_size:10};
}

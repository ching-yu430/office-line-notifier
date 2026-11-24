import {type Actor, type Env, HttpError, id, iso, rows, text, unix} from './types';
import {sha256} from './security';
import {limit} from './auth';

export const pickupFields = `1 AS is_item,0 AS important,p.id,p.teacher_id,p.kind,p.pickup_name,p.content,p.status,p.created_by AS sender_id,
 p.created_at,p.completed_at,p.completed_by,p.cancelled_at,p.cancelled_by,p.cancellation_reason,p.version,
 coalesce((SELECT send_status FROM notifications WHERE pickup_item_id=p.id ORDER BY created_at DESC,rowid DESC LIMIT 1),'not_sent') AS send_status,
 (SELECT error_code FROM notifications WHERE pickup_item_id=p.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS error_code,
 (SELECT content FROM notifications WHERE pickup_item_id=p.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS last_notice_content`;

export async function pickupItemQuery(env:Env, actor:Actor, p:any) {
 await limit(env, 'pickup-query:'+actor.id, 90, 60);
 const page=p.page??1, status=p.status??'待領取', teacher=p.teacher_id?id(p.teacher_id):null;
 if(!Number.isInteger(page)||page<1||page>9999999||!['待領取','已完成','已取消','全部'].includes(status))throw new HttpError(400,'物品查詢格式錯誤');
 const query=text(p.query??'','搜尋內容',200,0);
 const where=["instr(lower(t.name||' '||p.content||' '||coalesce(p.pickup_name,'')),lower(?))>0"];
 const args:any[]=[query];
 if(status!=='全部'){where.push('p.status=?');args.push(status);}
 if(teacher){where.push('p.teacher_id=?');args.push(teacher);}
 const source=' FROM pickup_items p JOIN teachers t ON t.id=p.teacher_id WHERE '+where.join(' AND ');
 const total=(await env.DB.prepare('SELECT count(*) AS n'+source).bind(...args).first<{n:number}>())!.n;
 const pages=Math.max(1,Math.ceil(total/10)), current=Math.min(page,pages);
 const items=await rows(env.DB.prepare('SELECT '+pickupFields+source+' ORDER BY p.created_at DESC,p.id DESC LIMIT 10 OFFSET ?').bind(...args,(current-1)*10));
 return {items,total,pages,page:current};
}

export async function pickupItemCommand(env:Env, actor:Actor, action:string, p:any) {
 if(action==='pickup_items_query')return pickupItemQuery(env,actor,p);
 if(!['pickup_register','pickup_items_complete','pickup_cancel','pickup_items_undo'].includes(action))return undefined;
 const db=env.DB, now=iso(), request=id(p.request_id??p.id),claim=crypto.randomUUID();
 if(action==='pickup_register'){
  const teacherId=id(p.teacher_id), kind=p.kind==='pickup'?'custom':p.kind;
  if(!['mail','parcel','custom'].includes(kind))throw new HttpError(400,'物品類型錯誤');
  const name=kind==='custom'?text(p.pickup_name,'物品名稱',80):null, content=text(p.content,'通知內容');
  const teacher=await db.prepare('SELECT active FROM teachers WHERE id=?').bind(teacherId).first<any>();
  if(!teacher?.active)throw new HttpError(409,'教師已停用或不存在');
  const fingerprint=await sha256(JSON.stringify({action,teacherId,kind,name,content}));
  const previous=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
  if(previous){if(previous.actor_id!==actor.id||previous.fingerprint!==fingerprint)throw new HttpError(409,'重複請求內容不一致');return {item_id:request,already_applied:true};}
  await db.batch([
   db.prepare('INSERT INTO send_requests(id,actor_id,fingerprint,created_at,operation_token) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM teachers WHERE id=? AND active=1) ON CONFLICT(id) DO NOTHING').bind(request,actor.id,fingerprint,now,claim,teacherId),
   db.prepare(`INSERT INTO pickup_items(id,teacher_id,kind,pickup_name,content,created_by,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM teachers WHERE id=? AND active=1) AND EXISTS(SELECT 1 FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=?) ON CONFLICT(id) DO NOTHING`).bind(request,teacherId,kind,name,content,actor.id,now,teacherId,request,actor.id,fingerprint),
   db.prepare(`INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at)
    SELECT ?,?,'pickup_register',?,? WHERE EXISTS(SELECT 1 FROM pickup_items WHERE id=? AND created_by=?) ON CONFLICT(id) DO NOTHING`).bind(request,actor.id,teacherId,now,request,actor.id)
  ]);
  const stored=await db.prepare('SELECT * FROM pickup_items WHERE id=?').bind(request).first<any>();
  const savedRequest=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
  if(!stored||stored.created_by!==actor.id||stored.content!==content||stored.teacher_id!==teacherId||savedRequest?.fingerprint!==fingerprint||savedRequest?.actor_id!==actor.id)throw new HttpError(409,'重複請求內容不一致');
  return {item_id:request};
 }
 if(action==='pickup_items_undo'){
  const undo=await db.prepare('SELECT * FROM pickup_item_undo WHERE id=? AND actor_id=?').bind(request,actor.id).first<any>();
  if(!undo||undo.used_at||undo.expires_at<=unix())throw new HttpError(409,'快速復原已逾時或已執行，請查看最新紀錄');
  const snapshot=JSON.parse(undo.snapshot) as any[];
  const operation=crypto.randomUUID(), json=JSON.stringify(snapshot);
  const gate=`EXISTS(SELECT 1 FROM pickup_item_undo WHERE id=? AND actor_id=? AND undo_token=?)`;
  await db.batch([
   db.prepare(`UPDATE pickup_item_undo SET used_at=?,undo_token=? WHERE id=? AND actor_id=? AND used_at IS NULL AND expires_at>?
    AND (SELECT count(*) FROM pickup_items p JOIN json_each(?) j ON p.id=json_extract(j.value,'$.id') WHERE p.version=json_extract(j.value,'$.version')+1 AND p.operation_token=?)=?`).bind(now,operation,request,actor.id,unix(),json,request,snapshot.length),
   db.prepare(`UPDATE pickup_items SET status=json_extract(j.value,'$.status'),completed_at=json_extract(j.value,'$.completed_at'),completed_by=json_extract(j.value,'$.completed_by'),cancelled_at=NULL,cancelled_by=NULL,cancellation_reason=NULL,version=pickup_items.version+1,operation_token=?
    FROM json_each(?) j WHERE pickup_items.id=json_extract(j.value,'$.id') AND ${gate}`).bind(operation,json,request,actor.id,operation),
   db.prepare(`UPDATE notifications SET status='待領取',completed_at=NULL,completed_by=NULL,version=version+1 WHERE pickup_item_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND send_status='accepted' AND ${gate}`).bind(json,request,actor.id,operation),
   db.prepare(`INSERT INTO audit_logs(id,actor_id,action,created_at) SELECT ?,?,'pickup_items_undo',? WHERE ${gate}`).bind(operation,actor.id,now,request,actor.id,operation)
  ]);
  const done=await db.prepare('SELECT operation_token FROM pickup_items WHERE id=?').bind(snapshot[0].id).first<any>();
  if(done?.operation_token!==operation)throw new HttpError(409,'物品已被更新，請重新載入');
  return {};
 }
 const input=action==='pickup_cancel'?[{id:p.id,expected_version:p.expected_version}]:p.items;
 if(!Array.isArray(input)||!input.length||input.length>100)throw new HttpError(400,'每次限 1 至 100 筆物品');
 const entries=input.map((item:any)=>({id:id(item.id),version:item.expected_version})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
 if(new Set(entries.map((item:any)=>item.id)).size!==entries.length||entries.some((item:any)=>!Number.isInteger(item.version)||item.version<1))throw new HttpError(400,'物品資料格式錯誤');
 const reason=action==='pickup_cancel'?text(p.reason??'','取消原因',500,0):null;
 const fingerprint=await sha256(JSON.stringify({action,entries,reason}));
 const previous=await db.prepare('SELECT * FROM send_requests WHERE id=?').bind(request).first<any>();
 if(previous){if(previous.actor_id!==actor.id||previous.fingerprint!==fingerprint)throw new HttpError(409,'重複請求內容不一致');return {already_applied:true};}
 const targets=await rows(db.prepare(`SELECT * FROM pickup_items WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(JSON.stringify(entries)));
 if(targets.length!==entries.length||targets.some(item=>item.status!=='待領取'||item.version!==entries.find((entry:any)=>entry.id===item.id)?.version))throw new HttpError(409,'物品已被更新，請重新確認');
 const json=JSON.stringify(entries), snapshot=JSON.stringify(targets), status=action==='pickup_cancel'?'已取消':'已完成';
 const gate='EXISTS(SELECT 1 FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=? AND operation_token=?)';
 await db.batch([
  db.prepare(`INSERT INTO send_requests(id,actor_id,fingerprint,created_at,operation_token)
   SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM pickup_items p JOIN json_each(?) j ON p.id=json_extract(j.value,'$.id') WHERE p.status='待領取' AND p.version=json_extract(j.value,'$.version'))=? ON CONFLICT(id) DO NOTHING`).bind(request,actor.id,fingerprint,now,claim,json,entries.length),
  db.prepare(`UPDATE pickup_items SET status=?,completed_at=?,completed_by=?,cancelled_at=?,cancelled_by=?,cancellation_reason=?,version=version+1,operation_token=? WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(status,status==='已完成'?now:null,status==='已完成'?actor.id:null,status==='已取消'?now:null,status==='已取消'?actor.id:null,reason,request,json,request,actor.id,fingerprint,claim),
  db.prepare(`UPDATE notifications SET status='已完成',completed_at=?,completed_by=?,version=version+1 WHERE pickup_item_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND send_status='accepted' AND ${gate}`).bind(now,actor.id,json,request,actor.id,fingerprint,claim),
  db.prepare(`INSERT INTO pickup_item_undo(id,actor_id,snapshot,expires_at) SELECT ?,?,?,? WHERE ${gate} ON CONFLICT(id) DO NOTHING`).bind(request,actor.id,snapshot,unix()+60,request,actor.id,fingerprint,claim),
  db.prepare(`INSERT INTO audit_logs(id,actor_id,action,details,created_at) SELECT ?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO NOTHING`).bind(request,actor.id,action,JSON.stringify({item_ids:entries.map((item:any)=>item.id),reason}),now,request,actor.id,fingerprint,claim)
 ]);
 if(!await db.prepare('SELECT id FROM send_requests WHERE id=? AND actor_id=? AND fingerprint=?').bind(request,actor.id,fingerprint).first())throw new HttpError(409,'物品已被更新，請重新確認');
 return {undo:{id:request,expires_at:unix()+60,action:'pickup_items_undo'}};
}

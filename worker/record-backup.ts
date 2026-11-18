import {type Env,type Actor,HttpError,admin,iso,unix} from './types';
import {limit} from './auth';
import {equal} from './security';
import {backupTables,backupFields,type BackupTable,type BackupCounts} from '../src/backup-format';
type Snapshot={id:string;actor:string;version:number;counts:BackupCounts;created_at:string;expires_at:number};
const source=(table:BackupTable)=>table==='staff'?'admins':table;
const key=(table:BackupTable)=>table==='conversations'?'teacher_id':table==='templates'?'kind':'id';
async function signature(payload:string,env:Env){
 if(!env.AUTH_PEPPER||env.AUTH_PEPPER.length<32)throw new HttpError(503,'後端尚未設定登入金鑰');
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AUTH_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode('office-record-backup-v1:'+payload))),v=>v.toString(16).padStart(2,'0')).join('');
}
async function openToken(value:unknown,actor:Actor,env:Env){
 if(typeof value!=='string'||value.length>5000)throw new HttpError(400,'備份識別格式錯誤');
 const [payload,hash,...extra]=value.split('.');if(extra.length||!payload||!hash||!equal(await signature(payload,env),hash))throw new HttpError(403,'備份驗證失效，請重新產生');
 let snapshot:Snapshot;try{snapshot=JSON.parse(atob(payload));}catch{throw new HttpError(400,'備份識別格式錯誤');}
 if(snapshot.actor!==actor.id)throw new HttpError(403,'只能下載自己產生的備份');
 if(!Number.isSafeInteger(snapshot.expires_at)||snapshot.expires_at<=unix())throw new HttpError(409,'備份已逾時，請重新產生','BACKUP_EXPIRED');
 return snapshot;
}
export async function recordBackup(env:Env,actor:Actor,action:string,p:any){
 if(!['records_backup_start','records_backup_page','records_backup_finish'].includes(action))return undefined;
 admin(actor);const db=env.DB;
 if(action==='records_backup_start'){
  await limit(env,'backup-start:'+actor.id,10,600);
  const results=await db.batch([db.prepare('SELECT backup_version FROM system_meta WHERE id=1'),...backupTables.map(table=>db.prepare(`SELECT count(*) AS n FROM ${source(table)}`))]);
  const counts=Object.fromEntries(backupTables.map((table,i)=>[table,Number((results[i+1].results[0] as any).n)])) as BackupCounts;
  const snapshot:Snapshot={id:crypto.randomUUID(),actor:actor.id,version:Number((results[0].results[0] as any).backup_version),counts,created_at:iso(),expires_at:unix()+600};
  const payload=btoa(JSON.stringify(snapshot)),token=payload+'.'+await signature(payload,env);
  return {token,counts,created_at:snapshot.created_at,expires_at:snapshot.expires_at};
 }
 const snapshot=await openToken(p.token,actor,env);
 if(action==='records_backup_page'){
  if(!backupTables.includes(p.table))throw new HttpError(400,'備份類別不支援');
  const table=p.table as BackupTable,cursor=p.cursor??'';
  if(typeof cursor!=='string'||!/^[a-zA-Z0-9_-]{0,80}$/.test(cursor))throw new HttpError(400,'備份分頁格式錯誤');
  await limit(env,'backup-page:'+actor.id,1800,60);
  const fields=backupFields[table].map(field=>field==='sequence'?'rowid AS sequence':field==='before_data'||field==='after_data'?`CASE WHEN json_valid(${field}) THEN json_remove(${field},'$.operation_token') ELSE NULL END AS ${field}`:field).join(',');
  const result=await db.batch([db.prepare('SELECT backup_version FROM system_meta WHERE id=1'),db.prepare(`SELECT ${fields} FROM ${source(table)} WHERE ${key(table)}>? AND (SELECT backup_version FROM system_meta WHERE id=1)=? ORDER BY ${key(table)} LIMIT 100`).bind(cursor,snapshot.version)]);
  if(Number((result[0].results[0] as any).backup_version)!==snapshot.version)throw new HttpError(409,'紀錄在備份期間更新，請重新產生，避免保存不完整的資料','BACKUP_CHANGED');
  const rows=result[1].results;return {rows,next_cursor:rows.length===100?String((rows.at(-1) as any)[key(table)]):null};
 }
 if(typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>64*1024*1024)throw new HttpError(400,'備份檢查資料格式錯誤');
 const existing=await db.prepare("SELECT details FROM audit_logs WHERE id=? AND actor_id=? AND action='records_backup'").bind(snapshot.id,actor.id).first<{details:string}>();
 if(existing){if(JSON.parse(existing.details).sha256!==p.sha256)throw new HttpError(409,'同一備份的檢查碼不一致');return {already_applied:true};}
 const result=await db.prepare(`INSERT INTO audit_logs(id,actor_id,action,result,details,created_at) SELECT ?,?,'records_backup','success',?,? WHERE (SELECT backup_version FROM system_meta WHERE id=1)=? ON CONFLICT(id) DO NOTHING RETURNING id`).bind(snapshot.id,actor.id,JSON.stringify({counts:snapshot.counts,sha256:p.sha256,bytes:p.bytes}),iso(),snapshot.version).first();
 if(!result)throw new HttpError(409,'紀錄在備份期間更新，請重新產生，避免保存不完整的資料','BACKUP_CHANGED');
 return {id:snapshot.id};
}

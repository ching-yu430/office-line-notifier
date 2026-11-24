import type {Data} from './api';
import {backupFields,backupRow,backupTables,type BackupRows,type BackupTable} from './backup-format';
type Job={actor:string;rows:BackupRows;stamp:string;created_at:string;expires_at:number;done?:string};
const jobs=new Map<string,Job>();
const collect=(d:Data)=>Object.fromEntries(backupTables.map(table=>[table,(d[table] as any[]||[]).map(row=>backupRow(table,row)).sort((a,b)=>String(a[backupFields[table][0]])<String(b[backupFields[table][0]])?-1:String(a[backupFields[table][0]])>String(b[backupFields[table][0]])?1:0)])) as BackupRows;
export function mockBackup(action:string,p:any,d:Data,actor:string){
 if(!action.startsWith('records_backup_'))return undefined;
 if(action==='records_backup_start'){
  const rows=collect(d),token=crypto.randomUUID(),job={actor,rows,stamp:JSON.stringify(rows),created_at:new Date().toISOString(),expires_at:Math.floor(Date.now()/1000)+600};
  for(const [key,j]of jobs)if(j.expires_at<Date.now()/1000)jobs.delete(key);jobs.set(token,job);return {token,counts:Object.fromEntries(backupTables.map(t=>[t,rows[t].length])),created_at:job.created_at,expires_at:job.expires_at};
 }
 const job=jobs.get(p.token);if(!job||job.actor!==actor)throw Error('備份驗證失效，請重新產生');
 if(job.expires_at<=Date.now()/1000)throw Error('備份已逾時，請重新產生');
 if(job.done){if(p.sha256!==job.done)throw Error('同一備份的檢查碼不一致');return {already_applied:true};}
 if(JSON.stringify(collect(d))!==job.stamp)throw Object.assign(Error('紀錄在備份期間更新，請重新產生，避免保存不完整的資料'),{code:'BACKUP_CHANGED'});
 if(action==='records_backup_page'){
  if(!backupTables.includes(p.table))throw Error('備份類別不支援');const t=p.table as BackupTable,key=backupFields[t][0];
  const rows=job.rows[t].filter(row=>String(row[key])>(p.cursor||'')).slice(0,100);return {rows,next_cursor:rows.length===100?String(rows.at(-1)![key]):null};
 }
 if(action!=='records_backup_finish'||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('備份檢查資料格式錯誤');
 job.done=p.sha256;d.audit_logs.unshift({id:crypto.randomUUID(),actor_id:actor,action:'records_backup',result:'success',details:JSON.stringify({counts:Object.fromEntries(backupTables.map(t=>[t,job.rows[t].length])),sha256:p.sha256,bytes:p.bytes}),created_at:new Date().toISOString()});return {};
}

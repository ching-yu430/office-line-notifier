import {zipSync,strToU8} from 'fflate';
import {command} from './api';
import {APP_VERSION} from './version';
import {backupTables,backupFields,backupCsv,BACKUP_MAX_BYTES,type BackupRows,type BackupSnapshot} from './backup-format';
export async function buildRecordBackup(cancelled:()=>boolean,progress:(message:string)=>void){
 const check=()=>{if(cancelled())throw Object.assign(Error('備份已取消'),{name:'AbortError'});};
 for(let attempt=0;attempt<2;attempt++){
  try{
   check();progress(attempt?'紀錄已更新，正在重新產生…':'正在讀取備份範圍…');
   const snapshot=await command('records_backup_start') as BackupSnapshot;check();
   const records={} as BackupRows;let bytes=0,finished=0;const total=Object.values(snapshot.counts).reduce((sum,n)=>sum+n,0);
   for(const table of backupTables){
    records[table]=[];let cursor:string|null='';
    do{
     check();const page=await command('records_backup_page',{token:snapshot.token,table,cursor});check();
     if(!Array.isArray(page.rows)||page.rows.length>100||page.next_cursor===cursor&&page.next_cursor!==null)throw Error('備份分頁資料不完整，請重新產生');
     bytes+=strToU8(JSON.stringify(page.rows)).length;if(bytes>BACKUP_MAX_BYTES)throw Error('紀錄超過 50 MB，請改用完整 D1 備份指令，避免產生不完整的下載檔');
     records[table].push(...page.rows);if(records[table].length>snapshot.counts[table])throw Error('備份筆數不一致，請重新產生');
     finished+=page.rows.length;progress(`正在整理紀錄 ${finished.toLocaleString()} / ${total.toLocaleString()}…`);cursor=page.next_cursor;
    }while(cursor!==null);
    if(records[table].length!==snapshot.counts[table])throw Error('備份筆數不一致，請重新產生');
   }
   check();progress('正在打包 ZIP…');await new Promise(resolve=>setTimeout(resolve,0));check();
   const contents:Record<string,Uint8Array>={};
   contents['records.json']=strToU8(JSON.stringify({format:'office-administrative-records',format_version:1,app_version:APP_VERSION,created_at:snapshot.created_at,counts:snapshot.counts,records}));
   for(const table of backupTables)contents[`csv/${table}.csv`]=strToU8(backupCsv(table,records[table]));
   contents['備份說明.txt']=strToU8('辦公室小幫手－行政紀錄備份\r\n\r\nrecords.json 保存原始內容；csv 資料夾供試算表查閱。CSV 會防護公式注入，原始內容以 JSON 為準。\r\n此檔不含登入密碼雜湊、Session、LINE User ID、LINE 憑證或綁定碼，無法單獨重建完整系統。完整復原仍需另外保留 D1 SQL 備份及後端 Secrets。\r\n檔案含行政個資，請存於學校核准的位置，勿上傳公開 GitHub、網站或聊天群組。\r\n');
   const files=[];for(const [name,data]of Object.entries(contents)){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(data).buffer);files.push({name,bytes:data.length,sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')});}
   contents['manifest.json']=strToU8(JSON.stringify({format_version:1,app_version:APP_VERSION,created_at:snapshot.created_at,counts:snapshot.counts,files},null,2));
   const data=zipSync(contents,{level:1});if(data.length>64*1024*1024)throw Error('打包後檔案過大，請改用完整 D1 備份指令');check();const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data).buffer)),x=>x.toString(16).padStart(2,'0')).join('');
   await command('records_backup_finish',{token:snapshot.token,sha256:sha,bytes:data.length});check();
   const stamp=new Date(new Date(snapshot.created_at).getTime()+8*3600000).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15),filename=`office-records-${stamp}-${crypto.randomUUID().slice(0,8)}.zip`;
   return {data,filename,sha256:sha,counts:snapshot.counts,bytes:data.length};
  }catch(error){check();if(attempt===0&&(error as any).code==='BACKUP_CHANGED')continue;throw error;}
 }
 throw Error('紀錄持續更新，請稍候再產生備份');
}

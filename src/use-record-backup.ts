import {useEffect,useRef,useState} from 'react';
import {buildRecordBackup} from './record-backup';
import {BACKUP_INTERVALS} from './backup-format';
import {type BackupPreference,backupPreferenceKey,readBackupPreference,backupDue} from './backup-preference';
export type BackupDirectory=FileSystemDirectoryHandle&{queryPermission:(options:{mode:'readwrite'})=>Promise<PermissionState>};
declare global{interface Window{showDirectoryPicker?:(options:{mode:'readwrite';id:string})=>Promise<BackupDirectory>}}
export function useRecordBackup({actor,role,busy,onFinished,onNotice}:{actor:string;role:string;busy:boolean;onFinished:()=>Promise<void>;onNotice:(message:string)=>void}){
 const [preference,setPreference]=useState<BackupPreference>({hours:0,lastGenerated:0}),[pending,setPending]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState(''),[folderName,setFolderName]=useState(''),[permission,setPermission]=useState(false);
 const epoch=useRef(0),identity=actor+':'+role,current=useRef(identity);current.current=identity;
 const folder=useRef<BackupDirectory|null>(null),inflight=useRef(false),cancel=useRef(false),retryAt=useRef(0),pref=useRef(preference);pref.current=preference;
 const callbacks=useRef({onFinished,onNotice,busy});callbacks.current={onFinished,onNotice,busy};
 const supported=typeof window.showDirectoryPicker==='function'&&typeof navigator.locks?.request==='function';
 useEffect(()=>{epoch.current++;folder.current=null;inflight.current=false;cancel.current=true;setFolderName('');setPermission(false);setPending(false);setProgress('');setError('');setSuccess('');setPreference(actor?readBackupPreference(actor):{hours:0,lastGenerated:0});return()=>{epoch.current++;cancel.current=true;folder.current=null;};},[identity]);
 const persist=(next:BackupPreference)=>{pref.current=next;setPreference(next);try{localStorage.setItem(backupPreferenceKey(actor),JSON.stringify(next));}catch{}};
 const generate=async(automatic=false)=>{
  if(inflight.current||!actor||role!=='admin')return;
  const owner=identity,ownerEpoch=epoch.current,target=folder.current;inflight.current=true;cancel.current=false;setPending(true);setError('');setSuccess('');
  const cancelled=()=>cancel.current||current.current!==owner||epoch.current!==ownerEpoch;
  try{
   if(automatic){if(!target||await target.queryPermission({mode:'readwrite'})!=='granted'){setPermission(false);folder.current=null;throw Error('自動備份需要重新選擇資料夾並授權');}}
   const file=await buildRecordBackup(cancelled,message=>{if(!cancelled())setProgress(message);});if(cancelled())return;
   if(automatic&&target){
    const handle=await target.getFileHandle(file.filename,{create:true});if(cancelled())return;const writable=await handle.createWritable();
    try{await writable.write(new Uint8Array(file.data).buffer);if(cancelled()){await writable.abort();return;}await writable.close();}catch(e){await writable.abort().catch(()=>{});throw e;}
   }else{
    const url=URL.createObjectURL(new Blob([new Uint8Array(file.data).buffer],{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download=file.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   }
   if(cancelled())return;persist({...pref.current,lastGenerated:Date.now()});retryAt.current=0;
   const message=automatic?'自動備份已儲存至所選資料夾':'備份已產生，請確認瀏覽器下載完成';setSuccess(message+'：'+file.filename);callbacks.current.onNotice(message);await callbacks.current.onFinished();
  }catch(e){if(!cancelled()&&(e as Error).name!=='AbortError'){const message=(e as Error).message;setError(message);if(automatic){retryAt.current=Date.now()+300000;callbacks.current.onNotice('自動備份未完成，請至系統管理查看');}}}
  finally{if(current.current===owner&&epoch.current===ownerEpoch){inflight.current=false;setPending(false);setProgress('');}}
 };
 const run=useRef(generate);run.current=generate;
 useEffect(()=>{
  if(!actor||role!=='admin')return;
  let stopped=false;
  const tick=()=>{
   if(stopped||document.hidden||callbacks.current.busy||inflight.current||!folder.current||Date.now()<retryAt.current)return;
   const latest=readBackupPreference(actor,pref.current);if(!backupDue(latest))return;
   void navigator.locks.request('office-record-backup:'+actor,{ifAvailable:true},async lock=>{if(!lock||stopped||document.hidden||current.current!==identity)return;const next=readBackupPreference(actor,pref.current);if(backupDue(next))await run.current(true);}).catch(()=>{if(!stopped&&current.current===identity){setError('自動備份無法取得瀏覽器執行權，請改用手動下載');retryAt.current=Date.now()+300000;}});
  };
  const timer=setInterval(tick,60000);document.addEventListener('visibilitychange',tick);tick();
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[identity,preference.hours,folderName]);
 const chooseFolder=async()=>{
  if(!supported||!window.showDirectoryPicker)return;const owner=identity,ownerEpoch=epoch.current;
  try{const handle=await window.showDirectoryPicker({mode:'readwrite',id:'office-record-backups'});if(current.current!==owner||epoch.current!==ownerEpoch)return;if(await handle.queryPermission({mode:'readwrite'})!=='granted')throw Error('尚未取得資料夾寫入權限');folder.current=handle;setFolderName(handle.name);setPermission(true);setError('');retryAt.current=0;}catch(e){if((e as Error).name!=='AbortError')setError((e as Error).message);}
 };
 return {preference,pending,progress,error,success,folderName,permission,supported,generate:()=>generate(false),chooseFolder,cancel:()=>{cancel.current=true;},setHours:(hours:number)=>{if(BACKUP_INTERVALS.includes(hours as any))persist({...pref.current,hours});}};
}
export type RecordBackupState=ReturnType<typeof useRecordBackup>;

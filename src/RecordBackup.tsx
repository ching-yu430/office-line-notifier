import {Download,FolderOpen} from 'lucide-react';
import type {RecordBackupState} from './use-record-backup';
const format=(time:number)=>time?new Date(time).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未產生';
export function RecordBackup({state}:{state:RecordBackupState}){
 const next=state.preference.lastGenerated+state.preference.hours*3600000;
 return <div className="record-backup" aria-label="紀錄備份設定">
  <p>打包完整行政紀錄為 ZIP，內含 JSON、CSV 與檢查碼。不含帳號密碼、LINE 憑證及綁定碼。</p>
  <div className="backup-primary-actions"><button className="primary" disabled={state.pending} onClick={()=>void state.generate()}><Download size={16}/>{state.pending?'正在產生…':'下載 ZIP 備份'}</button>{state.pending&&<button className="text-button" onClick={state.cancel}>取消產生</button>}</div>
  {state.pending&&<p className="backup-progress" role="status">{state.progress}</p>}{state.error&&<div className="error" role="alert">{state.error}</div>}{state.success&&<p className="backup-success" role="status">{state.success}</p>}
  <div className="backup-schedule"><label>自動備份間隔（此電腦）<select aria-label="自動備份間隔" value={state.preference.hours} disabled={state.pending||!state.supported} onChange={e=>state.setHours(Number(e.target.value))}><option value={0}>關閉</option><option value={24}>每 1 天</option><option value={168}>每 7 天</option><option value={720}>每 30 天</option></select></label><button className="outline" disabled={state.pending||!state.supported} onClick={()=>void state.chooseFolder()}><FolderOpen size={16}/>{state.folderName?'重新選擇資料夾':'選擇自動備份資料夾'}</button></div>
  <dl className="backup-status"><div><dt>上次產生</dt><dd>{format(state.preference.lastGenerated)}</dd></div><div><dt>自動備份</dt><dd>{!state.preference.hours?'未啟用':!state.folderName?'請先選擇資料夾':!state.permission?'需要重新授權':state.pending?'產生中':state.preference.lastGenerated?'下次約 '+format(next):'即將開始'}</dd></div>{state.folderName&&<div><dt>儲存資料夾</dt><dd>{state.folderName}</dd></div>}</dl>
  <p className="hint">{state.supported?'網頁須開啟且管理員仍登入；重新開啟或登出後須再選擇資料夾。背景分頁可能延後，返回後補做。':'此瀏覽器未支援自動寫入資料夾，可使用手動 ZIP 下載。'}</p><p className="hint">備份含行政個資，請存於校內核准位置。這是紀錄備份；完整系統還原仍需 D1 SQL 備份與後端設定。</p>
 </div>;
}

import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Settings2,ClipboardList,Database,Plus,Pencil} from 'lucide-react';
import {mock,type Data,type Handover,type PublicInfo,type Staff,type Template} from './api';
import {APP_VERSION} from './version';
import {RecordHistory} from './RecordHistory';
import {RecordBackup} from './RecordBackup';
import {RecordCleanup} from './RecordCleanup';
import {NoticeIcon} from './NoticeIcon';
import {handoverSearch} from './HandoverList';
import {cleanupSummary} from './cleanup';
import type {PageMemory} from './page-memory';
import type {RecordBackupState} from './use-record-backup';
const tabs=[{id:'general',label:'一般設定',Icon:Settings2},{id:'records',label:'操作紀錄',Icon:ClipboardList},{id:'maintenance',label:'資料維護',Icon:Database}] as const;
type SettingsTab=typeof tabs[number]['id'];
const fmt=(v:string)=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const actions:Record<string,string>={pickup_register:'登記物品',pickup_items_complete:'登記領取',pickup_cancel:'取消物品',pickup_items_undo:'復原物品',records_backup:'產生紀錄備份',records_cleanup:'清理舊紀錄',login:'登入',logout:'登出',teacher_save:'儲存教師',issue_code:'產生綁定碼',unbind:'解除綁定',line_bound:'完成 LINE 綁定',send:'建立發送',complete:'更新處理狀態',staff_save:'調整帳號權限',template_save:'修改範本',mock_bind:'模擬綁定',mock_inbound:'模擬接收',dispatch:'繼續發送',conversation_status:'更新對話狀態',handover_create:'新增交接事項',handover_complete:'完成交接事項',handover_edit:'更正交接事項',handover_reopen:'恢復交接待處理',internal_note_create:'新增內部備註',reply_complete:'回覆後更新狀態',reply_pending:'回覆後保留待回覆',pickup_many:'整批登記領取',undo_many:'整批復原領取',undo:'復原操作',handover_undo:'復原交接完成'};
type Props={data:Data;uid:string;busy:boolean;publicInfo:PublicInfo|null;realtime:string;system:any;memory:PageMemory;backup:RecordBackupState;onCheck:()=>void;onStaff:(staff:Staff|null)=>void;onTemplate:(template:Template)=>void;onCleaned:()=>Promise<void>;renderHandover:(handover:Handover)=>ReactNode};
export function SystemSettings({data,uid,busy,publicInfo,realtime,system,memory,backup,onCheck,onStaff,onTemplate,onCleaned,renderHandover}:Props){
 const saved=memory.get('settings-category')?.tab;
 const [tab,setTab]=useState<SettingsTab>(tabs.some(t=>t.id===saved)?saved:'general'),buttons=useRef<(HTMLButtonElement|null)[]>([]);
 useEffect(()=>{memory.set('settings-category',{tab});},[tab,memory]);
 const person=(id:string)=>data.staff.find(s=>s.id===id)?.display_name||'工讀生';
 const auditRow=(a:any)=><article className="audit record-audit" key={a.id}><span>{actions[a.action]||'系統操作'} {a.teacher_id&&(data.teachers.find(t=>t.id===a.teacher_id)?.name||'未知教師')}{a.result&&<span> · {({success:'成功',failed:'失敗',accepted:'已送出',uncertain:'結果未明'} as Record<string,string>)[a.result]||a.result}</span>}{a.action==='records_cleanup'&&<small className="cleanup-audit-detail">{cleanupSummary(a.details)}</small>}</span><small>{fmt(a.created_at)} · {a.actor_id?person(a.actor_id):'LINE Webhook'}</small></article>;
 return <div className="system-settings">
  <div className="settings-tabs" role="tablist" aria-label="系統管理分類">{tabs.map(({id,label,Icon},i)=><button ref={el=>{buttons.current[i]=el;}} key={id} id={'settings-tab-'+id} role="tab" type="button" aria-selected={tab===id} aria-controls={'settings-panel-'+id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)} onKeyDown={e=>{let next:number;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();setTab(tabs[next].id);buttons.current[next]?.focus();}}><Icon size={17}/>{label}</button>)}</div>
  <div id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" hidden={tab!=='general'}>{tab==='general'&&<>
   <div className="settings-grid settings-overview">
    <section className="panel settings-core-card settings-line-card"><div className="settings-section-heading"><h2>LINE 與系統狀態</h2></div><div className="settings-core-body"><div className="release-info"><span>介面版本</span><b>{APP_VERSION}</b>{publicInfo?.version&&<><span>後端版本</span><b>{publicInfo.version}</b></>}{publicInfo?.version&&publicInfo.version!==APP_VERSION&&<p>前後端版本尚未同步，請重新整理或確認最新正式部署。</p>}</div><div className="status-row">資料來源<span className="badge green">{mock?'本機模擬資料':'Cloudflare D1'}</span></div><div className="status-row">即時更新<span>{realtime}</span></div><div className="settings-status-actions"><button className="outline" disabled={mock||busy} onClick={onCheck}>檢查後端設定</button><details className="settings-advanced"><summary>維護資訊</summary><div className="info">LINE Token、Channel Secret 與安全金鑰請至 Cloudflare Secrets 設定，切勿貼入此網頁。</div><p className="hint">多選教師會逐一傳送私訊，不會建立 LINE 群組。</p></details></div>{system&&<p className="settings-diagnostic">後端版本：{system.version||'前一版'}；LINE 憑證：{system.line_configured?'已設定':'未設定'}；綁定金鑰：{system.binding_configured?'已設定':'未設定'}；真實發送：{system.send_enabled?'已啟用':'未啟用'}</p>}</div></section>
    <section className="panel settings-core-card settings-accounts"><div className="settings-section-heading"><h2>行政帳號權限</h2><span className="count">{data.staff.length}</span></div><div className="settings-core-body"><div className="settings-account-list">{data.staff.map(s=><div className="status-row" key={s.id}><span>{s.display_name}<small>{s.active?'啟用中':'已停用'} · {s.role==='admin'?'管理員':'工讀生'}</small></span>{s.id!==uid&&<button onClick={()=>onStaff(s)}>編輯權限</button>}</div>)}</div><button className="outline" onClick={()=>onStaff(null)}><Plus size={16}/>新增行政帳號</button></div></section>
   </div>
   <section className="panel settings-templates"><div className="settings-section-heading"><h2>通知範本</h2></div><div className="settings-template-grid">{data.templates.map(t=><article className="settings-template-item" key={t.kind}><div><span className="settings-template-icon"><NoticeIcon kind={t.kind} size={18}/></span><h3>{t.label}</h3><button className="text-button" aria-label={`編輯${t.label}範本`} onClick={()=>onTemplate(t)}><Pencil size={14}/>編輯</button></div><p>{t.content||'發送時自行填寫內容'}</p></article>)}</div></section>
  </>}</div>
  <div id="settings-panel-records" role="tabpanel" aria-labelledby="settings-tab-records" hidden={tab!=='records'}>{tab==='records'&&<div className="settings-records-grid">
   <section className="panel settings-operation-history" aria-label="操作紀錄管理"><RecordHistory collapsible={false} memory={memory} title="最近操作紀錄" className="operation-history" items={data.audit_logs} timestamp={a=>a.created_at} label="操作紀錄" dateLabel="操作日期" emptyText="此日期沒有操作紀錄" renderItem={auditRow}/></section>
   <section className="panel settings-handover-history" aria-label="交接紀錄管理"><RecordHistory collapsible={false} memory={memory} searchText={handoverSearch} remoteHandovers title="最近交接紀錄" className="handover-history" items={data.handovers.filter(h=>h.completed_at)} timestamp={h=>h.completed_at} label="交接紀錄" dateLabel="完成日期" emptyText="此日期沒有已完成的交接紀錄" renderItem={renderHandover}/></section>
  </div>}</div>
  <div id="settings-panel-maintenance" role="tabpanel" aria-labelledby="settings-tab-maintenance" hidden={tab!=='maintenance'}>{tab==='maintenance'&&<div className="settings-maintenance">
   <section className="panel settings-tool-card"><div className="settings-section-heading"><h2>紀錄備份</h2></div><div className="settings-tool-body"><RecordBackup state={backup}/></div></section>
   <section className="panel settings-tool-card"><div className="settings-section-heading"><h2>紀錄清理</h2></div><div className="settings-tool-body"><RecordCleanup embedded busy={busy||backup.pending} onCleaned={onCleaned}/></div></section>
  </div>}</div>
 </div>;
}

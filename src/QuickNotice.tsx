import {useEffect,useRef,useState} from 'react';
import {Search,Send,ArrowLeft,Check} from 'lucide-react';
import {command,ApiError,mock,type Data,type PickupItem} from './api';
import {failureText} from './workflow';
import {DuplicateWarning,type PendingPickup} from './DuplicateWarning';
import {NoticeIcon} from './NoticeIcon';
import {pickupMessage} from './notice';

type Props={data:Data;kind:'parcel'|'mail'|'pickup';initialTeacherId?:string;initialItem?:PickupItem;busy:boolean;onAction:(action:string,payload:any,success?:string)=>Promise<any>;onClose:(message?:string)=>void};
export function QuickNotice({data,kind,busy,onAction,onClose,initialTeacherId='',initialItem}:Props){
 const label=kind==='parcel'?'包裹通知':kind==='mail'?'信件通知':'其他待領物品';
 const [query,setQuery]=useState(''),[teacherId,setTeacherId]=useState(initialItem?.teacher_id||initialTeacherId);
 const [pickupName,setPickupName]=useState(initialItem?.pickup_name||''),[location,setLocation]=useState('');
 const [content,setContent]=useState(initialItem?.last_notice_content||initialItem?.content||(kind==='pickup'?pickupMessage(''):data.templates.find(t=>t.kind===kind)?.content||''));
 const [itemId,setItemId]=useState<string|null>(initialItem?.id||null),[preview,setPreview]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<PendingPickup[]>([]),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState(''),[retry,setRetry]=useState(0);
 const request=useRef(crypto.randomUUID()),sending=useRef(false);
 const teacher=data.teachers.find(t=>t.id===teacherId),message=content.trim()+(location.trim()?'\n領取位置：'+location.trim():'');
 const valid=teacher?.active&&(kind!=='pickup'||!!pickupName.trim())&&message.length>0&&message.length<=5000;
 const registerOnly=!teacher?.bound_at;
 useEffect(()=>{
  if(!preview||itemId){setPending([]);return;}
  let cancelled=false;setChecking(true);setCheckError('');
  void command('notification_preflight',{teacher_ids:[teacherId]}).then(result=>{if(!cancelled)setPending(result.pending);}).catch(e=>{if(!cancelled)setCheckError(e.message);}).finally(()=>{if(!cancelled)setChecking(false);});
  return()=>{cancelled=true;};
 },[preview,teacherId,retry,itemId]);
 const send=async()=>{
  if(!valid||busy||checking||checkError||sending.current)return;
  sending.current=true;setError('');
  const common={kind,content:message,request_id:request.current,...(kind==='pickup'?{pickup_name:pickupName.trim()}:{} )};
  try{
   if(registerOnly){
    if(itemId){onClose('物品已保留，待老師綁定後再通知');return;}
    await onAction('pickup_register',{...common,teacher_id:teacherId},'');onClose('物品已登記');return;
   }
   const result=await onAction('send',{...common,teacher_ids:[teacherId],...(itemId?{pickup_item_id:itemId}:{}),duplicate_confirmed:pending.length>0},'');
   const notice=result.results?.[0];
   if(notice?.send_status==='accepted'){onClose(mock?'模擬通知已送出':'通知已送出');return;}
   const savedId=notice?.pickup_item_id||result.data?.[0];
   if(savedId)setItemId(savedId);
   if(notice?.send_status==='failed')request.current=crypto.randomUUID();
   setError(failureText(notice?.error_code)+' 物品已保留於待領取清單。');
  }catch(e){
   setError((e as Error).message);
   if(e instanceof ApiError&&e.code==='DUPLICATE_NOTICE'){request.current=crypto.randomUUID();setRetry(value=>value+1);}
  }finally{sending.current=false;}
 };
 return <div className="quick-notice"><h2><NoticeIcon kind={kind} size={22}/>{preview?(registerOnly?'確認登記物品':'確認發送'+label):initialItem?'重新通知':label}</h2>{preview?<>
  <div className="recipient-tags"><span>{teacher?.name} · {teacher?.department}</span></div>{kind==='pickup'&&<p className="pickup-preview-name">待領物品：{pickupName}</p>}<div className="preview-bubble">{message}</div>
  {registerOnly?<p className="hint">老師尚未綁定 LINE，先保存物品資料，完成綁定後可從物品紀錄通知。</p>:<p className="hint">{mock?'模擬發送，不會連接 LINE。':'將傳送一則 LINE 私訊。'}</p>}
  <DuplicateWarning pending={pending}/>{checking&&<p role="status">正在核對待領取紀錄…</p>}{checkError&&<div className="error" role="alert">{checkError}<button onClick={()=>setRetry(value=>value+1)}>重新核對</button></div>}{error&&<div className="error" role="alert">{error}</div>}
  <div className="quick-actions"><button className="outline" disabled={busy} onClick={()=>setPreview(false)}><ArrowLeft size={16}/>返回編輯</button><button className="primary" disabled={busy||!valid||checking||!!checkError} onClick={()=>void send()}><Send size={16}/>{busy?'處理中…':registerOnly?'僅登記物品':pending.length?'確認仍需通知':'確認發送給 1 位教師'}</button></div>
 </>:<form onSubmit={e=>{e.preventDefault();if(valid)setPreview(true);}}>
  <label htmlFor="quick-teacher-search">通知對象</label>{initialItem?<div className="quick-selection-summary"><Check size={14}/>{teacher?.name} · {teacher?.department}</div>:<><div className="search"><Search size={16}/><input id="quick-teacher-search" autoFocus placeholder="搜尋教師姓名、單位" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="quick-teachers" role="listbox" aria-label="選擇通知教師">{data.teachers.filter(t=>t.active&&(t.name+t.department).includes(query)).map(t=><button type="button" key={t.id} role="option" aria-selected={teacherId===t.id} onClick={()=>setTeacherId(t.id)}><span><b>{t.name}</b><small>{t.department}</small></span><span className={'badge '+(t.bound_at?'green':'orange')}>{t.bound_at?(teacherId===t.id?'已選擇':'可通知'):'僅登記'}</span></button>)}</div>{teacher&&<div className="quick-selection-summary"><Check size={14}/>已選擇 <b>{teacher.name}</b><span>{teacher.department}</span></div>}</>}
  {kind==='pickup'&&<label>物品名稱<input required disabled={!!initialItem} maxLength={80} placeholder="例如：教材、借用器材" value={pickupName} onChange={e=>{if(content===pickupMessage(pickupName))setContent(pickupMessage(e.target.value));setPickupName(e.target.value);}}/></label>}
  <label>領取位置（選填）<input maxLength={120} value={location} onChange={e=>setLocation(e.target.value)} placeholder="例如：辦公室右側置物架"/></label><label>通知內容<textarea aria-label="通知內容" rows={3} required maxLength={5000} value={content} onChange={e=>setContent(e.target.value)}/></label>
  {message.length>5000&&<p role="alert" className="error">含領取位置的訊息不可超過 5,000 字。</p>}<button className="primary full" disabled={busy||!valid}><Send size={17}/>{registerOnly?'預覽登記':'預覽通知'}</button>
 </form>}</div>;
}

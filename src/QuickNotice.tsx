import {useRef,useState} from 'react';
import {Search,Send,ArrowLeft,Package,Mail,Check} from 'lucide-react';
import {mock,type Data} from './api';
import {failureText} from './workflow';
export function QuickNotice({data,kind,busy,onAction,onClose}:{data:Data;kind:'parcel'|'mail';busy:boolean;onAction:(action:string,payload:any,success?:string)=>Promise<any>;onClose:()=>void}){
 const label=kind==='parcel'?'包裹通知':'信件通知',Icon=kind==='parcel'?Package:Mail;
 const [query,setQuery]=useState(''),[teacherId,setTeacherId]=useState(''),[location,setLocation]=useState(''),[content,setContent]=useState(()=>data.templates.find(t=>t.kind===kind)?.content||''),[preview,setPreview]=useState(false),[error,setError]=useState('');
 const request=useRef(crypto.randomUUID()),sending=useRef(false);
 const teacher=data.teachers.find(t=>t.id===teacherId),message=content.trim()+(location.trim()?'\n領取位置：'+location.trim():'');
 const valid=teacher?.active&&teacher.bound_at&&message.length>0&&message.length<=5000;
 const send=async()=>{
  if(!valid||busy||sending.current)return;sending.current=true;setError('');
  try{const r=await onAction('send',{teacher_ids:[teacherId],kind,content:message,request_id:request.current},'');const n=r.results?.[0];if(n?.send_status==='accepted')onClose();else{if(n?.send_status==='failed')request.current=crypto.randomUUID();setError(failureText(n?.error_code));}}catch(e){setError((e as Error).message);}finally{sending.current=false;}
 };
 return <div className="quick-notice"><h2><Icon size={22}/>{preview?'確認發送'+label:label}</h2>{preview?<>
  <div className="recipient-tags"><span>{teacher?.name} · {teacher?.department}</span></div><div className="preview-bubble">{message}</div><p className="hint">{mock?'模擬發送，不會連接 LINE。':'將傳送一則 LINE 私訊。'}</p>
  {error&&<div className="error" role="alert">{error}</div>}<div className="quick-actions"><button className="outline" disabled={busy} onClick={()=>{setPreview(false);request.current=crypto.randomUUID();}}><ArrowLeft size={16}/>返回編輯</button><button className="primary" disabled={busy||!valid} onClick={()=>void send()}><Send size={16}/>{busy?'送出中…':'確認發送給 1 位教師'}</button></div>
 </>:<form onSubmit={e=>{e.preventDefault();if(valid)setPreview(true);}}>
  <label htmlFor="quick-teacher-search">通知對象</label><div className="search"><Search size={16}/><input id="quick-teacher-search" autoFocus placeholder="搜尋教師姓名、單位" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className="quick-teachers" role="listbox" aria-label="選擇通知教師">{data.teachers.filter(t=>t.active&&(t.name+t.department).includes(query)).map(t=><button type="button" key={t.id} role="option" aria-selected={teacherId===t.id} disabled={!t.bound_at} onClick={()=>setTeacherId(t.id)}><span><b>{t.name}</b><small>{t.department}</small></span><span className={'badge '+(t.bound_at?'green':'orange')}>{t.bound_at?(teacherId===t.id?'已選擇':'可通知'):'尚未綁定'}</span></button>)}{!data.teachers.some(t=>t.active&&(t.name+t.department).includes(query))&&<p className="empty">找不到符合條件的教師</p>}</div>
  {teacher&&<div className="quick-selection-summary"><Check size={14}/>已選擇 <b>{teacher.name}</b><span>{teacher.department}</span></div>}
  <label>領取位置（選填）<input maxLength={120} value={location} onChange={e=>setLocation(e.target.value)} placeholder="例如：辦公室右側置物架"/></label>
  <label>通知內容<textarea rows={3} required maxLength={5000} value={content} onChange={e=>setContent(e.target.value)}/></label>
  {message.length>5000&&<p role="alert" className="error">含領取位置的訊息不可超過 5,000 字。</p>}<button className="primary full" disabled={busy||!valid}><Send size={17}/>預覽通知</button>
 </form>}</div>;
}

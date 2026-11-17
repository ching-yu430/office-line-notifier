import {Fragment,useEffect,useRef,useState} from 'react';
import {Search,Send,MessagesSquare,Package,Mail,AlertCircle,ArrowLeft,ArrowDown} from 'lucide-react';
import {command,loadConversation,mock,type Data,type Notice,type Message} from './api';
import {taipeiDay} from './handover-history';
import {conversationStatus,failureText,inboxFor,kindLabel,sortedConversations} from './workflow';
type Props={requests:Map<string,any>;data:Data;actorId:string;role:string;teacherId:string;onSelect:(id:string)=>void;busy:boolean;draft:string;draftTeacherIds?:string[];onDraft:(text:string,teacherId?:string)=>void;onAction:(action:string,payload:any,success?:string)=>Promise<any>;onRefresh:()=>Promise<void>;onPickup:(n:Notice)=>void;onBatchPickup:(teacherId:string)=>void};
const fmt=(v?:string|null)=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
export function MessageCenter({requests,data,actorId,role,teacherId,onSelect,busy,draft,draftTeacherIds=[],onDraft,onAction,onRefresh,onPickup,onBatchPickup}:Props){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[note,setNote]=useState(''),[noteId,setNoteId]=useState(()=>crypto.randomUUID()),[testText,setTestText]=useState(''),[atLatest,setAtLatest]=useState(true),[newCount,setNewCount]=useState(0);
 const panel=useRef<HTMLElement>(null);
 const selectedId=useRef(teacherId);selectedId.current=teacherId;
 const client=useRef(crypto.randomUUID()),lastInput=useRef(0),draftRef=useRef(draft),callbacks=useRef({onAction,onRefresh,onDraft});
 const inFlight=useRef(false),pendingRequests=useRef(requests),feed=useRef<HTMLDivElement>(null),followTail=useRef(true),seenMessages=useRef({teacherId:'',ids:new Set<string>()}),viewed=useRef('');
 const [history,setHistory]=useState<{teacherId:string;messages:Message[];pickups:Notice[]}|null>(null),[historyLoading,setHistoryLoading]=useState(false);
 draftRef.current=draft;callbacks.current={onAction,onRefresh,onDraft};
 const teacher=data.teachers.find(t=>t.id===teacherId),canSend=!!teacher?.active&&!!teacher?.bound_at;
 const inbox=inboxFor(data,teacherId);
 const currentMessages=data.messages.filter(m=>m.teacher_id===teacherId),loaded=history?.teacherId===teacherId?history:null;
 const messages=[...new Map([...(loaded?.messages||[]),...currentMessages].map(m=>[m.id,m])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const pickups=loaded?.pickups||data.notifications.filter(n=>n.teacher_id===teacherId&&n.status==='待領取'&&['mail','parcel'].includes(n.kind));
 const lastVisibleInbound=messages.some(m=>m.id===inbox.latest_inbound_id)?inbox.latest_inbound_id:null;
 const lastId=inbox.latest_inbound_id??null;
 const colleagues=[...new Map((data.presence||[]).filter(p=>p.teacher_id===teacherId&&p.admin_id!==actorId&&p.expires_at>Date.now()/1000).map(p=>[p.admin_id,p])).values()];
 useEffect(()=>{setNote('');setNoteId(crypto.randomUUID());setError('');},[teacherId]);
 useEffect(()=>{
  if(!teacherId)return;let cancelled=false;setHistoryLoading(true);
  void loadConversation(teacherId).then(result=>{if(!cancelled)setHistory({teacherId,...result});}).catch(()=>{if(!cancelled)setError('對話紀錄暫時無法載入，請稍後重新開啟。');}).finally(()=>{if(!cancelled)setHistoryLoading(false);});
  return()=>{cancelled=true;};
 },[teacherId,inbox.latest_at,inbox.latest_inbound_id,data.notifications,data.messages]);
 useEffect(()=>{
  const el=panel.current;if(!el)return;
  const fit=()=>{if(window.innerWidth<=700){el.style.removeProperty('--chat-height');return;}const top=el.getBoundingClientRect().top+window.scrollY;const height=Math.max(560,Math.round(window.innerHeight-top-24));const value=height+'px';if(el.style.getPropertyValue('--chat-height')!==value)el.style.setProperty('--chat-height',value);};
  fit();window.addEventListener('resize',fit);const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(fit);if(el.parentElement)observer?.observe(el.parentElement);
  return()=>{window.removeEventListener('resize',fit);observer?.disconnect();};
 },[]);
 useEffect(()=>{if(teacherId&&window.innerWidth<=700)requestAnimationFrame(()=>panel.current?.scrollIntoView({block:'start'}));},[teacherId]);
 const messageKey=messages.map(m=>m.id).join('|');
 const scrollLatest=()=>{followTail.current=true;setAtLatest(true);setNewCount(0);if(feed.current)feed.current.scrollTop=feed.current.scrollHeight;};
 useEffect(()=>{
  const previous=seenMessages.current,changed=previous.teacherId!==teacherId;
  if(changed){followTail.current=true;setAtLatest(true);setNewCount(0);}
  if(changed||followTail.current){if(feed.current)feed.current.scrollTop=feed.current.scrollHeight;}
  else{const added=messages.filter(m=>m.direction==='in'&&!previous.ids.has(m.id)).length;if(added)setNewCount(n=>n+added);}
  seenMessages.current={teacherId,ids:new Set(messages.map(m=>m.id))};
 },[teacherId,messageKey]);
 useEffect(()=>{
  if(!teacherId||!lastId||lastVisibleInbound!==lastId||!inbox.unread_count||!atLatest)return;
  const key=actorId+':'+teacherId+':'+lastId;
  const mark=()=>{if(document.hidden||viewed.current===key)return;viewed.current=key;void command('conversation_view',{teacher_id:teacherId,message_id:lastId}).then(()=>callbacks.current.onRefresh()).catch(()=>{viewed.current='';setError('未查看提示暫時無法更新，請稍後重新開啟對話。');});};
  mark();document.addEventListener('visibilitychange',mark);return()=>document.removeEventListener('visibilitychange',mark);
 },[actorId,teacherId,lastId,lastVisibleInbound,inbox.unread_count,atLatest]);
 const hasDraft=!!draft.trim();
 useEffect(()=>{
  if(!canSend||!teacherId||!hasDraft)return;
  const teacher=teacherId,clientId=client.current;
  const ping=()=>{const typing=!document.hidden&&Date.now()-lastInput.current<30000;void command('presence',{teacher_id:teacher,client_id:clientId,typing}).catch(()=>{});};
  ping();const timer=setInterval(ping,15000);document.addEventListener('visibilitychange',ping);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',ping);void command('presence',{teacher_id:teacher,client_id:clientId,typing:false}).catch(()=>{});};
 },[canSend,teacherId,hasDraft]);
 const send=async()=>{
  if(!canSend||busy||inFlight.current||!draft.trim())return;
  inFlight.current=true;setError('');const tid=teacherId,content=draft.trim();
  const old=pendingRequests.current.get(tid),payload=old?.content===content?old:{teacher_ids:[tid],kind:'reply',content,request_id:crypto.randomUUID(),last_inbound_id:lastId};
  pendingRequests.current.set(tid,payload);
  try{
   const result=await onAction('send',payload,''),sent=result.results?.[0];
   if(sent?.send_status==='accepted'){
    pendingRequests.current.delete(tid);callbacks.current.onDraft('',tid);requestAnimationFrame(()=>{if(selectedId.current===tid)scrollLatest();});
   }else{
    if(sent?.send_status==='failed')pendingRequests.current.delete(tid);
    setError(failureText(sent?.error_code));
   }
  }catch(e){setError((e as Error).message);}finally{inFlight.current=false;}
 };
 const action=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch(e){setError((e as Error).message);}};
 return <section ref={panel} className={'panel chat-layout'+(teacher?' has-conversation':'')}>
  <div className="chat-list"><div className="panel-head"><h2>教師對話</h2><span className="muted">待回覆優先</span></div>
   <div className="chat-search"><div className="search"><Search size={16}/><input aria-label="搜尋教師對話" placeholder="搜尋姓名、單位" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="chat-tabs">{[['all','全部'],['pending','待回覆'],['unseen','未查看']].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div></div>
   <div className="chat-teachers">{sortedConversations(data,query,filter).map(t=>{const box=inboxFor(data,t.id),status=conversationStatus(data,t.id);return <button key={t.id} className={'chat-teacher '+(teacherId===t.id?'current':'')} onClick={()=>onSelect(t.id)}><span className="avatar soft">{t.name.slice(-1)}</span><span className="chat-teacher-info"><span className="chat-teacher-title"><b>{t.name}</b><time>{fmt(box.latest_at)}</time></span><small>{draftTeacherIds.includes(t.id)?<><span className="draft-label">草稿</span>尚未送出</>:box.latest_content||t.department||'尚無訊息'}</small><span className="chat-teacher-status">{box.latest_at?(status==='待回覆'?'待回覆':'已回覆'):'尚未聯絡'}{box.unread_count>0&&<span className="unseen-count" aria-label={`${t.name}有 ${box.unread_count} 則未查看訊息`}>{box.unread_count}</span>}</span></span></button>;})}</div>
   {!sortedConversations(data,query,filter).length&&<div className="empty">沒有符合條件的對話</div>}
   <p className="chat-list-hint">未查看依目前登入帳號計算</p>
  </div>
  <div className="conversation">{teacher?<>
   <div className="chat-heading"><button className="mobile-chat-back" aria-label="返回教師列表" onClick={()=>onSelect('')}><ArrowLeft size={20}/></button><div><b>{teacher.name}</b><small>{teacher.department}</small></div><span className={'badge '+(canSend?'green':'orange')}>{canSend?'LINE 已綁定':'無法發送'}</span><select aria-label="對話處理狀態" disabled={busy} value={conversationStatus(data,teacherId)} onChange={e=>void action(()=>onAction('conversation_status',{teacher_id:teacherId,status:e.target.value},'對話狀態已更新'))}><option value="待回覆">待回覆</option><option value="已完成">已回覆</option></select></div>
   <details className="internal-notes"><summary>內部備註 <span className="count">{data.internal_notes.filter(n=>n.teacher_id===teacherId).length}</span><small>僅限辦公室，不會傳送 LINE</small></summary><div className="internal-note-list">{data.internal_notes.filter(n=>n.teacher_id===teacherId).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(n=><article key={n.id}><p>{n.content}</p><small>{n.author_name} · {fmt(n.created_at)}</small></article>)}{!data.internal_notes.some(n=>n.teacher_id===teacherId)&&<p className="note-empty">尚無內部備註</p>}</div><form onSubmit={e=>{e.preventDefault();void action(async()=>{const tid=teacherId;await onAction('internal_note_create',{id:noteId,teacher_id:tid,content:note},'內部備註已儲存，未發送 LINE');if(selectedId.current===tid){setNote('');setNoteId(crypto.randomUUID());}});}}><label>新增內部備註<textarea disabled={busy} rows={2} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="outline" disabled={busy||!note.trim()}>儲存內部備註</button></form></details>
   <details className="chat-pickups" open><summary><Package size={16}/>待領取物品 <span className="count">{pickups.length}</span></summary><div>{pickups.length>1&&<button className="outline batch-pickup-entry" disabled={busy} onClick={()=>onBatchPickup(teacherId)}>多筆領取</button>}{pickups.map(n=><article key={n.id}>{n.kind==='mail'?<Mail size={17}/>:<Package size={17}/>}<span><b>{kindLabel[n.kind]}</b><small>{fmt(n.created_at)} · {n.content}</small></span><button className="outline" disabled={busy} onClick={()=>onPickup(n)}>登記已領取</button></article>)}{!pickups.length&&<p className="muted">目前沒有待領取物品</p>}</div></details>
   <div className="chat-feed"><div className="messages" ref={feed} onScroll={e=>{const el=e.currentTarget,near=el.scrollHeight-el.scrollTop-el.clientHeight<70;followTail.current=near;setAtLatest(near);if(near)setNewCount(0);}}>{historyLoading&&<p className="muted" role="status">正在載入對話…</p>}{!messages.length&&!historyLoading&&<div className="empty chat-empty"><MessagesSquare size={30}/><p>尚無對話，可直接傳送文字訊息</p></div>}{messages.map((m,i)=>{const day=taipeiDay(new Date(m.created_at)),newDay=i===0||day!==taipeiDay(new Date(messages[i-1].created_at));return <Fragment key={m.id}>{newDay&&<div className="chat-day" role="separator"><span>{day===taipeiDay(new Date())?'今天':new Date(m.created_at).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',month:'long',day:'numeric'})}</span></div>}<div className={'message '+(m.direction==='out'?'out':'')}><div>{m.content}</div><small>{m.direction==='out'?(m.sender_name||data.staff.find(s=>s.id===data.notifications.find(n=>n.id===m.notification_id)?.sender_id)?.display_name||'辦公室'):'教師'} · {new Date(m.created_at).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'})}{m.direction==='out'?(mock?' · 模擬發送':' · 已送出'):''}</small></div></Fragment>;})}</div>{!atLatest&&newCount>0&&<button className="new-messages-button" onClick={scrollLatest}><ArrowDown size={15}/>{newCount} 則新訊息，查看最新</button>}</div>
   <div className="typing-presence" aria-live="polite">{colleagues.length>0?<><span className="dot"/>{colleagues.map(p=>p.display_name).join('、')}正在回覆</>:null}</div>
   {error&&<div className="chat-error" role="alert"><AlertCircle size={17}/><span>{error}</span></div>}
   <p className="attachment-hint">文件及附件請使用辦公室 Email 傳送</p>
   <div className="reply-shortcuts"><span>常用回覆</span>{['好的，辦公室已收到，我們會協助處理。','歡迎於辦公時間前來領取，謝謝！','我們確認後會再回覆您，謝謝等候。'].map(text=><button key={text} disabled={busy} onClick={()=>{lastInput.current=Date.now();onDraft(text);}}>{text.includes('領取')?'告知領取':text.includes('確認後')?'稍後確認':'收到，協助處理'}</button>)}</div>
   <form className="reply-input" onSubmit={e=>{e.preventDefault();void send();}}><div className="reply-draft"><textarea aria-label="回覆老師" rows={2} disabled={busy||!canSend} maxLength={5000} placeholder="輸入訊息…" value={draft} onChange={e=>{lastInput.current=Date.now();onDraft(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing&&!e.repeat){e.preventDefault();void send();}}}/><div className="reply-editor-meta"><span>Enter 換行 · Ctrl＋Enter 送出</span><span>{draft.length?`${draft.length} / 5,000`:null}</span></div></div><button className="primary" disabled={busy||!draft.trim()||!canSend}><Send size={17}/>{busy?'送出中…':'送出'}</button></form>
   {mock&&<div className="mock-tools"><input aria-label="模擬老師回覆" placeholder="模擬老師從 LINE 回覆" value={testText} onChange={e=>setTestText(e.target.value)}/><button disabled={busy||!testText.trim()} onClick={()=>void action(async()=>{await onAction('mock_inbound',{teacher_id:teacherId,content:testText},'已收到模擬教師回覆');setTestText('');})}>模擬接收</button></div>}
  </>:<div className="empty"><MessagesSquare size={42}/><h2>選擇教師，開始對話</h2><p>教師的 LINE 文字回覆會直接顯示在這裡。</p></div>}</div>
 </section>;
}

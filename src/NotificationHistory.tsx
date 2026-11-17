import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Search,SlidersHorizontal,RotateCcw,RefreshCw,ChevronLeft,ChevronRight} from 'lucide-react';
import {loadNoticePage,mock,type Data,type Notice,type NoticePage} from './api';
import {taipeiDay} from './handover-history';
import type {PageMemory} from './page-memory';
const results:Record<string,string>={all:'全部發送結果',attention:'需要檢查',queued:'待發送',sending:'傳送中',accepted:'已送出',failed:'發送失敗',uncertain:'結果未明'};
export function NotificationHistory({data,initialTeacher='',initialStatus='全部狀態',initialSend='all',renderRows,memory}:{data:Data;initialTeacher?:string;initialStatus?:string;initialSend?:string;renderRows:(rows:Notice[])=>ReactNode;memory:PageMemory}){
 const saved=useRef(memory.get('notifications')||{}).current,scroll=useRef<HTMLDivElement>(null),restore=useRef(true),mounted=useRef(false);
 const [query,setQuery]=useState(saved.query||''),[status,setStatus]=useState(saved.status||initialStatus),[teacher,setTeacher]=useState(saved.teacher??initialTeacher),[send,setSend]=useState(saved.send||initialSend),[period,setPeriod]=useState(saved.period||'all'),[from,setFrom]=useState(saved.from||''),[to,setTo]=useState(saved.to||''),[page,setPage]=useState(saved.page||1),[refresh,setRefresh]=useState(0),[remote,setRemote]=useState<(NoticePage&{key:string})|null>(null),[loading,setLoading]=useState(!mock),[error,setError]=useState('');
 useEffect(()=>{if(mounted.current){setPage(1);if(scroll.current)scroll.current.scrollTop=0;}mounted.current=true;},[query,status,teacher,send,period,from,to]);
 useEffect(()=>{memory.set('notifications',{...memory.get('notifications'),query,status,teacher,send,period,from,to,page});},[query,status,teacher,send,period,from,to,page,memory]);
 useLayoutEffect(()=>{if(!loading&&restore.current&&scroll.current){scroll.current.scrollTop=saved.scroll||0;window.scrollTo(0,saved.windowScroll||0);restore.current=false;}},[loading,remote]);
 const today=taipeiDay(new Date()),week=taipeiDay(new Date(Date.now()-6*86400000));
 const filtered=data.notifications.filter(n=>{const day=taipeiDay(new Date(n.sent_at||n.created_at)),name=data.teachers.find(t=>t.id===n.teacher_id)?.name||'';return (name+n.content).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())&&(status==='全部狀態'||n.status===status)&&(!teacher||n.teacher_id===teacher)&&(send==='all'||(send==='attention'?['failed','uncertain'].includes(n.send_status):n.send_status===send))&&(period==='all'||(period==='today'?day===today:period==='week'?day>=week&&day<=today:(!from||day>=from)&&(!to||day<=to)));});
 const params=new URLSearchParams({page:String(page)});
 if(query.trim())params.set('query',query.trim());if(status!=='全部狀態')params.set('status',status);if(teacher)params.set('teacher',teacher);if(send!=='all')params.set('send',send);
 if(period==='today'){params.set('from',today);params.set('to',today);}else if(period==='week'){params.set('from',week);params.set('to',today);}else if(period==='range'){if(from)params.set('from',from);if(to)params.set('to',to);}
 const key=params.toString(),liveKey=data.notifications.map(n=>[n.id,n.version,n.status,n.send_status].join(':')).join('|');
 useEffect(()=>{const changed=()=>setRefresh(n=>n+1);window.addEventListener('office-notices-changed',changed);return()=>window.removeEventListener('office-notices-changed',changed);},[]);
 useEffect(()=>{
  if(mock)return;let cancelled=false;setLoading(true);setError('');
  const timer=setTimeout(()=>{void loadNoticePage(new URLSearchParams(key)).then(result=>{if(!cancelled)setRemote({...result,key});}).catch(e=>{if(!cancelled)setError((e as Error).message);}).finally(()=>{if(!cancelled)setLoading(false);});},200);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[key,liveKey,refresh]);
 const count=mock?filtered.length:remote?.key===key?remote.total:0,pages=mock?Math.max(1,Math.ceil(count/10)):remote?.key===key?remote.pages:1,current=mock?Math.min(page,pages):remote?.key===key?remote.page:1,offset=(current-1)*10;
 const rows=mock?filtered.slice(offset,offset+10):remote?.key===key?remote.notices:[];

 const clear=()=>{setQuery('');setStatus('全部狀態');setTeacher('');setSend('all');setPeriod('all');setFrom('');setTo('');setPage(1);};
 const dirty=!!query||status!=='全部狀態'||!!teacher||send!=='all'||period!=='all';
 return <section className="panel notice-history"><div className="toolbar wrap"><div className="search"><Search size={17}/><input aria-label="搜尋通知" maxLength={200} placeholder="搜尋教師、訊息內容" value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label="處理狀態" value={status} onChange={e=>setStatus(e.target.value)}>{[['全部狀態','全部處理狀態'],['待領取','待領取'],['待回覆','待回覆'],['已完成','已領取／已處理']].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><select aria-label="發送結果" value={send} onChange={e=>setSend(e.target.value)}>{Object.entries(results).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label="教師篩選" value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">全部教師</option>{data.teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
  <div className="notice-filters"><div className="period-buttons" aria-label="通知日期篩選"><SlidersHorizontal size={14}/>{[['all','全部日期'],['today','今日'],['week','近一週'],['range','指定期間']].map(([value,label])=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div>{period==='range'&&<div className="notice-range"><label>起<input type="date" aria-label="通知起始日期" value={from} onChange={e=>setFrom(e.target.value)}/></label><span>—</span><label>迄<input type="date" aria-label="通知結束日期" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}<button className="text-button refresh-notices" disabled={loading} aria-label="重新載入通知紀錄" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={13}/>重新載入</button><button className="text-button reset-filters" disabled={!dirty} onClick={clear}><RotateCcw size={13}/>清除篩選</button></div>
  {from&&to&&period==='range'&&from>to&&<p className="error" role="alert">起始日期需早於或等於結束日期。</p>}
  {send==='uncertain'&&<div className="info">結果未明可能已送出，請先核對，避免重複發送。</div>}
  <div className="notice-result-summary"><span>{loading?'正在查詢…':<>符合 <b>{count}</b> 筆</>}</span><span>每頁 10 筆</span></div>
  <div className="notice-results" ref={scroll} onScroll={e=>{if(!loading&&!restore.current)memory.set('notifications',{...memory.get('notifications'),scroll:e.currentTarget.scrollTop});}} onClickCapture={()=>memory.set('notifications',{...memory.get('notifications'),windowScroll:window.scrollY})} aria-busy={loading}>{loading?<div className="empty" role="status">正在載入通知紀錄…</div>:error?<div className="error" role="alert">{error}</div>:renderRows(rows)}</div>
  {!loading&&!error&&count>10&&<div className="list-pagination"><span>第 {offset+1}–{Math.min(offset+10,count)} 筆，共 {count} 筆</span><div><button className="outline" aria-label="上一頁通知" disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={15}/>上一頁</button><span>{current} / {pages}</span><button className="outline" aria-label="下一頁通知" disabled={current===pages} onClick={()=>setPage(current+1)}>下一頁<ChevronRight size={15}/></button></div></div>}
  <p className="history-scope">{mock?'展示版使用本機虛構紀錄。':'可查詢資料庫中保存的全部通知，每頁載入 10 筆。'}</p>
 </section>;
}

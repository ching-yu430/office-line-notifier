import {useEffect,useState} from 'react';
import {Search,RefreshCw} from 'lucide-react';
import {command,type Data,type PickupItem} from './api';
import {noticeLabel} from './notice';
import {NoticeIcon} from './NoticeIcon';

type Props={data:Data;busy:boolean;onPickup:(item:PickupItem)=>void;onNotify:(item:PickupItem)=>void;onCancel:(item:PickupItem)=>void};
export function PickupHistory({data,busy,onPickup,onNotify,onCancel}:Props){
 const [query,setQuery]=useState(''),[status,setStatus]=useState('待領取'),[page,setPage]=useState(1),[reload,setReload]=useState(0);
 const [result,setResult]=useState<{items:PickupItem[];total:number;pages:number;page:number}>({items:[],total:0,pages:1,page:1}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');const timer=setTimeout(()=>void command('pickup_items_query',{query,status,page}).then(result=>{if(!cancelled)setResult(result);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);}),150);return()=>{cancelled=true;clearTimeout(timer);};},[query,status,page,reload]);
 return <section className="pickup-history"><h2>物品紀錄</h2><div className="pickup-history-filters"><div className="search"><Search size={16}/><input aria-label="搜尋物品" maxLength={200} placeholder="教師、物品、內容" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></div><select aria-label="物品狀態" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{[['待領取','待領取'],['已完成','已領取'],['已取消','已取消'],['全部','全部狀態']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="text-button" aria-label="重新載入物品" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={15}/></button></div>
  {error&&<div className="error" role="alert">{error}</div>}<div className="pickup-history-list" aria-busy={loading}>{loading?<p className="empty" role="status">正在載入物品…</p>:result.items.map(item=><article key={item.id}><div className="pickup-history-title"><NoticeIcon {...item} size={20}/><b>{data.teachers.find(t=>t.id===item.teacher_id)?.name||'教師'} · {noticeLabel(item)}</b><span className="badge">{item.status==='已完成'?'已領取':item.status}</span></div><p>{item.content}</p><small>{new Date(item.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}{item.cancellation_reason&&' · '+item.cancellation_reason}</small>{item.status==='待領取'&&<div className="pickup-row-actions"><button className="outline" disabled={busy} onClick={()=>onPickup(item)}>登記已領取</button><button className="text-button" disabled={busy} onClick={()=>onNotify(item)}>重新通知</button><button className="text-button" disabled={busy} onClick={()=>onCancel(item)}>取消登記</button></div>}</article>)}{!loading&&!result.items.length&&<p className="empty">沒有符合條件的物品</p>}</div>
  <div className="history-pagination"><button className="outline" disabled={loading||page===1} onClick={()=>setPage(page-1)}>上一頁</button><span>{result.page} / {result.pages} · {result.total} 筆</span><button className="outline" disabled={loading||page>=result.pages} onClick={()=>setPage(page+1)}>下一頁</button></div>
 </section>;
}

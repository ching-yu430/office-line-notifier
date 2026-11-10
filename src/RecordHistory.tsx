import {useEffect,useState,type ReactNode} from 'react';
import {ChevronRight} from 'lucide-react';
import {filterDatedRecords,taipeiDay,type HistoryPeriod} from './handover-history';
type Props<T>={title:string;className:string;items:T[];timestamp:(item:T)=>string|null;renderItem:(item:T)=>ReactNode;label:string;dateLabel:string;emptyText:string;defaultOpen?:boolean};
export function RecordHistory<T>({title,className,items,timestamp,renderItem,label,dateLabel,emptyText,defaultOpen=false}:Props<T>){
 const [open,setOpen]=useState(defaultOpen),[period,setPeriod]=useState<HistoryPeriod>('today'),[date,setDate]=useState(()=>taipeiDay(new Date())),[page,setPage]=useState(1);
 useEffect(()=>{setPage(1);},[period,date]);
 const filtered=filterDatedRecords(items,timestamp,period,date),pages=Math.max(1,Math.ceil(filtered.length/5)),currentPage=Math.min(page,pages);
 return <details className={`record-history ${className}`} open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary><ChevronRight size={17}/><span>{title}</span><span className="count">{items.length}</span></summary>
  <div className="history-filters"><div className="history-periods" role="group" aria-label={`${label}日期篩選`}>{([['today','今日'],['week','近一週'],['date','特定日期']] as const).map(([value,text])=><button key={value} type="button" aria-pressed={period===value} onClick={()=>setPeriod(value)}>{text}</button>)}</div>{period==='date'&&<label className="history-date">日期<input type="date" aria-label={`${label}日期`} value={date} onChange={e=>setDate(e.target.value)}/></label>}<small>{filtered.length} 筆 · 依{dateLabel}篩選（台灣時間）</small></div>
  <div className="history-list" role="region" tabIndex={0} aria-label={`${title}清單`}>{filtered.slice((currentPage-1)*5,currentPage*5).map(renderItem)}{!filtered.length&&<div className="empty">{emptyText}</div>}</div>
  {filtered.length>5&&<div className="history-pagination"><button className="outline" aria-label={`上一頁${label}`} disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一頁</button><span>{currentPage} / {pages}</span><button className="outline" aria-label={`下一頁${label}`} disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一頁</button></div>}
 </details>;
}

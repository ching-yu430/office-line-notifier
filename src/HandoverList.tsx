import {useState,type ReactNode} from 'react';
import {Search,ChevronDown,ClipboardList,Plus} from 'lucide-react';
import type {Handover} from './api';
export const handoverSearch=(h:Handover)=>[h.content,h.handover_name,h.finisher_name||''].join(' ').toLocaleLowerCase();
export function HandoverList({items,renderItem,onCreate}:{items:Handover[];renderItem:(h:Handover)=>ReactNode;onCreate:()=>void}){
 const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(false);
 const filtered=items.filter(h=>handoverSearch(h).includes(query.trim().toLocaleLowerCase())).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const more=expanded||!!query.trim();
 return <><div className="panel-head handover-heading"><h2 id="handover-title"><ClipboardList size={19}/>交接事項 <span className="count">{items.length}</span></h2><div className="handover-search search"><Search size={17}/><input aria-label="搜尋待交接事項" placeholder="搜尋內容、交接人" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="primary" onClick={onCreate}><Plus size={17}/>新增交接</button></div><div className={'handover-pending'+(more?' expanded':'')}>{filtered.slice(0,more?filtered.length:3).map(renderItem)}{!filtered.length&&<div className="empty">{query?'找不到符合條件的交接事項':'目前沒有待交接事項'}</div>}</div>{!query&&filtered.length>3&&<button className="text-button handover-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><ChevronDown size={16}/>{expanded?'收合交接事項':`展開其餘 ${filtered.length-3} 筆交接事項`}</button>}</>;
}

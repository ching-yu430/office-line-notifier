import {useEffect,useId,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import type {PageMemory} from './page-memory';
export function SettingsPanel({title,summary,children,memory,panelKey,className='',defaultOpen=false}:{title:string;summary?:string;children:ReactNode;memory:PageMemory;panelKey:string;className?:string;defaultOpen?:boolean}){
 const [open,setOpen]=useState<boolean>(memory.get(panelKey)?.open??defaultOpen),id=useId();
 useEffect(()=>{memory.set(panelKey,{open});},[open,memory,panelKey]);
 return <section className={'panel settings-card '+className}><h2 className="settings-panel-heading" aria-label={title}><button type="button" className="settings-panel-toggle" aria-label={title} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><span><span className="settings-panel-title">{title}</span>{!open&&summary&&<small>{summary}</small>}</span><ChevronDown size={18} className={open?'expanded':''}/></button></h2><div id={id} className="settings-card-body" hidden={!open}>{children}</div></section>;
}

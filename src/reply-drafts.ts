import {useLayoutEffect,useRef,useState} from 'react';

const prefix='office-reply-drafts-v1:';
const lifetime=8*60*60*1000;
type SavedDrafts={expires:number;drafts:Record<string,string>;requests:[string,any][]};
function read(actor:string):SavedDrafts {
 const empty={expires:Date.now()+lifetime,drafts:{},requests:[]};
 if(!actor)return empty;
 try{
  const saved=JSON.parse(sessionStorage.getItem(prefix+actor)||'null');
  if(!saved||saved.expires<=Date.now()||!saved.drafts||typeof saved.drafts!=='object'||!Array.isArray(saved.requests))return empty;
  const drafts:Record<string,string>={};
  for(const [teacher,value] of Object.entries(saved.drafts)){if(/^[A-Za-z0-9_-]{1,80}$/.test(teacher)&&typeof value==='string'&&value.length<=5000)drafts[teacher]=value;}
  const requests=saved.requests.filter((entry:any)=>Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&typeof entry[1]?.content==='string'&&entry[1].content.length<=5000&&typeof entry[1].request_id==='string');
  return {expires:saved.expires,drafts,requests};
 }catch{return empty;}
}
export function clearReplyDrafts(actor:string){try{sessionStorage.removeItem(prefix+actor);}catch{}}
export function savePendingReplies(actor:string,requests:Map<string,any>){
 if(!actor)return;
 try{const saved=read(actor);sessionStorage.setItem(prefix+actor,JSON.stringify({...saved,requests:[...requests]}));}catch{}
}
export function useReplyDrafts(actor:string,requests:Map<string,any>){
 const [drafts,setDrafts]=useState<Record<string,string>>({}),owner=useRef('');
 useLayoutEffect(()=>{
  if(owner.current&&owner.current!==actor)clearReplyDrafts(owner.current);
  owner.current=actor;const saved=read(actor);setDrafts(saved.drafts);requests.clear();for(const [teacher,payload]of saved.requests)requests.set(teacher,payload);
 },[actor,requests]);
 const update=(teacher:string,value:string)=>{
  setDrafts(current=>{
   const next={...current};if(value)next[teacher]=value;else delete next[teacher];
   if(actor)try{sessionStorage.setItem(prefix+actor,JSON.stringify({expires:Date.now()+lifetime,drafts:next,requests:[...requests]}));}catch{}
   return next;
  });
 };
 const clear=()=>{clearReplyDrafts(owner.current);requests.clear();setDrafts({});};
 return {drafts,update,clear};
}

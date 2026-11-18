import {Check,MessageCircle} from 'lucide-react';
export function ConversationStatus({value,busy,onChange}:{value:string;busy:boolean;onChange:(value:'待回覆'|'已完成')=>void}){
 return <div className="conversation-status-controls" role="group" aria-label="對話處理狀態" aria-busy={busy}>
  <button type="button" disabled={busy} aria-pressed={value==='待回覆'} onClick={()=>{if(value!=='待回覆')onChange('待回覆');}}><MessageCircle size={14}/>待回覆</button>
  <button type="button" disabled={busy} aria-pressed={value==='已完成'} onClick={()=>{if(value!=='已完成')onChange('已完成');}}><Check size={14}/>已回覆</button>
 </div>;
}

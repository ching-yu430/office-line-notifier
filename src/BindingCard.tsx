import {useMemo,useState} from 'react';
import qrcode from 'qrcode-generator';
import {Copy,Download,Link2} from 'lucide-react';
import {mock} from './api';
export function BindingCard({name,code,expires_at,binding_link}:{name:string;code:string;expires_at:string;binding_link?:string|null}){
 const [feedback,setFeedback]=useState('');
 const qr=useMemo(()=>{if(!binding_link)return '';const q=qrcode(0,'M');q.addData(binding_link);q.make();return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(q.createSvgTag({cellSize:5,margin:20,scalable:true}));},[binding_link]);
 const copy=async(value:string,label:string)=>{try{await navigator.clipboard.writeText(value);setFeedback(label+'已複製');}catch{setFeedback('無法自動複製，請選取綁定碼後複製。');}};
 return <div className="binding-card"><div className="modal-icon"><Link2/></div><h2>{name}的身分綁定</h2>
 {qr&&<img className="binding-qr" src={qr} alt={`${name}的個人綁定 QR Code`}/>}
 {mock?<p className="info">展示版 QR Code 僅供預覽，請使用模擬綁定測試。</p>:binding_link?<p>老師掃描或點開連結，在 LINE 按「傳送」即可綁定。首次使用請先加入官方帳號好友。</p>:<p className="info">暫時無法取得官方帳號連結。請老師加入好友後，傳送下方綁定碼。</p>}
 <div className="code">{code}</div><p className="hint">有效至 {new Date(expires_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}（台灣時間）</p>
 <div className="binding-actions">{binding_link&&<><button className="primary" onClick={()=>void copy(binding_link,'綁定連結')}><Copy size={16}/>複製綁定連結</button><a className="outline" href={qr} download="教師綁定QR.svg"><Download size={16}/>下載 QR Code</a></>}<button className="outline" onClick={()=>void copy(code,'綁定碼')}>複製綁定碼</button></div>
 <p className="hint">僅交給指定老師。連結與 QR Code 含一次性綁定碼；關閉後無法再次查看，重新產生會使舊碼失效。</p>{feedback&&<p role="status">{feedback}</p>}
 </div>;
}

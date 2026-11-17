import {useState} from 'react';
import {ArrowUpRight,Eye,EyeOff,LockKeyhole,AlertCircle} from 'lucide-react';
import {OfficeLogo} from './OfficeLogo';
import type {PublicInfo} from './api';
export function Login({busy,error,info,onSignIn}:{busy:boolean;error:string;info:PublicInfo|null;onSignIn:(username:string,password:string)=>Promise<void>}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false);
 const preview=!!info?.origin&&info.origin!==window.location.origin;
 return <div className="login"><form className="login-card" onSubmit={async e=>{e.preventDefault();if(preview||busy)return;try{await onSignIn(username,password);}finally{setPassword('');setShow(false);}}}>
  <div className="login-brand"><OfficeLogo/><span>辦公室共同值班</span></div><h1>辦公室小幫手</h1><p>使用辦公室帳號登入</p>
  {preview&&<div className="login-origin-note" role="alert"><AlertCircle size={19}/><div><b>請從正式網站登入</b><p>目前開啟的是預覽網址。</p><a className="primary" href={info!.origin+'/'}>前往正式網站<ArrowUpRight size={16}/></a></div></div>}
  <label>登入帳號<input required autoComplete="username" value={username} disabled={busy||preview} onChange={e=>setUsername(e.target.value)} placeholder="輸入帳號"/></label>
  <label htmlFor="login-password">密碼</label><div className="password-field"><input id="login-password" type={show?'text':'password'} required autoComplete="current-password" value={password} disabled={busy||preview} onChange={e=>setPassword(e.target.value)} placeholder="輸入密碼"/><button type="button" disabled={busy||preview} aria-label={show?'隱藏密碼':'顯示密碼'} aria-pressed={show} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
  {error&&!preview&&<div role="alert" className="error">{error}</div>}<button className="primary login-submit" disabled={busy||preview}>{busy?'登入中…':<><LockKeyhole size={17}/>登入辦公室</>}</button>
  <p className="login-help">帳號問題請聯絡辦公室管理員</p>
 </form></div>;
}

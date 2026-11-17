import type {Env} from './types';
// 只查詢官方帳號公開識別，不回傳或記錄 Token；無法取得時仍可使用手動綁定碼。
export function bindingLink(basicId:string,code:string){
 if(!/^@[a-zA-Z0-9._-]{1,64}$/.test(basicId)||! /^[A-Z2-9]{12}$/.test(code))return null;
 return `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(code)}`;
}
export async function resolveBindingLink(env:Env,code:string):Promise<string|null>{
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)return null;
 try{const r=await fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN},signal:AbortSignal.timeout(5000)});if(!r.ok)return null;const info=await r.json() as {basicId?:string};return bindingLink(info.basicId||'',code);}catch{return null;}
}

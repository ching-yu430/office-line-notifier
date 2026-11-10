
export function generateCode(): string {
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 return Array.from(crypto.getRandomValues(new Uint8Array(12)), n=>alphabet[n%32]).join('');
}
export async function hashCode(code:string, pepper:string):Promise<string> {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(code.trim().toUpperCase().replace(/[ -]/g,'')));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifySignature(raw:string, signature:string|null, secret:string):Promise<boolean> {
 if(!signature || !secret) return false;
 try {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),x=>x.charCodeAt(0)),new TextEncoder().encode(raw));
 } catch { return false; }
}
export function parseEvents(raw:string):any[] {
 const body=JSON.parse(raw);
 if(!Array.isArray(body.events)||body.events.length>100) throw Error('格式錯誤');
 for(const e of body.events) if(typeof e.webhookEventId!=='string'||!e.webhookEventId||typeof e.type!=='string'||!e.source||typeof e.source.type!=='string') throw Error('事件格式錯誤');
 return body.events;
}

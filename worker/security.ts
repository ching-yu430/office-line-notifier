
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

export const PASSWORD_ITERATIONS=600000;
const encoder=new TextEncoder();
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function sha256(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
// 使用目前 Runtime 支援的 PBKDF2-SHA256 600,000 次，再以獨立後端 pepper 保護資料庫外洩。
export async function passwordHash(password:string,pepper:string,salt=randomToken(),iterations=PASSWORD_ITERATIONS){
 const secret=await hashCodeRaw(password,pepper);
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations},key,256);
 return `pbkdf2-sha256$${iterations}$${salt}$${Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
async function hashCodeRaw(value:string,pepper:string){const key=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export async function passwordValid(password:string,hash:string,pepper:string){const [type,n,salt,digest]=hash.split('$');if(type!=='pbkdf2-sha256'||Number(n)!==PASSWORD_ITERATIONS||!salt||!digest)return false;return equal(await passwordHash(password,pepper,salt,Number(n)),hash);}
export async function limitedBody(req:Request,max:number){
 if(Number(req.headers.get('content-length')||0)>max)throw new Error('body_too_large');
 const reader=req.body?.getReader();if(!reader)return '';let total=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('body_too_large');}parts.push(value);}
 const all=new Uint8Array(total);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}return new TextDecoder().decode(all);
}

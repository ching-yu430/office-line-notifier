import type{D1Database,D1PreparedStatement,Fetcher}from'@cloudflare/workers-types';
export interface Env {
 DB:D1Database; ASSETS?:Fetcher;
 ALLOWED_ORIGIN:string; COOKIE_SECURE?:string; LINE_SEND_ENABLED?:string;
 AUTH_PEPPER:string; BINDING_PEPPER:string;
 LINE_CHANNEL_SECRET?:string; LINE_CHANNEL_ACCESS_TOKEN?:string;
}
export type Actor={id:string;username:string;display_name:string;role:'admin'|'staff';active:number};
export class HttpError extends Error {constructor(public status:number,message:string,public code?:string){super(message);}}
export const iso=()=>new Date().toISOString();
export const unix=()=>Math.floor(Date.now()/1000);
export function text(v:unknown,label:string,max=5000,min=1):string{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw new HttpError(400,`${label}請填寫 ${min} 至 ${max} 字`);return v.trim();}
export function id(v:unknown):string{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v))throw new HttpError(400,'識別碼格式錯誤');return v;}
export function admin(actor:Actor){if(actor.role!=='admin')throw new HttpError(403,'需要管理員權限');}
export const rows=async<T=any>(s:D1PreparedStatement)=>(await s.all<T>()).results;
export function audit(db:D1Database,actor:string|null,action:string,teacher:string|null=null,result='success',extra:{handover?:string;note?:string}={}){
 return db.prepare('INSERT INTO audit_logs(id,actor_id,action,result,teacher_id,handover_id,internal_note_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,result,teacher,extra.handover||null,extra.note||null,iso());
}

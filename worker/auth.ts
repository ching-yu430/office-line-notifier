import{type Env,type Actor,HttpError,unix,iso,text,audit}from'./types';
import{sha256,randomToken,passwordHash,passwordValid,equal,hashCode}from'./security';
export const cookieName=(env:Env)=>env.COOKIE_SECURE==='false'?'office_session':'__Host-office_session';
export function cookie(value:string,env:Env,age=8*3600){return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${env.COOKIE_SECURE==='false'?'':'; Secure'}`;}
export async function limit(env:Env,key:string,max:number,seconds:number){
 const now=unix();const row=await env.DB.prepare(`INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING hits`).bind(key,now+seconds,now,now).first<{hits:number}>();
 if(!row||row.hits>max)throw new HttpError(429,'嘗試次數過多，請稍後再試');
}
export async function session(req:Request,env:Env){
 const token=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(env)+'='))?.slice(cookieName(env).length+1);
 if(!token||!/^[a-f0-9]{64}$/.test(token))throw new HttpError(401,'請先登入');
 const found=await env.DB.prepare(`SELECT a.id,a.username,a.display_name,a.role,a.active,s.csrf_hash,s.csrf_token,s.token_hash FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),unix()).first<Actor&{csrf_hash:string;csrf_token:string;token_hash:string}>();
 if(!found)throw new HttpError(401,'登入已失效，請重新登入');return found;
}
export async function csrf(req:Request,s:{csrf_hash:string}){const value=req.headers.get('x-csrf-token')||'';if(!equal(await sha256(value),s.csrf_hash))throw new HttpError(403,'安全驗證失效，請重新登入');}
export async function login(req:Request,env:Env,body:any){
 if(env.AUTH_PEPPER?.length<32||!env.AUTH_PEPPER)throw new HttpError(503,'後端尚未設定登入金鑰');
 const username=text(body.username,'帳號',120).toLowerCase();const password=typeof body.password==='string'?body.password:'';
 if(password.length<1||password.length>256)throw new HttpError(400,'請輸入密碼');
 const ip=req.headers.get('CF-Connecting-IP')||'local';
 await limit(env,'login-ip:'+await hashCode(ip,env.AUTH_PEPPER),30,900);
 await limit(env,'login-account:'+await hashCode(username,env.AUTH_PEPPER),5,900);
 const actor=await env.DB.prepare('SELECT * FROM admins WHERE username=? COLLATE NOCASE').bind(username).first<Actor&{password_hash:string}>();
 // 不存在的帳號也做同等成本的驗證，不回傳帳號是否存在。
 const hash=actor?.password_hash||`pbkdf2-sha256$600000$0000000000000000000000000000000000000000000000000000000000000000$${'0'.repeat(64)}`;
 const valid=await passwordValid(password,hash,env.AUTH_PEPPER);
 if(!valid||!actor?.active){await audit(env.DB,actor?.id||null,'login',null,'failed').run();throw new HttpError(401,'帳號或密碼錯誤，或帳號已停用');}
 const token=randomToken(),csrfToken=randomToken(),now=unix();
 await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
  env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now),
  env.DB.prepare('INSERT INTO sessions(token_hash,admin_id,csrf_hash,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(await sha256(token),actor.id,await sha256(csrfToken),csrfToken,now+28800,iso()),
  audit(env.DB,actor.id,'login')
 ]);
 return {actor:{id:actor.id,username:actor.username,display_name:actor.display_name,role:actor.role},csrf:csrfToken,cookie:cookie(token,env)};
}

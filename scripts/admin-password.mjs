import{randomBytes,randomUUID,createHmac,pbkdf2Sync}from'node:crypto';
// Cloudflare 正式環境限制單次 PBKDF2 至多 100,000 次；保持與 worker/security.ts 一致。
export const PASSWORD_ITERATIONS=100000;
export function passwordRecord(password,pepper,salt=randomBytes(32).toString('hex')){
 if(typeof password!=='string'||password.length<12||password.length>128)throw Error('密碼須為 12 至 128 字');
 if(typeof pepper!=='string'||pepper.length<32)throw Error('請使用原有、至少 32 字元的 AUTH_PEPPER');
 const secret=createHmac('sha256',pepper).update(password).digest('hex');
 return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt}$${pbkdf2Sync(secret,salt,PASSWORD_ITERATIONS,32,'sha256').toString('hex')}`;
}
export function passwordRepairSql(username,password,pepper){
 username=String(username).trim().toLowerCase();if(!/^[a-z0-9._@+-]{3,120}$/.test(username))throw Error('登入帳號格式錯誤');
 const quote=value=>"'"+value.replaceAll("'","''")+"'",hash=passwordRecord(password,pepper),now=new Date().toISOString();
 const accountKey='login-account:'+createHmac('sha256',pepper).update(username.toUpperCase().replace(/[ -]/g,'')).digest('hex');
 const where=`username=${quote(username)} COLLATE NOCASE AND active=1 AND role='admin'`;
 return `-- 僅更新指定的啟用管理員；不新增帳號，不變更教師、綁定、角色或安全金鑰。\nUPDATE admins SET password_hash=${quote(hash)},updated_at=${quote(now)} WHERE ${where};\nDELETE FROM sessions WHERE admin_id IN(SELECT id FROM admins WHERE ${where});\nDELETE FROM rate_limits WHERE key=${quote(accountKey)};\nINSERT INTO audit_logs(id,actor_id,action,result,created_at) SELECT ${quote(randomUUID())},id,'password_repair','success',${quote(now)} FROM admins WHERE ${where};\nSELECT CASE WHEN EXISTS(SELECT 1 FROM admins WHERE ${where} AND password_hash=${quote(hash)}) THEN '管理員密碼格式已更新' ELSE '找不到指定的啟用管理員，未更新帳號' END AS result;\n`;
}

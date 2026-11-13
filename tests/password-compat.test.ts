import{it,expect,vi}from'vitest';
import{randomBytes,pbkdf2Sync,createHmac}from'node:crypto';
import{passwordHash,passwordValid,isPasswordHashSupported,PASSWORD_ITERATIONS}from'../worker/security';
import{passwordRecord,PASSWORD_ITERATIONS as LOCAL_ITERATIONS,passwordRepairSql}from'../scripts/admin-password.mjs';
import{operationalFailure}from'../worker/errors';
it('在正式環境上限下驗證 Node 初始化、Web Crypto 新雜湊與正確／錯誤密碼',async()=>{
 const password=randomBytes(24).toString('hex'),pepper=randomBytes(32).toString('hex'),salt=randomBytes(32).toString('hex');
 const original=crypto.subtle.deriveBits.bind(crypto.subtle),spy=vi.spyOn(crypto.subtle,'deriveBits').mockImplementation(async(algorithm:any,key:any,length:any)=>{if(algorithm.name==='PBKDF2'&&algorithm.iterations>100000)throw new DOMException('Pbkdf2 iteration counts above 100000 are not supported','NotSupportedError');return original(algorithm,key,length);});
 try{const record=passwordRecord(password,pepper,salt);expect(PASSWORD_ITERATIONS).toBe(LOCAL_ITERATIONS);expect(record).toBe(await passwordHash(password,pepper,salt));expect(await passwordValid(password,record,pepper)).toBe(true);expect(await passwordValid(randomBytes(24).toString('hex'),record,pepper)).toBe(false);expect(spy).toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('拒絕舊 600,000 次及惡意成本，不呼叫不受支援的密碼運算',async()=>{
 const password=randomBytes(24).toString('hex'),pepper=randomBytes(32).toString('hex'),salt=randomBytes(32).toString('hex');
 const secret=createHmac('sha256',pepper).update(password).digest('hex'),legacy=`pbkdf2-sha256$600000$${salt}$${pbkdf2Sync(secret,salt,600000,32,'sha256').toString('hex')}`;
 const spy=vi.spyOn(crypto.subtle,'deriveBits');try{expect(isPasswordHashSupported(legacy)).toBe(false);expect(await passwordValid(password,legacy,pepper)).toBe(false);expect(await passwordValid(password,legacy.replace('$600000$','$999999999$'),pepper)).toBe(false);await expect(passwordHash(password,pepper,salt,600000)).rejects.toThrow('PASSWORD_ITERATIONS_UNSUPPORTED');expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('維護 SQL 不含明文密碼或 pepper，不更動教師、角色或產生新管理員',()=>{
 const password=randomBytes(24).toString('hex'),pepper=randomBytes(32).toString('hex'),sql=passwordRepairSql('office-maintainer',password,pepper);
 expect(sql).not.toContain(password);expect(sql).not.toContain(pepper);expect(sql).toContain('pbkdf2-sha256$100000$');expect(sql).toContain('UPDATE admins SET password_hash=');expect(sql).not.toContain('UPDATE teachers');expect(sql).not.toContain('INSERT INTO admins');expect(sql).toContain('DELETE FROM sessions');expect(sql).toContain('password_repair');
 expect(()=>passwordRepairSql("'; DROP TABLE admins;",password,pepper)).toThrow();
});
it('運作錯誤分類不洩漏 SQL、原始錯誤或個資',()=>{
 const privateValue=randomBytes(24).toString('hex');
 expect(operationalFailure(new Error('D1_ERROR',{cause:new Error('no such table: private_'+privateValue)}))).toEqual({code:'DATABASE_SCHEMA_MISSING',message:expect.any(String)});
 expect(JSON.stringify(operationalFailure(new Error('no such column: '+privateValue)))).not.toContain(privateValue);
 expect(operationalFailure(new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported','NotSupportedError'))?.code).toBe('AUTH_CRYPTO_RUNTIME_LIMIT');
 expect(operationalFailure(new Error('network '+privateValue))).toBeNull();
});

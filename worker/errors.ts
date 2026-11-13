// 僅辨識固定的運作類別；原始 SQL、密碼、金鑰與請求本文不回傳也不記錄。
export function operationalFailure(error:unknown):{code:string;message:string}|null{
 const parts:string[]=[];const visited=new Set<unknown>();let current:any=error;
 for(let i=0;i<4&&current&&!visited.has(current);i++){visited.add(current);if(typeof current==='string'){parts.push(current);break;}if(typeof current.message==='string')parts.push(current.message);current=current.cause;}
 const message=parts.join(' ');
 if(/no such table|no such column/i.test(message))return {code:'DATABASE_SCHEMA_MISSING',message:'資料庫資料表尚未建立或版本不符，請確認 D1 Migration 已套用至 Pages 綁定的資料庫'};
 if((/pbkdf2/i.test(message)&&/iteration|not.supported/i.test(message))||message.includes('PASSWORD_ITERATIONS_UNSUPPORTED'))return {code:'AUTH_CRYPTO_RUNTIME_LIMIT',message:'登入密碼運算與 Cloudflare 正式環境不相容，請套用登入修正版本'};
 return null;
}

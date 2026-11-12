import{describe,it,expect}from'vitest';
import{generateCode,hashCode,verifySignature,parseEvents}from'../worker/security';
describe('綁定碼與 Webhook 安全',()=>{
 it('使用高熵隨機碼，符合 12 字元格式',()=>{const codes=new Set(Array.from({length:1000},generateCode));expect(codes.size).toBe(1000);for(const c of codes)expect(c).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);});
 it('綁定碼正規化，HMAC 依金鑰區分且不包含明碼',async()=>{const digest=await hashCode(' abcd-2345 efgh ','test-pepper');expect(digest).toBe(await hashCode('ABCD2345EFGH','test-pepper'));expect(digest).not.toBe(await hashCode('ABCD2345EFGH','other'));expect(digest).toHaveLength(64);});
 it('驗證原始本文簽章，拒絕篡改、缺少簽章與異常 base64',async()=>{const raw='{"events":[]}';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));const sig=btoa(String.fromCharCode(...bytes));expect(await verifySignature(raw,sig,'secret')).toBe(true);expect(await verifySignature(raw+' ',sig,'secret')).toBe(false);expect(await verifySignature(raw,null,'secret')).toBe(false);expect(await verifySignature(raw,'???','secret')).toBe(false);});
 it('接受驗證空事件並拒絕損壞 JSON 與缺少事件 ID',()=>{expect(parseEvents('{"events":[]}')).toEqual([]);expect(()=>parseEvents('bad')).toThrow();expect(()=>parseEvents('{"events":[{"type":"message","source":{"type":"user"}}]}')).toThrow();expect(()=>parseEvents('{"events":{}}')).toThrow();});
});

import{it,expect}from'vitest';
import{functionErrorMessage}from'../src/function-errors';
it('保留後端版本衝突提示並不消耗原 Response',async()=>{const context=new Response(JSON.stringify({error:'交接事項已被更新，請重新整理後再操作'}),{status:400});expect(await functionErrorMessage({context},'通用錯誤')).toBe('交接事項已被更新，請重新整理後再操作');expect(context.bodyUsed).toBe(false);});
it('網路、非 JSON 或無字串錯誤使用安全備援提示',async()=>{for(const error of [null,Error('network'),{context:new Response('bad')},{context:new Response('{"error":{}}')}])expect(await functionErrorMessage(error,'操作失敗')).toBe('操作失敗');});

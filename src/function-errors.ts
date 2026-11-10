// Supabase FunctionsHttpError 的 context 是 Response；取出後端可供使用者操作的錯誤訊息。
export async function functionErrorMessage(error:unknown,fallback:string):Promise<string>{
 const context=(error as {context?:unknown}|null)?.context;
 if(context instanceof Response){try{const body=await context.clone().json();if(typeof body?.error==='string'&&body.error.trim())return body.error;}catch{/* 網路或非 JSON 錯誤使用通用提示。 */}}
 return fallback;
}

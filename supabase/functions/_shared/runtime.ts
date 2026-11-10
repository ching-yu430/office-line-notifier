
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
export const env=(key:string)=>Deno.env.get(key)||'';
export const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
export async function rpc(name:string,args:Record<string,unknown>) {const {data,error}=await db.rpc(name,args);if(error) throw error;return data;}
export async function line(path:string,body:unknown,retry?:string) {
 return await fetch('https://api.line.me/v2/bot/'+path,{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json',...(retry?{'X-Line-Retry-Key':retry}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
}

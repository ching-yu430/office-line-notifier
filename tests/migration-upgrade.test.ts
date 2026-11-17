import {it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
it('0002 可套用於已有帳號、綁定及訊息的舊資料庫，原資料保留',async()=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('測試')}}",compatibilityDate:'2026-07-01',d1Databases:['DB']});
 try{
  const db=await mf.getD1Database('DB');
  const apply=async(name:string)=>{const sql=readFileSync('migrations/'+name,'utf8').replace(/--[^\n]*/g,'');await db.batch(sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql)));};
  await apply('0001_initial.sql');const now=new Date().toISOString();
  await db.prepare("INSERT INTO admins VALUES('migration-admin','migration-admin','遷移測試管理員','僅供遷移測試的雜湊欄位','admin',1,?,?)").bind(now,now).run();
  await db.prepare("INSERT INTO teachers(id,name,line_user_id,bound_at,created_at,updated_at) VALUES('migration-teacher','虛構遷移教師','U-mock-migration',?,?,?)").bind(now,now,now).run();
  await db.prepare("INSERT INTO messages(id,teacher_id,direction,content,created_at) VALUES('migration-message','migration-teacher','in','虛構遷移文字',?)").bind(now).run();
  await apply('0002_workflow.sql');
  expect((await db.prepare('SELECT bound_at FROM teachers').first())?.bound_at).toBe(now);expect((await db.prepare('SELECT content FROM messages').first())?.content).toBe('虛構遷移文字');expect((await db.prepare('SELECT username FROM admins').first())?.username).toBe('migration-admin');
  for(const table of ['conversation_views','reply_presence','undo_actions'])expect((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n).toBe(0);
 }finally{await mf.dispose();}
});

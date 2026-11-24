import {it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import {migrationStatements} from './migrations';
it('0005 備份版本追蹤行政內容，查看與輸入提示不造成備份失效',async()=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('測試')}}",compatibilityDate:'2026-07-01',d1Databases:['DB']});
 try{const db=await mf.getD1Database('DB');await db.batch(migrationStatements().map(sql=>db.prepare(sql)));const now=new Date().toISOString();await db.prepare("INSERT INTO admins VALUES('backup-admin','backup-admin','虛構管理員','測試雜湊','admin',1,?,?)").bind(now,now).run();await db.prepare("INSERT INTO teachers(id,name,created_at,updated_at) VALUES('backup-teacher','虛構教師',?,?)").bind(now,now).run();const version=async()=>Number((await db.prepare('SELECT backup_version FROM system_meta').first())?.backup_version),before=await version();
 await db.prepare("INSERT INTO conversation_views VALUES('backup-teacher','backup-admin',0,?)").bind(now).run();await db.prepare("INSERT INTO reply_presence VALUES('backup-teacher','backup-admin','test-client',9999999999)").run();expect(await version()).toBe(before);await db.prepare("INSERT INTO messages(id,teacher_id,direction,content,created_at) VALUES('backup-message','backup-teacher','in','新的行政內容',?)").bind(now).run();expect(await version()).toBeGreaterThan(before);expect((await db.prepare('SELECT name FROM teachers').first())?.name).toBe('虛構教師');
 }finally{await mf.dispose();}
});
it('0004 升級保留訊息與綁定，新增清理帳本及已清理發送請求標記',async()=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('測試')}}",compatibilityDate:'2026-07-01',d1Databases:['DB']});
 try{
  const db=await mf.getD1Database('DB'),apply=async(name:string)=>{const sql=readFileSync('migrations/'+name,'utf8').replace(/--[^\n]*/g,'');await db.batch(sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql)));};
  for(const name of ['0001_initial.sql','0002_workflow.sql','0003_pickup_items.sql'])await apply(name);
  const now=new Date().toISOString();await db.prepare("INSERT INTO admins VALUES('cleanup-admin','cleanup-admin','虛構升級管理員','僅供遷移測試','admin',1,?,?)").bind(now,now).run();
  await db.prepare("INSERT INTO teachers(id,name,line_user_id,bound_at,created_at,updated_at) VALUES('cleanup-teacher','虛構教師','U-mock-cleanup',?,?,?)").bind(now,now,now).run();
  await db.prepare("INSERT INTO messages(id,teacher_id,direction,content,created_at) VALUES('old-msg','cleanup-teacher','in','保留的舊訊息',?)").bind(now).run();
  await db.prepare("INSERT INTO send_requests(id,actor_id,fingerprint,created_at) VALUES('old-request','cleanup-admin','測試指紋',?)").bind(now).run();await apply('0004_record_cleanup.sql');
  expect((await db.prepare('SELECT content FROM messages').first())?.content).toBe('保留的舊訊息');expect((await db.prepare('SELECT line_user_id FROM teachers').first())?.line_user_id).toBe('U-mock-cleanup');expect((await db.prepare('SELECT archived_at FROM send_requests').first())?.archived_at).toBeNull();expect((await db.prepare('SELECT count(*) AS n FROM record_cleanup_jobs').first())?.n).toBe(0);
 }finally{await mf.dispose();}
});
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
it('0003 從舊版升級保留帳號、綁定、信件及文字通知，新增名稱限制與對話版本索引',async()=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('測試')}}",compatibilityDate:'2026-07-01',d1Databases:['DB']});
 try{
  const db=await mf.getD1Database('DB'),apply=async(name:string)=>{const sql=readFileSync('migrations/'+name,'utf8').replace(/--[^\n]*/g,'');await db.batch(sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql)));};
  await apply('0001_initial.sql');await apply('0002_workflow.sql');const now=new Date().toISOString();
  await db.prepare("INSERT INTO admins VALUES('upgrade-admin','upgrade-admin','遷移測試管理員','僅供遷移測試的雜湊欄位','admin',1,?,?)").bind(now,now).run();
  await db.prepare("INSERT INTO teachers(id,name,line_user_id,bound_at,created_at,updated_at) VALUES('upgrade-teacher','虛構遷移教師','U-mock-upgrade',?,?,?)").bind(now,now,now).run();
  for(const [id,kind,status]of [['old-mail','mail','待領取'],['old-custom','custom','待回覆']])await db.prepare('INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,status,created_at) VALUES(?,?,\'upgrade-teacher\',?,\'舊通知\',\'upgrade-admin\',0,?,?,?)').bind(id,id,kind,id,status,now).run();
  await apply('0003_pickup_items.sql');
  expect((await db.prepare('SELECT count(*) AS n FROM notifications WHERE pickup_name IS NULL').first())?.n).toBe(2);expect((await db.prepare("SELECT status FROM notifications WHERE id='old-custom'").first())?.status).toBe('待回覆');expect((await db.prepare('SELECT line_user_id FROM teachers').first())?.line_user_id).toBe('U-mock-upgrade');
  const before=(await db.prepare('SELECT conversation_version FROM teachers').first())?.conversation_version;
  await db.prepare("UPDATE notifications SET pickup_name='教材' WHERE id='old-custom'").run();expect((await db.prepare('SELECT conversation_version FROM teachers').first())?.conversation_version).toBeGreaterThan(Number(before));
  await expect(db.prepare("UPDATE notifications SET pickup_name='教材' WHERE id='old-mail'").run()).rejects.toThrow();await expect(db.prepare("UPDATE notifications SET pickup_name=' ' WHERE id='old-custom'").run()).rejects.toThrow();
 }finally{await mf.dispose();}
});
it('0006 保留舊物品、失敗通知與教師綁定，逐筆回填且新通知自動建立獨立物品',async()=>{
 const {splitMigration}=await import('./migrations'),{readdirSync}=await import('node:fs');
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('測試')}}",compatibilityDate:'2026-07-01',d1Databases:['DB']});
 try{
  const db=await mf.getD1Database('DB');for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n<'0006').sort())await db.batch(splitMigration(readFileSync('migrations/'+name,'utf8')).map(sql=>db.prepare(sql)));
  const at=new Date().toISOString();await db.prepare("INSERT INTO admins VALUES('upgrade6','upgrade6','虛構管理員','僅供遷移測試','admin',1,?,?)").bind(at,at).run();
  await db.prepare("INSERT INTO teachers(id,name,line_user_id,bound_at,created_at,updated_at) VALUES('teacher6','虛構升級教師','U-mock-upgrade6',?,?,?)").bind(at,at,at).run();
  for(const [id,kind,status,send,pickup]of [['mail6','mail','待領取','accepted',null],['parcel6','parcel','待領取','failed',null],['custom6','custom','已完成','accepted','教材'],['text6','custom','待回覆','accepted',null]])await db.prepare("INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,status,created_at,send_status,pickup_name) VALUES(?,?,'teacher6',?,'既有行政紀錄','upgrade6',0,?,?,?,?,?)").bind(id,id,kind,id,status,at,send,pickup).run();
  await db.batch(splitMigration(readFileSync('migrations/0006_office_workflows.sql','utf8')).map(sql=>db.prepare(sql)));
  expect((await db.prepare('SELECT count(*) AS n FROM pickup_items').first())?.n).toBe(3);expect((await db.prepare("SELECT status FROM pickup_items WHERE id='parcel6'").first())?.status).toBe('待領取');expect((await db.prepare("SELECT status FROM pickup_items WHERE id='custom6'").first())?.status).toBe('已完成');expect((await db.prepare("SELECT pickup_item_id FROM notifications WHERE id='text6'").first())?.pickup_item_id).toBeNull();
  expect((await db.prepare('SELECT line_user_id FROM teachers').first())?.line_user_id).toBe('U-mock-upgrade6');
  await db.prepare("INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,status,created_at) VALUES('new6','new6','teacher6','parcel','新包裹','upgrade6',0,'new6','待領取',?)").bind(at).run();
  expect((await db.prepare("SELECT pickup_item_id FROM notifications WHERE id='new6'").first())?.pickup_item_id).toBe('new6');expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
 }finally{await mf.dispose();}
});

import {afterEach,it,expect,vi} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {createHash,randomUUID} from 'node:crypto';
import {backupCsv,backupRow,backupTables,csvCell,type BackupCounts} from '../src/backup-format';
import {backupDue,readBackupPreference} from '../src/backup-preference';
afterEach(()=>{vi.doUnmock('../src/api');vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
it('CSV 防止公式注入並保留換行、逗號與引號，JSON 欄位白名單不含秘密',()=>{
 for(const value of ['=SUM(1,2)',' +cmd','-10','@SUM(A1)','\t=cmd'])expect(csvCell(value)).toMatch(/^"'/);
 expect(csvCell('一般文字')).toBe('"一般文字"');expect(csvCell('a,"b"\n下一行')).toBe('"a,""b""\n下一行"');
 expect(backupCsv('teachers',[])).toMatch(/^\uFEFF/);expect(backupRow('staff',{id:'x',display_name:'虛構',password_hash:'secret',csrf_token:'secret',role:'admin',active:1})).not.toHaveProperty('password_hash');
});
it('排程只接受指定間隔、預設關閉，拒絕遭篡改的極短間隔',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({hours:0.001,lastGenerated:-1})});expect(readBackupPreference('test')).toEqual({hours:0,lastGenerated:0});expect(backupDue({hours:0,lastGenerated:0},Date.now())).toBe(false);
 expect(backupDue({hours:24,lastGenerated:1000},86401000)).toBe(true);expect(backupDue({hours:24,lastGenerated:1000},86400999)).toBe(false);
});
it('ZIP 包含完整 JSON、CSV 與可核對的雜湊，保留原文而不執行內容',async()=>{
 const rows=Object.fromEntries(backupTables.map(t=>[t,[]])) as Record<string,any[]>;rows.messages=[{id:randomUUID(),teacher_id:'t1',direction:'in',content:'=SUM(1,2)\n<script>虛構文字</script>',created_at:new Date().toISOString()}];
 const counts=Object.fromEntries(backupTables.map(t=>[t,rows[t].length])) as BackupCounts;
 vi.doMock('../src/api',()=>({command:vi.fn(async(action:string,p:any)=>action==='records_backup_start'?{token:'test',counts,created_at:new Date().toISOString()}:action==='records_backup_page'?{rows:rows[p.table],next_cursor:null}:{})}));
 const {buildRecordBackup}=await import('../src/record-backup'),file=await buildRecordBackup(()=>false,()=>{}),files=unzipSync(file.data),data=JSON.parse(strFromU8(files['records.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));
 expect(data.records.messages[0].content).toBe(rows.messages[0].content);expect(strFromU8(files['csv/messages.csv'])).toContain("'=SUM");expect(file.filename).toMatch(/^office-records-\d{8}-\d{6}-[a-f0-9]+\.zip$/);
 for(const entry of manifest.files)expect(createHash('sha256').update(files[entry.name]).digest('hex')).toBe(entry.sha256);expect(createHash('sha256').update(file.data).digest('hex')).toBe(file.sha256);
 vi.doUnmock('../src/api');
});
it('匯出筆數不完整或取消時不產生可下載的部分備份',async()=>{
 const counts=Object.fromEntries(backupTables.map(t=>[t,t==='messages'?2:0]));vi.doMock('../src/api',()=>({command:vi.fn(async(action:string)=>action==='records_backup_start'?{token:'test',counts,created_at:new Date().toISOString()}:{rows:[],next_cursor:null})}));
 const {buildRecordBackup}=await import('../src/record-backup');await expect(buildRecordBackup(()=>false,()=>{})).rejects.toThrow('筆數不一致');await expect(buildRecordBackup(()=>true,()=>{})).rejects.toMatchObject({name:'AbortError'});vi.doUnmock('../src/api');
});

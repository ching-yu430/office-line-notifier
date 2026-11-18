import {openSettingsTab} from './settings-tools';
import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';
async function settings(page:Page){await page.getByRole('button',{name:'系統管理',exact:true}).click();}
async function backup(page:Page){await settings(page);await openSettingsTab(page,'maintenance');return page.locator('.record-backup');}
async function fakeFolder(page:Page){await page.addInitScript(()=>{
 const w=window as any;w.__backupWrites=[];w.__backupPermission='granted';
 w.showDirectoryPicker=async()=>({name:'虛構備份資料夾',queryPermission:async()=>w.__backupPermission,getFileHandle:async(name:string)=>({createWritable:async()=>{let data:number[]=[];return {write:async(value:ArrayBuffer)=>{data=Array.from(new Uint8Array(value));},close:async()=>w.__backupWrites.push({name,data}),abort:async()=>{data=[];}};}})});
});}
test('系統管理分類頁籤可用鍵盤操作，卡片對齊且往返保留，ZIP 完整匯出超過 500 筆',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').filter({hasText:'示範教師甲'}).click();await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('office-line-demo-v1')!);d.teachers[0].name='=SUM(1,2)';d.messages.push(...Array.from({length:530},(_,i)=>({id:'backup-history-'+i,teacher_id:'demo-1',direction:'in',content:'虛構歷史 '+i,created_at:'2024-01-01T00:00:00.000Z'})));localStorage.setItem('office-line-demo-v1',JSON.stringify(d));window.dispatchEvent(new Event('office-refresh'));});
 await settings(page);const cards=page.locator('.settings-grid > .panel'),a=await cards.nth(0).boundingBox(),b=await cards.nth(1).boundingBox();expect(a!.y).toBe(b!.y);expect(Math.abs(a!.height-b!.height)).toBeLessThan(2);
 await expect(page.getByRole('tab',{name:'一般設定',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.settings-panel-toggle')).toHaveCount(0);await expect(page.getByRole('heading',{name:'通知範本',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('settings-balanced.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('tab',{name:'一般設定',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'操作紀錄',exact:true})).toBeFocused();await expect(page.locator('.operation-history .history-list')).toBeVisible();await expect(page.locator('.handover-history .history-list')).toBeVisible();await page.screenshot({path:info.outputPath('settings-records.png'),fullPage:true,animations:'disabled'});await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'資料維護',exact:true})).toHaveAttribute('aria-selected','true');
 await openSettingsTab(page,'maintenance');const panel=page.locator('.record-backup'),downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'下載 ZIP 備份'}).click();const download=await downloadEvent,files=unzipSync(new Uint8Array(await readFile((await download.path())!))),json=JSON.parse(strFromU8(files['records.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));
 expect(json.records.messages).toHaveLength(532);expect(json.records.teachers[0].name).toBe('=SUM(1,2)');expect(strFromU8(files['csv/teachers.csv'])).toContain("'=SUM");for(const f of manifest.files)expect(createHash('sha256').update(files[f.name]).digest('hex')).toBe(f.sha256);await expect(panel.locator('.backup-success')).toContainText('備份已產生');await panel.screenshot({path:info.outputPath('backup-desktop.png'),animations:'disabled'});await page.screenshot({path:info.outputPath('settings-maintenance.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'值班工作台',exact:true}).click();await settings(page);await expect(page.getByRole('tab',{name:'資料維護',exact:true})).toHaveAttribute('aria-selected','true');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:info.outputPath('backup-mobile.png'),animations:'disabled'});
});
test('自動備份僅在授權且頁面可見時執行，其他分頁仍可排程，行政人員不能接續執行',async({page})=>{
 await fakeFolder(page);await page.clock.install();await page.goto('/');const panel=await backup(page);await panel.getByRole('button',{name:'選擇自動備份資料夾'}).click();await panel.getByLabel('自動備份間隔').selectOption('24');await expect.poll(()=>page.evaluate(()=>(window as any).__backupWrites.length)).toBe(1);
 const bytes=await page.evaluate(()=>(window as any).__backupWrites[0].data);expect(JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['records.json'])).records.teachers).toHaveLength(3);
 await page.getByRole('button',{name:'值班工作台',exact:true}).click();await page.clock.fastForward(86461000);await expect.poll(()=>page.evaluate(()=>(window as any).__backupWrites.length)).toBe(2);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(86461000);expect(await page.evaluate(()=>(window as any).__backupWrites.length)).toBe(2);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>page.evaluate(()=>(window as any).__backupWrites.length)).toBe(3);
 await page.getByRole('button',{name:'切換為行政人員'}).click();await page.clock.fastForward(86461000);expect(await page.evaluate(()=>(window as any).__backupWrites.length)).toBe(3);await expect(page.getByRole('button',{name:'系統管理',exact:true})).toHaveCount(0);
});
test('資料夾授權撤銷後暫停自動備份，重新開啟頁面需要再次選擇資料夾',async({page})=>{
 await fakeFolder(page);await page.clock.install();await page.goto('/');const panel=await backup(page);await panel.getByRole('button',{name:'選擇自動備份資料夾'}).click();await panel.getByLabel('自動備份間隔').selectOption('24');await expect.poll(()=>page.evaluate(()=>(window as any).__backupWrites.length)).toBe(1);
 await page.evaluate(()=>{(window as any).__backupPermission='denied';});await page.clock.fastForward(86461000);await expect(panel.getByRole('alert')).toContainText('重新選擇資料夾');expect(await page.evaluate(()=>(window as any).__backupWrites.length)).toBe(1);
 await page.reload();const reopened=await backup(page);await expect(reopened.getByLabel('自動備份間隔')).toHaveValue('24');await expect(reopened.locator('.backup-status')).toContainText('請先選擇資料夾');await page.clock.fastForward(86461000);expect(await page.evaluate(()=>(window as any).__backupWrites.length)).toBe(0);
});
test('未支援資料夾 API 時仍可手動下載，自動備份維持關閉',async({page})=>{
 await page.addInitScript(()=>{(window as any).showDirectoryPicker=undefined;});await page.goto('/');const panel=await backup(page);await expect(panel.getByLabel('自動備份間隔')).toBeDisabled();await expect(panel.getByRole('button',{name:'選擇自動備份資料夾'})).toBeDisabled();const event=page.waitForEvent('download');await panel.getByRole('button',{name:'下載 ZIP 備份'}).click();await event;await expect(panel.locator('.backup-status')).toContainText('未啟用');
});

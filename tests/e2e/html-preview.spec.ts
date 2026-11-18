import {test,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import type {Page} from '@playwright/test';
import {openDemoTools} from './chat-tools';
const filename=resolve('.local/preview/office-line-notifier-preview.html'),preview='http://127.0.0.1:5173/__offline-preview__.html';
// 管理的瀏覽器封鎖 file://；以相同 HTML 文件攔截載入，不修改瀏覽器政策。
async function openPreview(page:Page){const html=readFileSync(filename,'utf8');expect(html.slice(0,200)).toContain('<meta charset="UTF-8">');await page.route(preview,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));await page.goto(preview);}
test.beforeAll(()=>{const result=spawnSync(process.execPath,['scripts/build-preview.mjs'],{encoding:'utf8',timeout:60000});if(result.status!==0)throw Error('HTML 預覽建置失敗，請執行 npm run build:html-preview 檢查');});

test('單檔 HTML 的 Logo／各頁／自填物品／模擬回覆可操作且沒有額外網路請求',async({page},info)=>{
 const requests:string[]=[],errors:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&r.url()!==preview)requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});await openPreview(page);await expect(page).toHaveTitle('辦公室小幫手｜離線預覽');await expect(page.getByRole('heading',{name:'值班工作台',exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'NPUST 辦公室標誌'})).toHaveAttribute('src',/^data:image\/png/);
 await page.getByRole('button',{name:'新增物品',exact:true}).click();await page.getByRole('option').filter({hasText:'示範教師丙'}).click();await page.getByLabel('物品名稱',{exact:true}).fill('離線測試教材');await page.getByRole('button',{name:'預覽通知',exact:true}).click();await page.getByRole('button',{name:'確認發送給 1 位教師'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.getByLabel('搜尋通知').fill('離線測試教材');await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').filter({hasText:'示範教師丙'}).click();await openDemoTools(page);await page.getByLabel('模擬老師回覆').fill('老師的離線回覆測試');await page.getByRole('button',{name:'模擬接收'}).click();await expect(page.locator('.messages')).toContainText('老師的離線回覆測試');await page.getByLabel('回覆老師',{exact:true}).fill('辦公室離線回覆');await page.getByRole('button',{name:'送出',exact:true}).click();await expect(page.getByLabel('回覆老師',{exact:true})).toHaveValue('');await page.locator('.chat-demo-tools summary').click();await page.screenshot({path:info.outputPath('html-preview.png'),fullPage:true,animations:'disabled'});
 for(const name of ['教師名單','發送通知','系統管理']){await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}
 expect(requests).toEqual([]);expect(errors).toEqual([]);
});

test('瀏覽器不允許儲存時 HTML 仍可修改虛構資料，停用教師不能繼續發送',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('測試禁止儲存','SecurityError');}});});await openPreview(page);await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').filter({hasText:'示範教師甲'}).click();await page.getByRole('button',{name:'教師名單',exact:true}).click();const row=page.getByRole('row').filter({hasText:'示範教師甲'});await row.getByRole('button',{name:'編輯',exact:true}).click();await page.getByLabel('啟用教師').uncheck();await page.getByRole('button',{name:'儲存教師',exact:true}).click();await expect(row).toContainText('已停用');await page.getByRole('button',{name:/^訊息中心/}).click();await expect(page.getByPlaceholder('教師已停用')).toBeVisible();await expect(page.getByLabel('回覆老師',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'送出',exact:true})).toBeDisabled();
});

test('單檔 HTML 可載入舊紀錄範例並預覽及確認清理，不呼叫正式 API',async({page},info)=>{
 const requests:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&r.url()!==preview)requests.push(r.url());});await openPreview(page);await page.getByRole('button',{name:'系統管理',exact:true}).click();const panel=page.locator('.record-cleanup');await page.getByRole('button',{name:'紀錄清理',exact:true}).click();await panel.locator('.cleanup-demo-tools summary').click();await panel.getByRole('button',{name:'加入舊紀錄範例'}).click();await panel.getByLabel('舊操作紀錄',{exact:true}).check();await panel.getByRole('button',{name:'預覽可清理紀錄'}).click();await expect(panel.locator('.cleanup-preview .cleanup-counts b')).toHaveText(['1 筆','1 則','1 筆','1 筆']);await panel.screenshot({path:info.outputPath('html-cleanup-preview.png'),animations:'disabled'});await panel.getByLabel('刪除確認文字').fill('刪除紀錄');await panel.getByRole('button',{name:'確認永久刪除'}).click();await expect(panel.getByRole('status')).toContainText('清理完成');expect(requests).toEqual([]);
});

test('HTML 預覽直接產生 ZIP，內含可讀的虛構紀錄，沒有外部 API 或資源請求',async({page})=>{
 const requests:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&r.url()!==preview)requests.push(r.url());});await openPreview(page);await page.getByRole('button',{name:'系統管理',exact:true}).click();await page.getByRole('button',{name:'紀錄備份',exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'下載 ZIP 備份'}).click();const download=await event,files=unzipSync(new Uint8Array(readFileSync((await download.path())!)));expect(JSON.parse(strFromU8(files['records.json'])).records.teachers).toHaveLength(3);expect(requests).toEqual([]);
});

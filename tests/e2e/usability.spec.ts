import {expectConversationStatus,chooseConversationStatus} from './chat-tools';
import {openPickups,openNotes,openDemoTools} from './chat-tools';
import {test,expect,type Page} from '@playwright/test';
async function chat(page:Page){await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').filter({hasText:'示範教師甲'}).click();}

test('快速通知：搜尋、未綁定禁選、選填位置、返回編輯與確認送出',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'包裹通知',exact:true}).click();const modal=page.getByRole('dialog');
 await expect(modal.getByRole('option').filter({hasText:'示範教師乙'})).toBeDisabled();await page.getByLabel('通知對象',{exact:true}).fill('教務處');await modal.getByRole('option').filter({hasText:'示範教師甲'}).click();
 await page.getByLabel('領取位置（選填）').fill('右側置物架');await page.getByRole('button',{name:'預覽通知'}).click();await expect(modal).toContainText('示範教師甲');await expect(modal.locator('.preview-bubble')).toContainText('領取位置：右側置物架');
 await page.getByRole('button',{name:'返回編輯'}).click();await expect(page.getByLabel('領取位置（選填）')).toHaveValue('右側置物架');await page.getByRole('button',{name:'預覽通知'}).click();await page.getByRole('button',{name:'確認仍需通知'}).click();await expect(modal).toHaveCount(0);
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'領取位置：右側置物架'})).toContainText('待領取');
});

test('對話排序與搜尋、未查看提示依登入人員更新，查看不等於回覆',async({page})=>{
 await page.addInitScript(()=>{
  const now=new Date().toISOString(),old=new Date(Date.now()-86400000).toISOString(),older=new Date(Date.now()-172800000).toISOString();
  const teachers=[['a','教師甲','教務處'],['b','教師乙','學務處'],['c','教師丙','總務處']].map(([id,name,department])=>({id,name,department,notes:'',active:true,bound_at:now,last_notified_at:null}));
  localStorage.setItem('office-line-demo-v1',JSON.stringify({teachers,notifications:[],messages:[{id:'ma',teacher_id:'a',direction:'in',content:'甲先前問題',created_at:older},{id:'mc',teacher_id:'c',direction:'in',content:'丙待回覆',created_at:old},{id:'mb',teacher_id:'b',direction:'out',content:'乙最新已回覆',created_at:now}],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[],audit_logs:[],conversations:[{teacher_id:'a',status:'待回覆'},{teacher_id:'b',status:'已完成'},{teacher_id:'c',status:'待回覆'}],handovers:[],internal_notes:[],handover_revisions:[]}));
 });
 await page.goto('/');await page.getByRole('button',{name:/^訊息中心/}).click();const rows=page.locator('.chat-teacher');await expect(rows.nth(0)).toContainText('教師丙');await expect(rows.nth(1)).toContainText('教師甲');await expect(rows.nth(2)).toContainText('教師乙');
 await page.getByLabel('搜尋教師對話').fill('總務處');await expect(rows).toHaveCount(1);await expect(page.getByLabel('教師丙有 1 則未查看訊息')).toBeVisible();await rows.click();await expect(page.getByLabel('教師丙有 1 則未查看訊息')).toHaveCount(0);await expectConversationStatus(page,'待回覆');
 await page.getByRole('button',{name:'切換為行政人員'}).click();await expect(page.getByLabel('教師丙有 1 則未查看訊息')).toHaveCount(0);await page.getByLabel('搜尋教師對話').fill('');await expect(page.getByLabel('教師甲有 1 則未查看訊息')).toBeVisible();
});

test('其他人正在回覆與逾期清除，輸入提示不包含草稿',async({page})=>{
 await page.goto('/');await chat(page);
 await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('office-line-demo-v1')!);data.presence=[{teacher_id:'demo-1',admin_id:'demo-staff',display_name:'示範行政人員',expires_at:Math.floor(Date.now()/1000)+45}];localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});
 await expect(page.locator('.typing-presence')).toContainText('示範行政人員正在回覆');await page.getByLabel('回覆老師',{exact:true}).fill('只存在輸入框的測試草稿');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('office-line-demo-v1')!).presence.some((p:any)=>p.admin_id==='demo-admin'))).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('office-line-demo-v1'))).not.toContain('只存在輸入框的測試草稿');
 await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('office-line-demo-v1')!);data.presence.forEach((p:any)=>p.expires_at=0);localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});await expect(page.locator('.typing-presence')).toHaveText('');
});

test('對話內直接登記領取與快速復原；交接完成也可復原',async({page})=>{
 await page.goto('/');await chat(page);await openPickups(page);await page.locator('.chat-pickups').getByRole('button',{name:'登記已領取'}).click();await page.getByRole('button',{name:'確認已領取'}).click();await openPickups(page);await expect(page.locator('.chat-pickups')).toContainText('目前沒有待領取物品');
 await page.locator('.toast').getByRole('button',{name:'復原',exact:true}).click();await openPickups(page);await expect(page.locator('.chat-pickups')).toContainText('包裹通知');
 await page.getByRole('button',{name:'值班工作台',exact:true}).click();await page.getByRole('button',{name:'新增交接'}).click();await page.getByLabel('交接人',{exact:true}).fill('測試值班人');await page.getByLabel('交接內容').fill('可復原交接');await page.getByRole('button',{name:'儲存交接'}).click();const item=page.locator('.handover-row').filter({hasText:'可復原交接'});await item.getByRole('button',{name:'標記完成'}).click();await page.getByLabel('完成人姓名').fill('測試完成人');await page.getByRole('button',{name:'確認完成',exact:true}).click();await expect(item).toHaveCount(0);await page.locator('.toast').getByRole('button',{name:'復原',exact:true}).click();await expect(item).toBeVisible();await item.getByRole('button',{name:'修改紀錄'}).click();await expect(page.getByRole('dialog')).toContainText('復原完成');
});

test('錯誤以中文說明，技術資訊僅管理員可展開',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const data={teachers:[{id:'a',name:'虛構教師',department:'測試',active:true,bound_at:new Date().toISOString()}],notifications:[{id:'n',teacher_id:'a',kind:'parcel',content:'測試失敗',send_status:'failed',status:'待領取',error_code:'line_http_401',sender_id:'demo-admin',created_at:new Date().toISOString()}],messages:[],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[],audit_logs:[],conversations:[],handovers:[]};localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await expect(page.locator('tbody')).toContainText('LINE 連線設定需要更新');const technical=page.locator('.technical-info');await expect(technical).not.toHaveAttribute('open','');await expect(technical.locator('code')).not.toBeVisible();await technical.locator('summary').click();await expect(technical.locator('code')).toHaveText('line_http_401');await page.getByRole('button',{name:'切換為行政人員'}).click();await expect(page.locator('.technical-info')).toHaveCount(0);await expect(page.locator('tbody')).toContainText('LINE 連線設定需要更新');
});

test('桌面及手機沿用暖黃風格與原 Logo，聊天及快速通知無整頁水平溢出',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');await chat(page);await expect(page.getByLabel('回覆後完成對話')).toHaveCount(0);await expect(page.getByRole('img',{name:'NPUST 辦公室標誌'})).toBeVisible();expect(await page.getByRole('button',{name:'送出',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(228, 195, 103)');await page.screenshot({path:info.outputPath('desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('mobile.png'),fullPage:true});await page.getByRole('button',{name:'值班工作台',exact:true}).click();await page.getByRole('button',{name:'信件通知',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('dialog').getByRole('heading',{name:'信件通知'})).toBeVisible();
});

import {openPickups,openNotes,openDemoTools} from './chat-tools';
import {test,expect,type Page} from '@playwright/test';
async function openChat(page:Page){await page.getByRole('button',{name:/^訊息中心/}).click();const back=page.getByRole('button',{name:'返回教師列表'});if(await back.isVisible())await back.click();await page.locator('.chat-teacher').filter({hasText:'示範教師甲'}).click();}

test('批次通知只全選搜尋結果，已選教師可核對並移除',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'發送通知',exact:true}).click();await page.getByLabel('搜尋通知對象').fill('教務處');await page.getByRole('button',{name:'全選搜尋結果',exact:true}).click();
 await expect(page.locator('.selected-recipients')).toContainText('示範教師甲');await expect(page.locator('.selected-recipients')).not.toContainText('示範教師丙');await page.getByLabel('搜尋通知對象').fill('');await expect(page.locator('.teacher-option').filter({hasText:'示範教師丙'}).getByRole('checkbox')).not.toBeChecked();
 await page.getByRole('button',{name:'取消選擇示範教師甲'}).click();await expect(page.getByRole('button',{name:'預覽通知',exact:true})).toBeDisabled();
});

test('通知紀錄十筆分頁，搜尋後回第一頁，完整內容可開啟並前往對話',async({page})=>{
 await page.goto('/');await openChat(page);await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('office-line-demo-v1')!);data.notifications=Array.from({length:23},(_,i)=>({id:'record-'+i,teacher_id:'demo-1',kind:'custom',content:'紀錄第'+i+'筆\n完整內容第二行',send_status:'accepted',status:'待回覆',sender_id:'demo-admin',created_at:new Date().toISOString()}));localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(10);await page.getByRole('button',{name:'下一頁通知'}).click();await expect(page.locator('.list-pagination')).toContainText('11–20');await page.getByRole('button',{name:'下一頁通知'}).click();await expect(page.locator('tbody tr')).toHaveCount(3);
 await page.getByLabel('搜尋通知').fill('紀錄第22筆');await expect(page.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'查看示範教師甲的通知內容'}).click();await expect(page.locator('.notice-detail-content')).toHaveText('紀錄第22筆\n完整內容第二行');await page.getByRole('button',{name:'前往對話'}).click();await expect(page.getByRole('heading',{name:'訊息中心',exact:true})).toBeVisible();
});

test('指定日期依台灣日期篩選，清除篩選恢復所有紀錄',async({page})=>{
 await page.goto('/');await openChat(page);await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('office-line-demo-v1')!);data.notifications=['2026-11-16T16:01:00.000Z','2026-11-16T15:59:00.000Z'].map((created_at,i)=>({id:'date-'+i,teacher_id:'demo-1',kind:'custom',content:i?'台灣十六日':'台灣十七日',send_status:'accepted',status:'待回覆',sender_id:'demo-admin',created_at}));localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.getByRole('button',{name:'指定期間',exact:true}).click();await page.getByLabel('通知起始日期').fill('2026-11-17');await page.getByLabel('通知結束日期').fill('2026-11-17');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('台灣十七日');await page.getByRole('button',{name:'清除篩選',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('聊天 Enter 換行，Ctrl Enter 才送出並保留換行內容',async({page})=>{
 await page.goto('/');await openChat(page);const input=page.getByLabel('回覆老師',{exact:true});await input.fill('第一行');await input.press('End');await input.press('Enter');await page.keyboard.type('第二行');await expect(input).toHaveValue('第一行\n第二行');await expect(page.locator('.messages')).not.toContainText('第一行');
 await input.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});await expect(input).toHaveValue('第一行\n第二行');await input.press('Control+Enter');await expect(input).toHaveValue('');await expect(page.locator('.message.out').last()).toContainText('第一行\n第二行');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('閱讀舊訊息時不自動拉到底，新訊息保留未查看並可跳到最新',async({page})=>{
 await page.goto('/');await openChat(page);await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('office-line-demo-v1')!);data.messages=Array.from({length:70},(_,i)=>({id:'history-'+i,teacher_id:'demo-1',direction:'in',content:'歷史訊息 '+i,created_at:new Date(Date.now()-(70-i)*60000).toISOString()}));localStorage.setItem('office-line-demo-v1',JSON.stringify(data));window.dispatchEvent(new Event('office-refresh'));});await expect(page.locator('.messages .message')).toHaveCount(70);const feed=page.locator('.messages');
 await feed.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});await openDemoTools(page);await page.getByLabel('模擬老師回覆').fill('剛收到的新問題');await page.getByRole('button',{name:'模擬接收'}).click();await expect(page.getByRole('button',{name:'1 則新訊息，查看最新'})).toBeVisible();expect(await feed.evaluate(el=>el.scrollTop)).toBeLessThan(40);await expect(page.getByLabel('示範教師甲有 1 則未查看訊息')).toBeVisible();
 await page.getByRole('button',{name:'1 則新訊息，查看最新'}).click();await expect(page.getByLabel('示範教師甲有 1 則未查看訊息')).toHaveCount(0);expect(await feed.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(80);
});

test('手機對話可返回名單，草稿保留且不需滑過整段教師列表',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await openChat(page);await expect(page.locator('.chat-list')).not.toBeVisible();await page.getByLabel('回覆老師',{exact:true}).fill('手機尚未送出的草稿');await page.getByRole('button',{name:'返回教師列表'}).click();await expect(page.locator('.chat-list')).toBeVisible();await expect(page.locator('.chat-teacher').filter({hasText:'示範教師甲'})).toContainText('草稿');await page.locator('.chat-teacher').filter({hasText:'示範教師甲'}).click();await expect(page.getByLabel('回覆老師',{exact:true})).toHaveValue('手機尚未送出的草稿');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('較矮的桌面視窗也能看見回覆框與送出按鈕',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.goto('/');await openChat(page);const box=await page.getByRole('button',{name:'送出',exact:true}).boundingBox();expect(box).not.toBeNull();expect(box!.y).toBeGreaterThan(0);expect(box!.y+box!.height).toBeLessThanOrEqual(768);await expect(page.getByLabel('回覆老師',{exact:true})).toBeVisible();
});

test('新版各頁可預覽，保持原 Logo 與暖黃風格',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');await page.getByRole('button',{name:'新增交接'}).click();await page.getByLabel('交接人',{exact:true}).fill('值班甲');await page.getByLabel('交接內容').fill('下午請協助確認尚未領取的信件，位置在右側置物架。');await page.getByRole('button',{name:'儲存交接',exact:true}).click();await page.getByRole('button',{name:'關閉提示',exact:true}).click();await expect(page.locator('.toast')).toHaveCount(0);await page.screenshot({path:info.outputPath('preview-dashboard.png'),fullPage:true,animations:'disabled'});
 await openChat(page);await page.screenshot({path:info.outputPath('preview-chat.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'發送通知',exact:true}).click();await page.locator('.teacher-option').filter({hasText:'示範教師甲'}).getByRole('checkbox').check();await page.screenshot({path:info.outputPath('preview-compose.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.screenshot({path:info.outputPath('preview-history.png'),fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await openChat(page);await page.screenshot({path:info.outputPath('preview-mobile.png'),fullPage:false,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('img',{name:'NPUST 辦公室標誌'})).toBeVisible();
});

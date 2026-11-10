import{test,expect}from'@playwright/test';
test('桌面：綁定、通知、教師回覆與結案',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();
 await page.getByRole('button',{name:'教師名單',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:'示範教師乙'});
 await row.getByRole('button',{name:'產生綁定碼'}).click();
 const code=await page.locator('.code').textContent();await page.getByRole('button',{name:'關閉',exact:true}).click();
 await page.getByLabel('模擬綁定碼').fill(code!);await page.getByRole('button',{name:'模擬老師綁定'}).click();await expect(row.getByText('已綁定',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'發送通知',exact:true}).click();
 await page.locator('.teacher-option').filter({hasText:'示範教師乙'}).getByRole('checkbox').check();
 await page.getByRole('button',{name:'包裹通知',exact:true}).click();await page.getByRole('button',{name:'預覽通知'}).click();await expect(page.getByRole('dialog')).toContainText('示範教師乙');await page.getByRole('button',{name:'確認發送給 1 位教師'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-list button').filter({hasText:'示範教師乙'}).click();await page.getByLabel('模擬老師回覆').fill('我下班前會去領取，謝謝！');await page.getByRole('button',{name:'模擬接收'}).click();await expect(page.locator('.messages')).toContainText('我下班前會去領取，謝謝！');
 await page.getByLabel('回覆老師',{exact:true}).fill('好的，辦公室等您。');await page.getByRole('button',{name:'回覆',exact:true}).click();await page.getByRole('button',{name:'確認發送給 1 位教師'}).click();await expect(page.locator('.messages')).toContainText('好的，辦公室等您。');
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.getByLabel('教師篩選').selectOption({label:'示範教師乙'});await page.getByLabel('更新示範教師乙處理狀態').first().selectOption('已完成');await expect(page.getByLabel('更新示範教師乙處理狀態').first()).toHaveValue('已完成');
});
test('一般行政無法管理教師或產生綁定碼',async({page})=>{await page.goto('/');await page.getByRole('button',{name:'切換為行政人員'}).click();await page.getByRole('button',{name:'教師名單',exact:true}).click();await expect(page.getByRole('button',{name:'新增教師'})).toHaveCount(0);await expect(page.getByRole('button',{name:'產生綁定碼'})).toHaveCount(0);});
test('手機：主要頁面可操作且無整頁水平溢出',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();expect((await page.locator('nav').boundingBox())!.height).toBeLessThan(100);for(const name of ['教師名單','發送通知','訊息中心','通知紀錄','系統管理']){await page.getByRole('button',{name:name==='訊息中心'?/^訊息中心/:name,exact:name!=='訊息中心'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}});
test('值班工作台：快捷通知與領件確認',async({page})=>{
 await page.goto('/');
 const logo=page.getByRole('img',{name:'NPUST 辦公室標誌'});
 await expect(logo).toBeVisible();
 await expect.poll(()=>logo.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(3302);
 expect(await logo.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await page.getByRole('button',{name:'信件通知'}).click();
 await expect(page.locator('textarea')).toHaveValue('您的信件已送達辦公室，請撥空領取。');
 await page.getByRole('button',{name:'值班工作台',exact:true}).click();
 await page.getByRole('button',{name:'登記已領取',exact:true}).first().click();
 await expect(page.getByRole('dialog')).toContainText('示範教師甲');
 await page.getByRole('button',{name:'確認已領取',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'登記已領取',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:'示範教師甲'})).toContainText('示範管理員');
});

test('交接事項：新增、保存、跨角色完成與歷史紀錄',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:/重要待辦/})).toHaveCount(0);
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('office-line-demo-v1')||'null')?.notifications.length);
 await page.getByRole('button',{name:'新增交接',exact:true}).click();
 await expect(page.getByRole('button',{name:'儲存交接',exact:true})).toBeDisabled();await page.getByLabel('交接內容').fill('下一班請確認會議室借用時間。');await expect(page.getByRole('button',{name:'儲存交接',exact:true})).toBeDisabled();await page.getByLabel('交接人',{exact:true}).fill('值班甲');await page.getByRole('button',{name:'儲存交接',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const section=page.locator('#handovers');await expect(section).toContainText('下一班請確認會議室借用時間。');await expect(section).toContainText('交接人：值班甲');await expect(page.getByRole('button',{name:/待交接\s*1\s*筆/})).toBeVisible();
 await page.reload();await expect(section).toContainText('下一班請確認會議室借用時間。');
 await page.getByRole('button',{name:'切換為行政人員'}).click();await section.getByRole('button',{name:'標記完成'}).click();await page.getByRole('button',{name:'關閉',exact:true}).click();await expect(section).toContainText('下一班請確認會議室借用時間。');
 await section.getByRole('button',{name:'標記完成'}).click();await expect(page.getByRole('button',{name:'確認完成',exact:true})).toBeDisabled();await page.getByLabel('完成人姓名').fill('完成乙');await page.getByRole('button',{name:'確認完成',exact:true}).click();await expect(section).toContainText('目前沒有待交接事項');await expect(page.getByRole('button',{name:/待交接\s*0\s*筆/})).toBeVisible();
 await expect(section.locator('details')).not.toHaveAttribute('open','');await section.locator('summary').click();await expect(section).toContainText('下一班請確認會議室借用時間。');await expect(section).toContainText('交接人：值班甲');await expect(section).toContainText('完成人：完成乙');
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('office-line-demo-v1')||'null').notifications.length);expect(after).toBe(before??2);
});

test('最近交接紀錄：預設收合、日期篩選、分頁與固定高度',async({page})=>{
 await page.addInitScript(()=>{
  const day=(offset:number)=>{const d=new Date(Date.now()-offset*86400000);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const get=(t:string)=>parts.find(p=>p.type===t)!.value;return `${get('year')}-${get('month')}-${get('day')}`;};
  const note=(id:string,offset:number)=>({id,content:id,created_by:'demo-admin',creator_name:'登入帳號甲',handover_name:'交接甲',created_at:new Date(day(20)+'T12:00:00+08:00').toISOString(),completed_at:new Date(day(offset)+'T12:00:00+08:00').toISOString(),completed_by:'demo-staff',completed_name:'登入帳號乙',finisher_name:'完成乙'});
  localStorage.setItem('office-line-demo-v1',JSON.stringify({teachers:[],notifications:[],messages:[],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[],audit_logs:[],conversations:[],handovers:[...Array.from({length:7},(_,i)=>note('今日紀錄'+i,0)),note('近週紀錄',6),note('較早紀錄',8)]}));
 });
 await page.goto('/');const details=page.locator('.handover-history');await expect(details).not.toHaveAttribute('open','');await expect(details.locator('.history-list')).not.toBeVisible();await details.locator('summary').click();await expect(details.getByRole('button',{name:'今日',exact:true})).toHaveAttribute('aria-pressed','true');await expect(details.locator('.history-list .handover-row')).toHaveCount(5);expect((await details.locator('.history-list').boundingBox())!.height).toBeLessThanOrEqual(380);
 await details.getByRole('button',{name:'下一頁交接紀錄'}).click();await expect(details.locator('.history-list .handover-row')).toHaveCount(2);
 await details.getByRole('button',{name:'近一週',exact:true}).click();await expect(details.locator('.history-pagination')).toContainText('1 / 2');await details.getByRole('button',{name:'下一頁交接紀錄'}).click();await expect(details.locator('.history-list')).toContainText('近週紀錄');await expect(details.locator('.history-list')).not.toContainText('較早紀錄');
 await details.getByRole('button',{name:'特定日期',exact:true}).click();const oldDay=await page.evaluate(()=>{const h=JSON.parse(localStorage.getItem('office-line-demo-v1')!).handovers.find((h:any)=>h.content==='較早紀錄');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(h.completed_at));const get=(t:string)=>parts.find(p=>p.type===t)!.value;return `${get('year')}-${get('month')}-${get('day')}`;});await details.getByLabel('交接紀錄日期',{exact:true}).fill(oldDay);await expect(details.locator('.history-list .handover-row')).toHaveCount(1);await expect(details.locator('.history-list')).toContainText('較早紀錄');
 await details.getByLabel('交接紀錄日期',{exact:true}).fill('2000-01-01');await expect(details.locator('.history-list')).toContainText('此日期沒有已完成的交接紀錄');await details.locator('summary').click();await expect(details.locator('.history-list')).not.toBeVisible();
 await page.setViewportSize({width:390,height:844});await details.locator('summary').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

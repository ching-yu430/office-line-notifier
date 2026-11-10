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
 await expect(page.getByRole('button',{name:'儲存交接',exact:true})).toBeDisabled();await page.getByLabel('交接內容').fill('下一班請確認會議室借用時間。');await page.getByRole('button',{name:'儲存交接',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const section=page.locator('#handovers');await expect(section).toContainText('下一班請確認會議室借用時間。');await expect(section).toContainText('示範管理員 建立');await expect(page.getByRole('button',{name:/待交接\s*1\s*筆/})).toBeVisible();
 await page.reload();await expect(section).toContainText('下一班請確認會議室借用時間。');
 await page.getByRole('button',{name:'切換為行政人員'}).click();await section.getByRole('button',{name:'標記完成'}).click();await page.getByRole('button',{name:'關閉',exact:true}).click();await expect(section).toContainText('下一班請確認會議室借用時間。');
 await section.getByRole('button',{name:'標記完成'}).click();await page.getByRole('button',{name:'確認完成',exact:true}).click();await expect(section).toContainText('目前沒有待交接事項');await expect(page.getByRole('button',{name:/待交接\s*0\s*筆/})).toBeVisible();
 await section.getByRole('tab',{name:'已完成',exact:true}).click();await expect(section).toContainText('下一班請確認會議室借用時間。');await expect(section).toContainText('示範管理員 建立');await expect(section).toContainText('示範行政人員 完成');
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('office-line-demo-v1')||'null').notifications.length);expect(after).toBe(before??2);
});

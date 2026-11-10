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
 await expect(page.locator('.handover-history')).toHaveCount(0);await page.getByRole('button',{name:'切換為管理員'}).click();await expect(page.locator('.handover-history')).toHaveCount(0);await page.getByRole('button',{name:'系統管理',exact:true}).click();const history=page.locator('.handover-history');await expect(history).not.toHaveAttribute('open','');await history.locator('summary').click();await expect(history).toContainText('下一班請確認會議室借用時間。');await expect(history).toContainText('交接人：值班甲');await expect(history).toContainText('完成人：完成乙');
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('office-line-demo-v1')||'null').notifications.length);expect(after).toBe(before??2);
});

test('系統管理：左右配置、兩種紀錄獨立篩選、分頁與固定高度',async({page})=>{
 await page.addInitScript(()=>{
  const day=(offset:number)=>{const d=new Date(Date.now()-offset*86400000);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const get=(t:string)=>parts.find(p=>p.type===t)!.value;return `${get('year')}-${get('month')}-${get('day')}`;};
  const note=(id:string,offset:number)=>({id,content:id,created_by:'demo-admin',creator_name:'登入帳號甲',handover_name:'交接甲',created_at:new Date(day(20)+'T12:00:00+08:00').toISOString(),completed_at:new Date(day(offset)+'T12:00:00+08:00').toISOString(),completed_by:'demo-staff',completed_name:'登入帳號乙',finisher_name:'完成乙'});
  localStorage.setItem('office-line-demo-v1',JSON.stringify({teachers:[],notifications:[],messages:[],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true},{id:'demo-staff',display_name:'示範行政人員',role:'staff',active:true}],templates:[],audit_logs:[...Array.from({length:7},(_,i)=>({id:'today-log-'+i,action:'teacher_save',actor_id:'demo-admin',created_at:new Date(day(0)+'T12:00:00+08:00').toISOString()})),{id:'week-log',action:'teacher_save',actor_id:'demo-admin',created_at:new Date(day(6)+'T12:00:00+08:00').toISOString()},{id:'old-log',action:'teacher_save',actor_id:'demo-admin',created_at:new Date(day(8)+'T12:00:00+08:00').toISOString()}],conversations:[],handovers:[...Array.from({length:7},(_,i)=>note('今日紀錄'+i,0)),note('近週紀錄',6),note('較早紀錄',8)]}));
 });
 await page.goto('/');await expect(page.locator('.handover-history')).toHaveCount(0);await page.getByRole('button',{name:'系統管理',exact:true}).click();const details=page.locator('.handover-history');await expect(details).not.toHaveAttribute('open','');await expect(details.locator('.history-list')).not.toBeVisible();await details.locator('summary').click();await expect(details.getByRole('button',{name:'今日',exact:true})).toHaveAttribute('aria-pressed','true');await expect(details.locator('.history-list .handover-row')).toHaveCount(5);expect((await details.locator('.history-list').boundingBox())!.height).toBeLessThanOrEqual(380);
 await details.getByRole('button',{name:'下一頁交接紀錄'}).click();await expect(details.locator('.history-list .handover-row')).toHaveCount(2);
 await details.getByRole('button',{name:'近一週',exact:true}).click();await expect(details.locator('.history-pagination')).toContainText('1 / 2');await details.getByRole('button',{name:'下一頁交接紀錄'}).click();await expect(details.locator('.history-list')).toContainText('近週紀錄');await expect(details.locator('.history-list')).not.toContainText('較早紀錄');
 await details.getByRole('button',{name:'特定日期',exact:true}).click();const oldDay=await page.evaluate(()=>{const h=JSON.parse(localStorage.getItem('office-line-demo-v1')!).handovers.find((h:any)=>h.content==='較早紀錄');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(h.completed_at));const get=(t:string)=>parts.find(p=>p.type===t)!.value;return `${get('year')}-${get('month')}-${get('day')}`;});await details.getByLabel('交接紀錄日期',{exact:true}).fill(oldDay);await expect(details.locator('.history-list .handover-row')).toHaveCount(1);await expect(details.locator('.history-list')).toContainText('較早紀錄');
 await details.getByLabel('交接紀錄日期',{exact:true}).fill('2000-01-01');await expect(details.locator('.history-list')).toContainText('此日期沒有已完成的交接紀錄');await details.locator('summary').click();await expect(details.locator('.history-list')).not.toBeVisible();

 const templates=await page.locator('.settings-templates').boundingBox(),operations=await page.locator('.settings-operation-history').boundingBox(),handovers=await page.locator('.settings-handover-history').boundingBox();expect(templates!.x).toBeLessThan(operations!.x);expect(operations!.x).toBe(handovers!.x);expect(operations!.y).toBeLessThan(handovers!.y);const topCards=page.locator('.settings-grid > .panel');expect((await topCards.nth(0).boundingBox())!.y).toBe((await topCards.nth(1).boundingBox())!.y);
 const audit=page.locator('.operation-history');await expect(audit).toHaveAttribute('open','');await expect(audit.locator('.record-audit')).toHaveCount(5);expect((await audit.locator('.history-list').boundingBox())!.height).toBe(280);expect(await audit.locator('.history-list').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await audit.getByRole('button',{name:'下一頁操作紀錄'}).click();await expect(audit.locator('.record-audit')).toHaveCount(2);await audit.getByRole('button',{name:'近一週',exact:true}).click();await expect(audit.locator('.history-pagination')).toContainText('1 / 2');await audit.getByRole('button',{name:'下一頁操作紀錄'}).click();await expect(audit.locator('.record-audit')).toHaveCount(3);
 await audit.getByRole('button',{name:'特定日期',exact:true}).click();await audit.getByLabel('操作紀錄日期',{exact:true}).fill(oldDay);await expect(audit.locator('.record-audit')).toHaveCount(1);await expect(details.getByLabel('交接紀錄日期',{exact:true})).toHaveValue('2000-01-01');await audit.getByLabel('操作紀錄日期',{exact:true}).fill('2000-01-01');await expect(audit.locator('.history-list')).toContainText('此日期沒有操作紀錄');
 await page.setViewportSize({width:390,height:844});await details.locator('summary').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('對話內部備註：獨立保存、切換教師與重新整理，不混入 LINE 訊息',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-list button').filter({hasText:'示範教師甲'}).click();const count=await page.locator('.messages .message').count();
 await page.locator('.internal-notes summary').click();await page.getByLabel('新增內部備註',{exact:true}).fill('老師請下午再聯絡，僅供辦公室交接。');await page.getByRole('button',{name:'儲存內部備註',exact:true}).click();await expect(page.locator('.internal-note-list')).toContainText('老師請下午再聯絡，僅供辦公室交接。');await expect(page.locator('.messages')).not.toContainText('僅供辦公室交接');await expect(page.locator('.messages .message')).toHaveCount(count);
 await page.locator('.chat-list button').filter({hasText:'示範教師丙'}).click();await expect(page.locator('.internal-note-list')).not.toContainText('老師請下午再聯絡');
 await page.reload();await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-list button').filter({hasText:'示範教師甲'}).click();await page.locator('.internal-notes summary').click();await expect(page.locator('.internal-note-list')).toContainText('老師請下午再聯絡');await expect(page.locator('.internal-note-list')).toContainText('示範管理員');
});

test('交接更正與恢復：姓名、內容、完成狀態與修改前後紀錄',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新增交接',exact:true}).click();await page.getByLabel('交接人',{exact:true}).fill('交接誤名');await page.getByLabel('交接內容').fill('原交接內容');await page.getByRole('button',{name:'儲存交接',exact:true}).click();
 const pending=page.locator('#handovers .handover-row');await pending.getByRole('button',{name:'更正',exact:true}).click();await page.getByLabel('交接人',{exact:true}).fill('交接正名');await page.getByLabel('交接內容').fill('更正後交接內容');await page.getByLabel('更正原因（選填）').fill('修正內容與姓名');await page.getByRole('button',{name:'儲存更正',exact:true}).click();await expect(pending).toContainText('更正後交接內容');
 await pending.getByRole('button',{name:'標記完成'}).click();await page.getByLabel('完成人姓名').fill('完成誤名');await page.getByRole('button',{name:'確認完成',exact:true}).click();await page.getByRole('button',{name:'系統管理',exact:true}).click();await page.locator('.handover-history summary').click();const done=page.locator('.handover-history .handover-row');
 await done.getByRole('button',{name:'更正',exact:true}).click();await page.getByLabel('完成人姓名').fill('完成正名');await page.getByRole('button',{name:'儲存更正',exact:true}).click();await expect(done).toContainText('完成正名');
 await done.getByRole('button',{name:'修改紀錄',exact:true}).click();const edit=page.locator('.handover-change').filter({hasText:'更正交接'}).first();await edit.locator('summary').click();await expect(edit).toContainText('完成誤名');await expect(edit).toContainText('完成正名');await page.getByRole('button',{name:'關閉',exact:true}).click();
 await done.getByRole('button',{name:'恢復待處理',exact:true}).click();await page.getByLabel('恢復原因（選填）').fill('尚未完成確認');await page.getByRole('button',{name:'確認恢復',exact:true}).click();await expect(page.locator('.handover-history .handover-row')).toHaveCount(0);
 await page.getByRole('button',{name:'值班工作台',exact:true}).click();await expect(pending).toContainText('更正後交接內容');await expect(pending).toContainText('交接正名');await pending.getByRole('button',{name:'修改紀錄',exact:true}).click();const reopened=page.locator('.handover-change').filter({hasText:'恢復待處理'});await reopened.locator('summary').click();await expect(reopened).toContainText('完成正名');await expect(reopened).toContainText('尚未完成確認');await expect(reopened).toContainText('已完成');await expect(reopened).toContainText('待處理');
});

test('通知紀錄：發送失敗與結果未明篩選，可與教師及處理狀態搭配',async({page})=>{
 await page.addInitScript(()=>{
  const now=new Date().toISOString();const teacher=(id:string,name:string)=>({id,name,department:'測試',notes:'',active:true,bound_at:now,last_notified_at:now});
  const notice=(id:string,teacher_id:string,send_status:string,status:string)=>({id,teacher_id,send_status,status,content:id,kind:'mail',important:false,sender_id:'demo-admin',created_at:now});
  localStorage.setItem('office-line-demo-v1',JSON.stringify({teachers:[teacher('a','教師甲'),teacher('b','教師乙')],notifications:[notice('甲失敗','a','failed','待領取'),notice('乙失敗','b','failed','已完成'),notice('結果不明','a','uncertain','待回覆'),notice('已接受','a','accepted','待領取'),notice('待傳送','b','queued','待領取')],messages:[],staff:[{id:'demo-admin',display_name:'示範管理員',role:'admin',active:true}],templates:[],audit_logs:[],conversations:[],handovers:[]}));
 });
 await page.goto('/');await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(5);await page.getByLabel('發送結果',{exact:true}).selectOption('failed');await expect(page.locator('tbody tr')).toHaveCount(2);await page.getByLabel('教師篩選').selectOption('a');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('甲失敗');
 await page.getByLabel('處理狀態',{exact:true}).selectOption('已完成');await expect(page.locator('tbody tr')).toHaveCount(0);await page.getByLabel('教師篩選').selectOption('');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('乙失敗');
 await page.getByLabel('處理狀態',{exact:true}).selectOption('全部狀態');await page.getByLabel('發送結果',{exact:true}).selectOption('uncertain');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('.info')).toContainText('避免重複發送');await page.getByLabel('發送結果',{exact:true}).selectOption('accepted');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('已接受');
});

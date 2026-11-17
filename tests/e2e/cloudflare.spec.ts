import {migrationStatements} from '../migrations';
import{productionCryptoLimit}from'../production-crypto';
import{test,expect}from'@playwright/test';
import{Miniflare}from'miniflare';
import{build}from'esbuild';
import{readFileSync}from'node:fs';
import{spawn,type ChildProcess}from'node:child_process';
import{randomBytes,randomUUID,createHmac}from'node:crypto';
import{passwordHash}from'../../worker/security';
const origin='http://localhost:5174';
let mf:Miniflare,vite:ChildProcess;
const username='browser-'+randomUUID(),password=randomBytes(24).toString('hex'),authPepper=randomBytes(32).toString('hex'),bindingPepper=randomBytes(32).toString('hex'),lineSecret=randomBytes(32).toString('hex');
let lineCalls:any[]=[],lineStatus=200;
test.beforeAll(async()=>{
 const built=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'browser',write:false});
  mf=new Miniflare({modules:true,script:productionCryptoLimit+built.outputFiles[0].text,compatibilityDate:'2026-07-01',d1Databases:['DB'],bindings:{ALLOWED_ORIGIN:origin,COOKIE_SECURE:'false',AUTH_PEPPER:authPepper,BINDING_PEPPER:bindingPepper,LINE_CHANNEL_SECRET:lineSecret,LINE_CHANNEL_ACCESS_TOKEN:randomBytes(32).toString('hex'),LINE_SEND_ENABLED:'true'},outboundService:async(req:any)=>{lineCalls.push(await req.json());return new Response('{}',{status:lineStatus});}});
 const db=await mf.getD1Database('DB');await db.batch(migrationStatements().map(sql=>db.prepare(sql)));
 const now=new Date().toISOString();await db.prepare('INSERT INTO admins VALUES(?,?,?,?,?,?,?,?)').bind('browser-admin',username,'瀏覽器測試管理員',await passwordHash(password,authPepper),'admin',1,now,now).run();
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','localhost','--port','5174','--strictPort'],{env:{...process.env,VITE_APP_MODE:'cloudflare',VITE_API_BASE:'/api',VITE_BASE_PATH:'/'},stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('正式模式 Vite 提前停止；請確認 5174 埠沒有被其他程序占用');try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('正式模式測試前端未啟動');
});
test.afterAll(async()=>{vite?.kill();await mf?.dispose();});
test('Cloudflare 模式：實際 Cookie 登入、綁定、推播 Mock、簽章 Webhook、輪詢顯示與登出',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 // 將瀏覽器 API 導向真實本機 workerd＋D1；對外 LINE HTTP 為 Mock，沒有真實個資或憑證。
 await page.route(origin+'/api/**',async route=>{const req=route.request();const response=await mf.dispatchFetch('http://localhost'+(new URL(req.url()).pathname+new URL(req.url()).search),{method:req.method(),headers:await req.allHeaders(),...(req.method()==='POST'?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.goto(origin);await page.getByLabel('登入帳號',{exact:true}).fill(username);await page.getByLabel('密碼',{exact:true}).fill(password);await page.getByRole('button',{name:'登入辦公室'}).click();await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();await expect(page.locator('.demo-banner')).toHaveCount(0);
 await page.getByRole('button',{name:'教師名單',exact:true}).click();await page.getByRole('button',{name:'新增教師'}).click();await page.getByLabel('教師姓名',{exact:true}).fill('虛構整合測試教師');await page.getByLabel('所屬單位',{exact:true}).fill('測試單位');await page.getByRole('button',{name:'儲存教師',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:'虛構整合測試教師'});await row.getByRole('button',{name:'產生綁定碼'}).click();const code=await page.locator('.code').textContent();await page.getByRole('button',{name:'關閉',exact:true}).click();
 const uid='U'+randomUUID();const hook=async(text:string)=>{const raw=JSON.stringify({events:[{webhookEventId:randomUUID(),timestamp:Date.now(),type:'message',source:{type:'user',userId:uid},message:{type:'text',id:randomUUID(),text},replyToken:randomBytes(16).toString('hex')}]});const response=await mf.dispatchFetch('http://localhost/api/line/webhook',{method:'POST',headers:{'x-line-signature':createHmac('sha256',lineSecret).update(raw).digest('base64')},body:raw});expect(response.status).toBe(200);};
 await hook(code!);await expect(row.getByText('已綁定',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'發送通知',exact:true}).click();await page.locator('.teacher-option').getByRole('checkbox').check();await page.getByRole('button',{name:'預覽通知'}).click();await page.getByRole('button',{name:'確認發送給 1 位教師'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(lineCalls.some(c=>c.to===uid&&c.messages[0].text.includes('信件'))).toBe(true);
 await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').click();await expect(page.locator('.attachment-hint')).toHaveText('文件及附件請使用辦公室 Email 傳送');await hook('測試教師回覆已收到');await expect(page.locator('.messages')).toContainText('測試教師回覆已收到',{timeout:20000});
  await expect(page.getByLabel('回覆後完成對話')).toHaveCount(0);
  lineStatus=401;await page.getByLabel('回覆老師',{exact:true}).fill('辦公室網頁回覆測試');await page.getByRole('button',{name:'送出',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('LINE 連線設定需要更新');await expect(page.getByLabel('回覆老師',{exact:true})).toHaveValue('辦公室網頁回覆測試');await expect(page.getByLabel('對話處理狀態')).toHaveValue('待回覆');await expect(page.locator('.messages')).not.toContainText('辦公室網頁回覆測試');
  lineStatus=200;await page.getByRole('button',{name:'送出',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('對話處理狀態')).toHaveValue('已完成');await expect(page.getByLabel('回覆老師',{exact:true})).toHaveValue('');await expect(page.locator('.messages')).toContainText('已送出');await expect(page.locator('body')).not.toContainText('API 已接受');
  await page.getByLabel('對話處理狀態').selectOption('待回覆');lineStatus=503;await page.getByLabel('回覆老師',{exact:true}).fill('結果未明保留草稿測試');await page.getByRole('button',{name:'送出',exact:true}).click();await expect(page.getByRole('alert')).toContainText('發送結果尚未確認');const callsBefore=lineCalls.length;
  await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-teacher').click();await expect(page.getByLabel('回覆老師',{exact:true})).toHaveValue('結果未明保留草稿測試');await page.getByRole('button',{name:'送出',exact:true}).click();await expect(page.getByRole('alert')).toContainText('發送結果尚未確認');expect(lineCalls.length).toBe(callsBefore);await expect(page.getByLabel('對話處理狀態')).toHaveValue('待回覆');lineStatus=200;
 await page.reload();await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();await page.getByRole('button',{name:'系統管理',exact:true}).click();await page.getByRole('button',{name:'新增行政帳號'}).click();await page.getByLabel('登入帳號',{exact:true}).fill('staff-'+randomUUID());await page.getByLabel('初始密碼',{exact:true}).fill(randomBytes(20).toString('hex'));await page.getByLabel('顯示名稱',{exact:true}).fill('虛構新行政人員');await page.getByRole('button',{name:'儲存權限'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.settings-grid')).toContainText('虛構新行政人員');
 await page.getByRole('button',{name:'登出',exact:true}).click();await expect(page.getByRole('button',{name:'登入辦公室'})).toBeVisible();expect(errors).toEqual([]);
});

test('預覽網址提供正式入口並停用登入，不送出帳密',async({page},info)=>{
 let attempts=0;
 await page.route(origin+'/api/**',async route=>{const req=route.request();if(new URL(req.url()).pathname==='/api/login')attempts++;const response=await mf.dispatchFetch('http://localhost'+new URL(req.url()).pathname,{method:req.method(),headers:await req.allHeaders(),...(req.method()==='POST'?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.route(origin+'/api/public-info',route=>route.fulfill({json:{name:'辦公室小幫手',origin:'https://office-line-notifier.pages.dev',version:'2026.11.17.2'}}));
 await page.goto(origin);await expect(page.getByRole('alert')).toContainText('請從正式網站登入');await expect(page.getByRole('link',{name:'前往正式網站'})).toHaveAttribute('href','https://office-line-notifier.pages.dev/');await expect(page.getByRole('button',{name:'登入辦公室'})).toBeDisabled();await expect(page.getByLabel('登入帳號',{exact:true})).toBeDisabled();expect(attempts).toBe(0);await page.screenshot({path:info.outputPath('preview-login.png'),fullPage:true,animations:'disabled'});
});

test('正式模式查詢超過 500 筆的舊通知，更新與復原後畫面同步',async({page})=>{
 const db=await mf.getD1Database('DB'),tid=randomUUID(),prefix=randomUUID(),now=new Date().toISOString(),callsBefore=lineCalls.length;
 await db.prepare("INSERT INTO teachers(id,name,line_user_id,bound_at,binding_version,created_at,updated_at) VALUES(?,?,?, ?,1,?,?)").bind(tid,'虛構歷史查詢教師','U'+randomUUID(),now,now,now).run();
 await db.prepare(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<520)
 INSERT INTO notifications(id,request_id,teacher_id,kind,content,sender_id,binding_version,retry_key,send_status,status,created_at,sent_at)
 SELECT ?||n,?||n,?,'mail',CASE WHEN n=1 THEN '資料庫舊紀錄100%完整文字' ELSE '其他歷史通知'||n END,'browser-admin',1,?||n,'accepted','待領取',
 CASE WHEN n=1 THEN '2025-01-01T00:00:00.000Z' ELSE ? END,CASE WHEN n=1 THEN '2025-01-01T00:00:00.000Z' ELSE ? END FROM seq`).bind('n-'+prefix,'r-'+prefix,tid,'retry-'+prefix,now,now).run();
 await page.route(origin+'/api/**',async route=>{const req=route.request();const response=await mf.dispatchFetch('http://localhost'+new URL(req.url()).pathname+new URL(req.url()).search,{method:req.method(),headers:await req.allHeaders(),...(req.method()==='POST'?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.goto(origin);await page.getByLabel('登入帳號',{exact:true}).fill(username);await page.getByLabel('密碼',{exact:true}).fill(password);await page.getByRole('button',{name:'登入辦公室'}).click();await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();
 await page.getByRole('button',{name:'通知紀錄',exact:true}).click();await page.getByLabel('搜尋通知').fill('資料庫舊紀錄100%');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('資料庫舊紀錄100%完整文字');
 const status=page.getByLabel('更新虛構歷史查詢教師處理狀態');await status.selectOption('已完成');await expect(status).toHaveValue('已完成');await page.locator('.toast').getByRole('button',{name:'復原',exact:true}).click();await expect(status).toHaveValue('待領取');expect(lineCalls.length).toBe(callsBefore);
});

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
let lineCalls:any[]=[];
test.beforeAll(async()=>{
 const built=await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'browser',write:false});
 mf=new Miniflare({modules:true,script:productionCryptoLimit+built.outputFiles[0].text,compatibilityDate:'2026-07-01',d1Databases:['DB'],bindings:{ALLOWED_ORIGIN:origin,COOKIE_SECURE:'false',AUTH_PEPPER:authPepper,BINDING_PEPPER:bindingPepper,LINE_CHANNEL_SECRET:lineSecret,LINE_CHANNEL_ACCESS_TOKEN:randomBytes(32).toString('hex'),LINE_SEND_ENABLED:'true'},outboundService:async(req:any)=>{lineCalls.push(await req.json());return new Response('{}');}});
 const db=await mf.getD1Database('DB');const sql=readFileSync('migrations/0001_initial.sql','utf8').replace(/--[^\n]*/g,'');await db.batch(sql.split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
 const now=new Date().toISOString();await db.prepare('INSERT INTO admins VALUES(?,?,?,?,?,?,?,?)').bind('browser-admin',username,'瀏覽器測試管理員',await passwordHash(password,authPepper),'admin',1,now,now).run();
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','localhost','--port','5174','--strictPort'],{env:{...process.env,VITE_APP_MODE:'cloudflare',VITE_API_BASE:'/api',VITE_BASE_PATH:'/'},stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('正式模式 Vite 提前停止；請確認 5174 埠沒有被其他程序占用');try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('正式模式測試前端未啟動');
});
test.afterAll(async()=>{vite?.kill();await mf?.dispose();});
test('Cloudflare 模式：實際 Cookie 登入、綁定、推播 Mock、簽章 Webhook、輪詢顯示與登出',async({page})=>{
 test.setTimeout(60000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 // 將瀏覽器 API 導向真實本機 workerd＋D1；對外 LINE HTTP 為 Mock，沒有真實個資或憑證。
 await page.route(origin+'/api/**',async route=>{const req=route.request();const response=await mf.dispatchFetch('http://localhost'+new URL(req.url()).pathname,{method:req.method(),headers:await req.allHeaders(),...(req.method()==='POST'?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.goto(origin);await page.getByLabel('登入帳號',{exact:true}).fill(username);await page.getByLabel('密碼',{exact:true}).fill(password);await page.getByRole('button',{name:'登入辦公室'}).click();await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();await expect(page.locator('.demo-banner')).toHaveCount(0);
 await page.getByRole('button',{name:'教師名單',exact:true}).click();await page.getByRole('button',{name:'新增教師'}).click();await page.getByLabel('教師姓名',{exact:true}).fill('虛構整合測試教師');await page.getByLabel('所屬單位',{exact:true}).fill('測試單位');await page.getByRole('button',{name:'儲存教師',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:'虛構整合測試教師'});await row.getByRole('button',{name:'產生綁定碼'}).click();const code=await page.locator('.code').textContent();await page.getByRole('button',{name:'關閉',exact:true}).click();
 const uid='U'+randomUUID();const hook=async(text:string)=>{const raw=JSON.stringify({events:[{webhookEventId:randomUUID(),timestamp:Date.now(),type:'message',source:{type:'user',userId:uid},message:{type:'text',id:randomUUID(),text},replyToken:randomBytes(16).toString('hex')}]});const response=await mf.dispatchFetch('http://localhost/api/line/webhook',{method:'POST',headers:{'x-line-signature':createHmac('sha256',lineSecret).update(raw).digest('base64')},body:raw});expect(response.status).toBe(200);};
 await hook(code!);await expect(row.getByText('已綁定',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'發送通知',exact:true}).click();await page.locator('.teacher-option').getByRole('checkbox').check();await page.getByRole('button',{name:'預覽通知'}).click();await page.getByRole('button',{name:'確認發送給 1 位教師'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(lineCalls.some(c=>c.to===uid&&c.messages[0].text.includes('信件'))).toBe(true);
 await page.getByRole('button',{name:/^訊息中心/}).click();await page.locator('.chat-list button').click();await expect(page.locator('.attachment-hint')).toHaveText('文件及附件請使用辦公室 Email 傳送');await hook('測試教師回覆已收到');await expect(page.locator('.messages')).toContainText('測試教師回覆已收到',{timeout:20000});
 await page.reload();await expect(page.getByRole('heading',{name:'值班工作台'})).toBeVisible();await page.getByRole('button',{name:'系統管理',exact:true}).click();await page.getByRole('button',{name:'新增行政帳號'}).click();await page.getByLabel('登入帳號',{exact:true}).fill('staff-'+randomUUID());await page.getByLabel('初始密碼',{exact:true}).fill(randomBytes(20).toString('hex'));await page.getByLabel('顯示名稱',{exact:true}).fill('虛構新行政人員');await page.getByRole('button',{name:'儲存權限'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.settings-grid')).toContainText('虛構新行政人員');
 await page.getByRole('button',{name:'登出',exact:true}).click();await expect(page.getByRole('button',{name:'登入辦公室'})).toBeVisible();expect(errors).toEqual([]);
});

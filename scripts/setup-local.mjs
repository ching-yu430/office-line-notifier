// 首位管理員建立工具；密碼從終端機隱藏輸入，絕不使用命令列參數或輸出密碼／雜湊。
import{existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync,unlinkSync}from'node:fs';
import{randomBytes,createHmac,pbkdf2Sync,randomUUID}from'node:crypto';
import{createInterface}from'node:readline/promises';
import{spawnSync}from'node:child_process';
const sqlOnly=process.argv.includes('--sql-only');
mkdirSync('.local',{recursive:true});
if(!existsSync('.dev.vars'))writeFileSync('.dev.vars',`AUTH_PEPPER=${randomBytes(32).toString('hex')}\nBINDING_PEPPER=${randomBytes(32).toString('hex')}\nLINE_CHANNEL_ACCESS_TOKEN=\nLINE_CHANNEL_SECRET=\n`,{mode:0o600});
const vars=Object.fromEntries(readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
if(!vars.AUTH_PEPPER||vars.AUTH_PEPPER.length<32)throw Error('請先在 .dev.vars 設定至少 32 字元的 AUTH_PEPPER');
const rl=createInterface({input:process.stdin,output:process.stdout});
const username=(await rl.question('首位管理員登入帳號（3 至 120 字英數及 . _ @ + -）：')).trim().toLowerCase();
const displayName=(await rl.question('顯示名稱：')).trim();rl.close();
if(!/^[a-z0-9._@+-]{3,120}$/.test(username)||!displayName||displayName.length>80)throw Error('帳號或顯示名稱格式錯誤');
function secret(prompt){return new Promise((resolve,reject)=>{if(!process.stdin.isTTY)return reject(Error('請在互動式終端機執行，避免密碼出現在指令紀錄'));process.stdout.write(prompt);let value='';process.stdin.setRawMode(true);process.stdin.resume();const handler=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){finish();return reject(Error('已取消'));}if(c==='\r'||c==='\n'){finish();return resolve(value);}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};function finish(){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',handler);process.stdout.write('\n');}process.stdin.on('data',handler);});}
const password=await secret('初始密碼（12 至 128 字，不顯示）：');if(password.length<12||password.length>128)throw Error('密碼長度須為 12 至 128 字');
if(password!==await secret('再次輸入密碼：'))throw Error('兩次密碼不一致');
const salt=randomBytes(32).toString('hex'),secretHex=createHmac('sha256',vars.AUTH_PEPPER).update(password).digest('hex');
const hash=`pbkdf2-sha256$600000$${salt}$${pbkdf2Sync(secretHex,salt,600000,32,'sha256').toString('hex')}`;
const quote=v=>"'"+v.replaceAll("'","''")+"'",now=new Date().toISOString(),file='.local/bootstrap-admin.sql';
// 僅在沒有任何帳號時新增首位管理員；禁止重跑工具覆寫既有密碼。
writeFileSync(file,`INSERT INTO admins(id,username,display_name,password_hash,role,active,created_at,updated_at) SELECT ${[randomUUID(),username,displayName,hash,'admin'].map(quote).join(',')},1,${quote(now)},${quote(now)} WHERE NOT EXISTS(SELECT 1 FROM admins);\n`,{mode:0o600});
if(sqlOnly){console.log('已建立 .local/bootstrap-admin.sql；包含敏感雜湊，執行後立即刪除，勿提交 Git。正式 Secrets 的 AUTH_PEPPER 必須與本機值相同。');}
else{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','office-line-notifier','--local','--file',file],{stdio:'inherit'});unlinkSync(file);if(r.status!==0)process.exit(r.status||1);console.log('本機管理員初始化完成；若帳號已存在，不會覆寫。');}

// 只有已獲 Cloudflare D1 維護權限的人員可執行後續 SQL；此工具不會自動連線或部署。
import{existsSync,readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{createInterface}from'node:readline/promises';
import{passwordRepairSql}from'./admin-password.mjs';
if(!existsSync('.dev.vars'))throw Error('找不到原有 .dev.vars。請在當時建立管理員的專案資料夾執行；此工具不會產生新金鑰。');
const vars=Object.fromEntries(readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(x=>x&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
if(!vars.AUTH_PEPPER||vars.AUTH_PEPPER.length<32)throw Error('原有 AUTH_PEPPER 缺少或長度不足；請保留並使用當時建立帳號的金鑰。');
const rl=createInterface({input:process.stdin,output:process.stdout});
const username=(await rl.question('要修復的辦公室管理員登入帳號：')).trim().toLowerCase();rl.close();
function secret(prompt){return new Promise((resolve,reject)=>{if(!process.stdin.isTTY)return reject(Error('請在互動式終端機執行，密碼不可放在命令列參數'));process.stdout.write(prompt);let value='';process.stdin.setRawMode(true);process.stdin.resume();const handler=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){finish();return reject(Error('已取消'));}if(c==='\r'||c==='\n'){finish();return resolve(value);}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};function finish(){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',handler);process.stdout.write('\n');}process.stdin.on('data',handler);});}
const password=await secret('登入密碼（12 至 128 字，不顯示；可輸入原本密碼）：');
if(password!==await secret('再次輸入登入密碼：'))throw Error('兩次密碼不一致');
const sql=passwordRepairSql(username,password,vars.AUTH_PEPPER);
mkdirSync('.local',{recursive:true});writeFileSync('.local/repair-admin-password.sql',sql,{mode:0o600});
console.log('已建立 .local/repair-admin-password.sql，沒有修改 .dev.vars，也沒有連線遠端。');
console.log('請由 Cloudflare 維護者執行此 SQL，確認成功後刪除暫存檔。密碼及金鑰不會輸出。');

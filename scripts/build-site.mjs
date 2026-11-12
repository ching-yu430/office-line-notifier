import{spawnSync}from'node:child_process';
const mode=process.argv[2];
if(!['mock','cloudflare'].includes(mode))throw Error('請選擇 mock 或 cloudflare 建置模式');
if(!process.env.npm_execpath)throw Error('請透過 npm run 執行建置');
console.log(mode==='cloudflare'?'建立 Cloudflare 正式模式成品（不會部署）':'建立 GitHub Pages 展示成品（不會部署）');
const result=spawnSync(process.execPath,[process.env.npm_execpath,'run','build'],{stdio:'inherit',env:{...process.env,VITE_APP_MODE:mode,VITE_API_BASE:process.env.VITE_API_BASE||'/api',VITE_BASE_PATH:process.env.VITE_BASE_PATH||(mode==='cloudflare'?'/':'/office-line-notifier/')}});
if(result.status!==0)process.exit(result.status||1);
if(mode==='cloudflare')await import('./build-worker.mjs');else await import('./prepare-pages.mjs');

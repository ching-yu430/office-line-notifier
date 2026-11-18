import {build} from 'vite';
import {mkdtemp,readFile,readdir,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temporary=await mkdtemp(join(tmpdir(),'office-html-preview-'));
// 專用離線展示建置；不讀正式 API、不把後端或環境設定放進 HTML。
process.env.VITE_APP_MODE='mock';process.env.VITE_API_BASE='/api';process.env.VITE_BASE_PATH='./';
try{
 await build({configFile:join(root,'vite.config.ts'),root:join(root,'src'),base:'./',define:{'import.meta.env.VITE_APP_MODE':JSON.stringify('mock'),'import.meta.env.VITE_API_BASE':JSON.stringify('/api')},build:{outDir:temporary,emptyOutDir:true}});
 let html=await readFile(join(temporary,'index.html'),'utf8');
 const assets=join(temporary,'assets'),names=await readdir(assets);
 const media=new Map();
 for(const name of names){
  if(/\.(js|css|map)$/.test(name))continue;
  const type=name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':null;
  if(!type)throw new Error('預覽包含尚未支援的資源類型');
  media.set(name,`data:${type};base64,${(await readFile(join(assets,name))).toString('base64')}`);
 }
 const embed=content=>{for(const [name,data]of media){for(const pattern of ['./assets/'+name,'/assets/'+name,'assets/'+name,name])content=content.split(pattern).join(data);}return content;};
 const script=html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/);
 if(!script||!script[1].startsWith('./assets/'))throw new Error('找不到可內嵌的主程式');
 if(names.filter(n=>n.endsWith('.js')).length!==1)throw new Error('離線預覽不接受外部程式分塊');
 const javascript=embed(await readFile(join(temporary,script[1]),'utf8')).replace(/<\/script/gi,'<\\/script');
 html=html.replace(script[0],()=>`<script type="module">${javascript}</script>`);
 const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
 if(!styles.length)throw new Error('找不到可內嵌的樣式');
 for(const match of styles){if(!match[1].startsWith('./assets/'))throw new Error('預覽不接受外部樣式');const css=embed(await readFile(join(temporary,match[1]),'utf8'));html=html.replace(match[0],()=>`<style>${css}</style>`);}
 html=embed(html).replace('<title>辦公室小幫手</title>','<title>辦公室小幫手｜離線預覽</title>');
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 if(/(?:src|href)="(?:\.\/assets\/|\/assets\/|https?:\/\/)/.test(markup))throw new Error('預覽仍有外部資源');
 html=html.replace(/<meta charset="UTF-8"\s*\/?>/i,'').replace('<html lang="zh-Hant">','<html lang="zh-Hant" data-office-preview="offline"><meta charset="UTF-8">');
 const destination=join(root,'.local','preview');await mkdir(destination,{recursive:true});
 await writeFile(join(destination,'office-line-notifier-preview.html'),html,'utf8');
 process.stdout.write('已建立 .local/preview/office-line-notifier-preview.html；使用 Chrome 直接開啟，僅虛構資料。\n');
}finally{await rm(temporary,{recursive:true,force:true});}

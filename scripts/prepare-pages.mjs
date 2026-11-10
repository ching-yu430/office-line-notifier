import {cpSync,rmSync,writeFileSync} from 'node:fs';
// 根目錄為 GitHub Pages 靜態成品；Vite 原始入口保存在 src/index.html。
rmSync('assets',{recursive:true,force:true});
cpSync('dist/assets','assets',{recursive:true});
cpSync('dist/index.html','index.html');
writeFileSync('.nojekyll','');

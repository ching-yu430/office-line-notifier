import {defineConfig} from 'vite';
export default defineConfig({root:'src',envDir:'..',base:process.env.VITE_BASE_PATH||'./',build:{outDir:'../dist',emptyOutDir:true},server:{host:'0.0.0.0',proxy:{'^/api/':{target:'http://localhost:8787',changeOrigin:false}}},test:{root:process.cwd(),include:['tests/**/*.test.ts'],testTimeout:30000,hookTimeout:60000}} as any);

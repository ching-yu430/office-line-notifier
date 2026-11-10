import { defineConfig } from 'vite';
export default defineConfig({root:'src',envDir:'..',base:process.env.VITE_BASE_PATH || './',build:{outDir:'../dist',emptyOutDir:true},server:{host:'0.0.0.0'},test:{root:process.cwd(),include:['tests/**/*.test.ts']}} as any);

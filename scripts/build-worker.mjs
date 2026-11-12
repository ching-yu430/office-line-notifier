import{build}from'esbuild';
import{writeFileSync}from'node:fs';
await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/_worker.js'});
writeFileSync('dist/_routes.json',JSON.stringify({version:1,include:['/api/*'],exclude:[]}));
writeFileSync('dist/_headers',`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
`);

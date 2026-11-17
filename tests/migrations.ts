import {readFileSync,readdirSync} from 'node:fs';
export function migrationStatements(){
 return readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort().flatMap(n=>readFileSync('migrations/'+n,'utf8').replace(/--[^\n]*/g,'').split(/;\s*(?=(?:CREATE|INSERT|ALTER|PRAGMA|$))/g).map(s=>s.trim()).filter(Boolean));
}

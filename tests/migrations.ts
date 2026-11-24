import {readFileSync,readdirSync} from 'node:fs';

// 保留 trigger 內的分號，亦支援回填資料的 UPDATE 語句。
export function splitMigration(sql:string) {
 const statements:string[]=[];
 let statement='', depth=0;
 const tokens=sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]+|[^A-Za-z_]/g)||[];
 for(const token of tokens){
  if(token.startsWith('--')||token.startsWith('/*'))continue;
  statement+=token;
  const trigger=/^\s*CREATE\s+TRIGGER\b/i.test(statement);
  if(trigger){
   if(/^(BEGIN|CASE)$/i.test(token))depth++;
   if(/^END$/i.test(token))depth--;
  }
  if(token===';'&&(!trigger||depth===0)){
   statements.push(statement.trim());
   statement='';
  }
 }
 if(statement.trim())statements.push(statement.trim());
 return statements;
}
export function migrationStatements(){
 return readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort().flatMap(name=>splitMigration(readFileSync('migrations/'+name,'utf8')));
}

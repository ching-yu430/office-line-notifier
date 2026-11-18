export function pollInterval(chat:boolean,idleMs:number,failures=0){
 if(failures)return Math.min(60000,5000*2**Math.min(failures-1,4));
 return idleMs>=120000?30000:chat?3000:10000;
}

import {BACKUP_INTERVALS} from './backup-format';
export type BackupPreference={hours:number;lastGenerated:number};
export const backupPreferenceKey=(actor:string)=>'office-record-backup-pref:'+actor;
export function readBackupPreference(actor:string,fallback:BackupPreference={hours:0,lastGenerated:0}):BackupPreference{
 try{const v=JSON.parse(localStorage.getItem(backupPreferenceKey(actor))||'null');if(!v)return {hours:0,lastGenerated:0};return {hours:BACKUP_INTERVALS.includes(v.hours)?v.hours:0,lastGenerated:Number.isSafeInteger(v.lastGenerated)&&v.lastGenerated>=0?v.lastGenerated:0};}catch{return fallback;}
}
export const backupDue=(p:BackupPreference,now=Date.now())=>p.hours>0&&now-p.lastGenerated>=p.hours*3600000;

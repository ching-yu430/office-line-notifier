export const backupFields={
 teachers:['id','name','department','notes','active','bound_at','last_notified_at','created_at','updated_at'],
 staff:['id','display_name','role','active'],
 notifications:['id','pickup_item_id','teacher_id','kind','pickup_name','content','important','sender_id','send_status','status','error_code','created_at','sent_at','completed_at','completed_by','version'],
 pickup_items:['id','teacher_id','kind','pickup_name','content','status','created_by','created_at','completed_at','completed_by','cancelled_at','cancelled_by','cancellation_reason','version'],
 messages:['id','teacher_id','direction','content','message_type','created_at','notification_id','withdrawn','processing_status','sequence'],
 conversations:['teacher_id','status','updated_at'],
 templates:['kind','label','content'],
 handovers:['id','teacher_id','content','created_by','creator_name','handover_name','created_at','completed_at','completed_by','completed_name','finisher_name','version'],
 handover_revisions:['id','handover_id','action','actor_id','actor_name','before_data','after_data','reason','created_at'],
 internal_notes:['id','teacher_id','content','author_id','author_name','created_at'],
 audit_logs:['id','actor_id','action','result','teacher_id','handover_id','internal_note_id','details','created_at']
} as const;
export type BackupTable=keyof typeof backupFields;
export type BackupRows=Record<BackupTable,Record<string,unknown>[]>;
export type BackupCounts=Record<BackupTable,number>;
export type BackupSnapshot={token:string;counts:BackupCounts;expires_at:number;created_at:string};
export const backupTables=Object.keys(backupFields) as BackupTable[];
export const backupLabels:Record<BackupTable,string>={teachers:'教師資料',staff:'行政人員名稱',notifications:'通知',pickup_items:'物品登記',messages:'聊天訊息',conversations:'處理狀態',templates:'通知範本',handovers:'交接事項',handover_revisions:'交接修改紀錄',internal_notes:'內部備註',audit_logs:'操作紀錄'};
export const BACKUP_MAX_BYTES=50*1024*1024;
export const BACKUP_INTERVALS=[0,24,168,720] as const;
export function backupRow(table:BackupTable,row:any){return Object.fromEntries(backupFields[table].map(field=>[field,row[field]??null]));}
export function csvCell(value:unknown){
 let text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
 if(/^[\s\uFEFF]*[=+\-@]/u.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export const backupCsv=(table:BackupTable,rows:Record<string,unknown>[])=>'\uFEFF'+[backupFields[table].map(csvCell).join(','),...rows.map(row=>backupFields[table].map(field=>csvCell(row[field])).join(','))].join('\r\n')+'\r\n';

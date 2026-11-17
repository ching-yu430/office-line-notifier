export type PendingPickup={teacher_id:string;name:string;count:number};
export function DuplicateWarning({pending}:{pending:PendingPickup[]}){
 if(!pending.length)return null;
 return <div className="duplicate-warning" role="note"><b>已有待領取紀錄</b><ul>{pending.map(t=><li key={t.teacher_id}>{t.name}：{t.count} 筆</li>)}</ul><p>請核對是否為新收到的物品；若是同一件，這次會再次通知並新增一筆紀錄。</p></div>;
}

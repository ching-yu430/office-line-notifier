// 純資料規則，供前端與 Worker 共用；不相依瀏覽器或資料庫。
export type NoticeKind={kind:string;pickup_name?:string|null};
export const isPickup=(n:NoticeKind)=>['mail','parcel','pickup'].includes(n.kind)||!!n.pickup_name;
export const kindLabel:Record<string,string>={mail:'實體信件',parcel:'包裹通知',pickup:'其他待領物品',contact:'行政聯絡',custom:'自訂訊息',reply:'聊天回覆'};
export const noticeLabel=(n:NoticeKind)=>n.pickup_name||kindLabel[n.kind]||'通知';
export const pickupMessage=(name:string)=>`您的${name.trim()||'物品'}已送達辦公室，請撥空領取。`;
export const needsSendReview=(n:{send_status:string;status:string})=>n.status!=='已完成'&&['failed','uncertain'].includes(n.send_status);

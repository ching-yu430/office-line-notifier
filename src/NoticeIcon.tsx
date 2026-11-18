import {Boxes,Mail,Package,MessageCircle} from 'lucide-react';
import {isPickup,type NoticeKind} from './notice';
export function NoticeIcon({kind,pickup_name,size=18,className}:NoticeKind&{size?:number;className?:string}){
 const Icon=kind==='mail'?Mail:kind==='parcel'?Package:isPickup({kind,pickup_name})?Boxes:MessageCircle;
 return <Icon size={size} className={className}/>;
}

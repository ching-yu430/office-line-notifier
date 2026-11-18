import {it,expect} from 'vitest';
import {pollInterval} from '../src/polling';
import {isPickup,noticeLabel,pickupMessage} from '../src/notice';
import {noticeStatus} from '../src/workflow';
it('訊息中心三秒、其他頁十秒，閒置兩分鐘放慢至三十秒',()=>{expect(pollInterval(true,0)).toBe(3000);expect(pollInterval(false,0)).toBe(10000);expect(pollInterval(true,119999)).toBe(3000);expect(pollInterval(true,120000)).toBe(30000);});
it('網路錯誤逐次退避且上限一分鐘，恢復後回正常頻率',()=>{expect([1,2,3,4,5,9].map(n=>pollInterval(true,0,n))).toEqual([5000,10000,20000,40000,60000,60000]);expect(pollInterval(true,0,0)).toBe(3000);});
it('自填待領物品與一般自訂文字分開處理，顯示名稱及已領取狀態',()=>{const n={kind:'custom',pickup_name:'借用器材',status:'已完成'};expect(isPickup(n)).toBe(true);expect(noticeLabel(n)).toBe('借用器材');expect(noticeStatus(n)).toBe('已領取');expect(isPickup({kind:'custom'})).toBe(false);expect(noticeStatus({kind:'custom',status:'已完成'})).toBe('已處理');expect(pickupMessage(' 教材 ')).toBe('您的教材已送達辦公室，請撥空領取。');});

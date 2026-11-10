import{describe,it,expect}from'vitest';
import{taipeiDay,filterHandoverHistory}from'../src/handover-history';
import type{Handover}from'../src/api';
const now=new Date('2026-11-10T01:00:00Z');
const h=(id:string,completed_at:string|null):Handover=>({id,content:id,created_by:'test',creator_name:'帳號甲',handover_name:'交接甲',created_at:'2026-11-01T00:00:00Z',completed_at,completed_by:completed_at?'test':null,completed_name:completed_at?'帳號乙':null,finisher_name:completed_at?'完成乙':null});
describe('台灣時間交接紀錄篩選',()=>{
 it('台灣日期在 UTC 16:00 換日',()=>{expect(taipeiDay(new Date('2026-11-09T15:59:59Z'))).toBe('2026-11-09');expect(taipeiDay(new Date('2026-11-09T16:00:00Z'))).toBe('2026-11-10');});
 it('今日僅依完成時間篩選，不以建立日期計算',()=>{const items=[h('昨天','2026-11-09T15:59:59Z'),h('今日','2026-11-09T16:00:00Z'),h('明日','2026-11-10T16:00:00Z'),h('未完成',null)];expect(filterHandoverHistory(items,'today','',now).map(h=>h.id)).toEqual(['今日']);});
 it('近一週包含今日與前六天，排除更早、未完成及未來紀錄',()=>{const items=[h('界內','2026-11-03T16:00:00Z'),h('界外','2026-11-03T15:59:59Z'),h('今天','2026-11-10T00:00:00Z'),h('未來','2026-11-10T16:00:00Z')];expect(filterHandoverHistory(items,'week','',now).map(h=>h.id)).toEqual(['今天','界內']);});
 it('特定日期精確比對並按完成時間排序',()=>{const items=[h('晚','2026-11-08T04:00:00Z'),h('早','2026-11-07T16:00:00Z'),h('其他','2026-11-08T16:00:00Z')];expect(filterHandoverHistory(items,'date','2026-11-08',now).map(h=>h.id)).toEqual(['晚','早']);expect(filterHandoverHistory(items,'date','',now)).toEqual([]);expect(filterHandoverHistory(items,'date','2026-01-01',now)).toEqual([]);});
});

import {afterEach,expect,it,vi} from 'vitest';
import {cleanupOptions,cleanupPlanCutoff,cleanupSummary,type CleanupPreview} from '../src/cleanup';
import {needsSendReview} from '../src/notice';
import {noticeStatus} from '../src/workflow';
import {mockCleanup} from '../src/mock-cleanup';
import type {Data} from '../src/api';
afterEach(()=>vi.useRealTimers());
const options={before:'2026-01-01',contact:false,handovers:false,audits:false,failed:true,all_dates:true};
it('全部日期固定在預覽當刻，舊日期條件仍採台灣時間且選項不能以字串冒充',()=>{
 const now=Date.parse('2026-11-19T02:00:00.000Z'),normalized=cleanupOptions(options,now);
 expect(cleanupPlanCutoff(normalized,now)).toBe('2026-11-19T02:00:00.000Z');expect(cleanupPlanCutoff({...normalized,all_dates:false,before:'2026-01-01'},now)).toBe('2025-12-31T16:00:00.000Z');
 for(const p of [{...options,all_dates:'true'},{...options,failed:1},{...options,before:'2026-02-30',all_dates:false},{...options,failed:false}])expect(()=>cleanupOptions(p,now)).toThrow();
 expect(cleanupOptions({...options,before:''},now).before).toBe('2026-11-19');
 expect(cleanupSummary({all_dates:true,counts:{notifications:2,failed_notifications:2}})).toBe('全部日期：通知 2 筆（含發送失敗 2 筆）');
});
it('歷史失敗已處理後不提醒，不把未送出的包裹標示為已領取',()=>{
 expect(needsSendReview({send_status:'failed',status:'待回覆'})).toBe(true);expect(needsSendReview({send_status:'failed',status:'已完成'})).toBe(false);expect(needsSendReview({send_status:'uncertain',status:'待回覆'})).toBe(true);expect(needsSendReview({send_status:'accepted',status:'待領取'})).toBe(false);
 expect(noticeStatus({kind:'parcel',status:'已完成',send_status:'failed'})).toBe('已處理');expect(noticeStatus({kind:'parcel',status:'已完成',send_status:'accepted'})).toBe('已領取');
});
it('展示版可清理兩筆近期失敗、保留未明及已送出待辦，且不包含預覽後新增的失敗',()=>{
 vi.useFakeTimers();vi.setSystemTime('2026-11-19T02:00:00.000Z');
 const row={teacher_id:'teacher',kind:'contact',content:'虛構失敗',created_at:'2026-11-19T01:00:00.000Z',send_status:'failed',status:'待回覆',version:1};
 const data={teachers:[],messages:[],conversations:[],handovers:[],handover_revisions:[],audit_logs:[],notifications:[{...row,id:'failed-1',request_id:'r-1'},{...row,id:'failed-2',request_id:'r-2'},{...row,id:'uncertain',send_status:'uncertain'},{...row,id:'accepted',send_status:'accepted'}]} as unknown as Data;
 const preview=mockCleanup('records_cleanup_preview',options,data,'admin') as CleanupPreview;expect(preview.counts.notifications).toBe(2);expect(preview.counts.failed_notifications).toBe(2);
 data.notifications.push({...row,id:'later',created_at:'2026-11-19T01:59:59.000Z'} as any);
 mockCleanup('records_cleanup_execute',{job_id:preview.job_id,confirmation:'刪除紀錄'},data,'admin');expect(data.notifications.map(n=>n.id)).toEqual(['uncertain','accepted','later']);expect(JSON.parse(data.audit_logs[0].details!).all_dates).toBe(true);
});
it('展示版失敗通知預覽後被改成結果未明時，拒絕整批清理',()=>{
 vi.useFakeTimers();vi.setSystemTime('2026-11-19T02:00:00.000Z');
 const data={teachers:[],messages:[],conversations:[],handovers:[],handover_revisions:[],audit_logs:[],notifications:['a','b'].map(id=>({id,teacher_id:'teacher',kind:'contact',content:'虛構失敗',created_at:'2026-11-19T01:00:00.000Z',send_status:'failed',status:'待回覆',version:1}))} as unknown as Data;
 const preview=mockCleanup('records_cleanup_preview',options,data,'admin') as CleanupPreview;data.notifications[0].send_status='uncertain';expect(()=>mockCleanup('records_cleanup_execute',{job_id:preview.job_id,confirmation:'刪除紀錄'},data,'admin')).toThrow('尚未刪除任何資料');expect(data.notifications).toHaveLength(2);
});

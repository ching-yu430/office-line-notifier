# 維護與交接

## 日常操作

管理員先核對教師本人，再透過可信管道提供綁定碼。綁定完成後確認姓名與時間；若有疑義先停止通知，管理員解除、重新發碼。綁定碼持有即代表可綁該教師，交付管道是必要的人工作業。

教師停用保留重要歷史，停用時撤銷未使用碼；要移轉 LINE 身分先解除再綁。老師封鎖／解除封鎖官方帳號會更新私有 binding blocked，發送前由後端拒絕封鎖狀態。Webhook 送達有延遲，不能保證即時知道封鎖。

## 發送結果

| 狀態 | 意義 | 建議 |
| --- | --- | --- |
| queued／待發送 | 通知已落庫，尚未開始 LINE 請求 | 在紀錄按「處理待發送」，會重新查綁定版本 |
| sending／傳送中 | 已取得獨佔發送權 | 不重建通知，等待結果 |
| accepted／API 已接受 | LINE 接受請求 | 不代表收到、已讀或領取；依教師回覆或人工結案 |
| failed／失敗 | 明確拒絕，例如 HTTP 429、400，或綁定已變更 | 確認額度／綁定及錯誤原因，再由行政人員另建通知 |
| uncertain／結果未明 | timeout、連線中斷或 5xx，可能已接受 | 先核對，禁止盲目另建通知或直接改 queued |

一次處理最多五筆以免函式逾時；100 人作業後需在紀錄繼續處理 queued。此版沒有自動 worker 與背景重試。

若 sending 長時間未結束，由 Supabase 專案維護者先確認 Function 已停止、核對 LINE API 請求紀錄與 retry key。可在 SQL Editor 只將明確選定的一筆標為結果未明（先替換實際 UUID）：

```sql
begin;
update public.notifications
set send_status='uncertain', error_code='operator_review_required'
where id='請替換為實際通知_UUID'::uuid
  and send_status='sending' and created_at < now()-interval '10 minutes';
commit;
```

此動作不會重送。要解鎖教師，應先依 LINE 官方當前 Retry Key 文件核對：對**相同 recipient、原始內容、同一 retry_key**重試有時可辨識既有接受請求，但存在有效期間，不應將過期 retry key 當絕對去重保證。本版未提供結果未明自動重送 UI。若校方確認通知結果後需人工修正，請由資料庫維護者限定單筆操作並另外寫 audit_logs，附上工單於學校內部紀錄；不要直接批次改 accepted 或 queued。

429 依 LINE 的 Retry-After（若有）及官方 rate limit 等待；本版不自動重試 429，避免連續消耗額度。到 LINE Official Account Manager 查看每月訊息方案與使用量；push 訊息費用／額度依當時 LINE 方案與地區而異，不在程式中硬編碼「免費幾則」。系統未提供即時 quota 儀表板。使用量監控可擴充 Messaging API 的 consumption／quota 查詢，由後端呼叫。

## Webhook 異常

- 401：檢查 LINE Channel Secret 與 Webhook 是否來自同一 Channel，不能跳過簽章。
- 400：本文／事件格式異常；不要將原始內容與 User ID 貼入公開紀錄。
- 500：資料庫暫時失敗，LINE 啟用 redelivery 後會重送；同事件 ID 只提交一次。
- reply_failed：資料庫事件已處理，但 LINE 回覆未成功；不回滾綁定，不自動重新消耗 replyToken。管理員看教師 bound_at，必要時透過可信管道說明。
- 未看到回覆：檢查官方帳號 Use webhook、URL、Realtime publication、Auth staff.active、前端連線提示，以及 Supabase 專案是否暫停。
- 不記錄 Authorization、LINE 原始 body、Token、完整例外物件或綁定碼。Edge Functions 回應僅保留有限錯誤資訊。

## 備份與還原

1. 定義校內保存政策與個資存取權限，至少定期備份 public 與 private schemas；private.bindings 是教師對應的關鍵資料。
2. Supabase Dashboard 的備份／PITR 功能依方案而異，不能假設免費方案有每日下載備份。查看 [官方備份文件](https://supabase.com/docs/guides/platform/backups)。
3. 使用 Supabase CLI `db dump --help` 了解目前版本，或在受控維護機使用相容版本 pg_dump，以互動密碼／安全 vault 注入連線。不要把密碼放命令列、終端日誌或 Git。角色與 grants、Migration、Auth 使用者要一起納入還原計畫。
4. 匯出加密保存在學校授權儲存空間，限制讀取權限；本專案 Git 不保存任何 dump。
5. 至少每季在獨立、隔離的測試專案演練還原；保持 `LINE_SEND_ENABLED=false`、不要連正式 Webhook，避免還原舊通知後誤送。
6. 同時還原教師、綁定、notifications、messages、message_sources、events 與 unsent tombstones，避免舊事件重入。備份 snapshot 之後的事件不一定存在；還原後由維護者核對，再決定是否開啟 Webhook。
7. 保留原始 Pepper 於學校秘密管理工具，才能讓尚未到期碼繼續使用；否則發新碼即可。LINE Token 可輪替，不應包在 SQL dump。
8. Auth 的帳號／密碼／外部設定與 Storage 物件不是普通 public schema dump 就能完整還原，依官方文件確認各項範圍。

## 清理與可用性

綁定成功立即刪碼；過期雜湊可每天由 SQL 排程清理：

```sql
delete from private.binding_codes where expires_at<=now();
delete from private.rate_limits where window_at<now()-interval '2 days';
```

Webhook 去重表不可隨意刪除：刪除後舊事件可能再次進入。依 LINE 重送上限與學校保存政策規劃保留期；若需長期歸檔，保留事件 ID 去重能力。收回 tombstone 亦須相同考量。

免費 Supabase 專案可能因閒置暫停；不要把反覆 ping 當成正式維運方案。每天辦公前檢查 Dashboard 狀態；需要穩定服務時評估付費方案及監控。暫停期間 Webhook 可能失敗，超過 LINE 重送窗口就不能保證找回所有訊息。校務緊急事項保留電話／校內信等備援管道。

## 帳號與 Secrets

辦公室個別帳號登入、離職立即停用 staff 並撤銷 Auth sessions，定期複核管理員。不要以 user_metadata 作權限依據。初始管理員由專案管理者建立，網頁禁止修改自己權限。每次敏感操作查當前資料表，不依賴可能陳舊的 JWT 角色。

LINE Token／Channel Secret／Pepper 只在 Supabase Secrets。更新後依平台要求重新部署 Functions；測試署名與訊息流。Service Role Key 洩漏時立即輪替、稽核存取、檢查綁定與權限異動。前端 bundle 應只有公開 URL 與 publishable key。

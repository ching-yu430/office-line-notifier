# 維護、額度、備份與還原

## 每日操作

管理員確認「系統管理」資料來源為 Cloudflare D1、後端狀態及 LINE 訊息額度。值班人員先處理待回覆、待領取及待交接；完成後登記狀態與姓名。不同電腦要共用資料，必須連到同一套正式 API／D1，展示模式不會跨電腦同步。

教師改用 LINE 帳號時，由管理員核實本人，停止該教師通知、解除舊綁定，再透過可信管道提供新碼。不可直接將別人的 LINE User ID 貼入教師資料。綁定碼關閉後不可查回明碼，遺失就重新產生。

## 失敗狀態與排查

- **登入失敗**：帳號每 15 分鐘最多 5 次登入嘗試（包含成功登入），IP 每 15 分鐘最多 30 次。限制到期再試，勿重複連點。帳號不存在與密碼錯誤回相同提示。
- **Session 失效**：8 小時絕對期限，重新登入；停用／改權限／重設密碼也會立即撤銷 Session。正式環境必須 HTTPS＋`COOKIE_SECURE=true`；不要同時使用 www 與非 www、不同 Pages 預覽網域。
- **看不到老師回覆**：確認 LINE Use webhook、正確 URL、Channel Secret、Webhook redelivery、老師仍綁定且啟用；檢查頁面輪詢狀態。隱藏分頁不輪詢，回前景後會更新。未綁定身分不保存一般聊天正文。
- **非文字訊息**：網頁只顯示類型及「文件及附件請使用辦公室 Email 傳送」，不會下載檔案，也不會自動寄 Email。LINE 自身是否保留原附件由 LINE 決定，本系統不做附件保存。
- **accepted**：LINE API 接受請求，不代表老師已讀、收到或一定能接收；封鎖官方帳號等情況可能不會反映為推播 API 失敗。
- **queued**：尚未呼叫 LINE，可在通知紀錄逐筆「處理待發送」。同批最多先處理 5 筆，避免一次請求太久或超過 API 限速。
- **failed**：明確失敗，查看安全錯誤碼（例如 `line_http_401`、`line_http_429`、`binding_changed`）。先修正憑證、額度或教師身分，再由人員核對是否需要新建通知。
- **uncertain**：網路逾時、5xx 或發送中斷，可能已送出；不要直接重送或改為 queued。先核對 LINE 請求紀錄與行政紀錄，與老師確認後才決定是否建立新的通知。
- **綁定成功但 LINE 沒有成功回覆**：綁定不會因 reply API 失敗而撤銷。由管理員查看綁定狀態，維護者查 `webhook_events.reply_status`。`reply_failed`／`reply_not_configured`／`reply_skipped_limit` 代表回覆未完成；不能重用已過期的 reply token。重複事件不會再次回覆。
- **Webhook 500**：資料庫交易未成功或暫時異常，LINE 應重送；若提交後才發生回覆標記故障，重送仍以事件 ID 去重。超過 LINE 的重送期限後，無法保證補回從未寫入資料庫的訊息。

`webhook_events` 沒有原始本文與綁定碼。維護查詢可以只讀彙總，避免輸出 LINE 身分或教師個資：

```powershell
npx wrangler d1 execute office-line-notifier --remote --command "SELECT outcome,reply_status,count(*) AS total FROM webhook_events GROUP BY outcome,reply_status;"
```

## 密碼與金鑰

本專案採 PBKDF2-SHA256／600,000 次，每帳號 256-bit 隨機鹽，再加獨立 `AUTH_PEPPER` HMAC，已在目前 workerd Runtime 驗證可執行。pepper 與登入限流是額外保護，仍需使用強密碼並完成遠端 CPU 驗收。至少使用 12 字元的個別密碼，不能多人共用同一帳號。不要自行降成本以通過免費 CPU 限制。

本機 workerd 測試不能證明遠端免費方案 CPU 一定足夠；在測試 Pages 專案檢查登入 CPU 與錯誤率。若密碼計算超出免費方案限制，應評估適當方案或經審核的身分服務，不要無聲改成明碼／單次 SHA256。此版本未引入付費套件或外部登入服務。

`AUTH_PEPPER` 必須與建立密碼時一致。遺失後無法還原密碼，只能由受信任維護者重設。輪換此金鑰時必須安排全員重設密碼、刪除既有 Session。`BINDING_PEPPER` 輪換會使目前綁定碼及來源 HMAC 無法匹配，可能影響舊訊息撤回；不要無計畫更換，先安排維護與資料遷移。兩者不能使用 LINE Token 或 Channel Secret 代替。

忘記首位管理員密碼時，受信任維護者可在受控環境，用 `worker/security.ts` 相同演算法產生新雜湊，透過參數化維護工具更新指定帳號並刪除其 Session；勿把明碼貼進 SQL 或終端指令。正常情況由另一位管理員在網頁重設密碼。先保留至少兩位具名管理員能降低鎖死風險。

## 免費方案與流量

以 [Cloudflare Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 用量](https://developers.cloudflare.com/d1/platform/pricing/) 及 [LINE 費用／額度](https://developers.line.biz/en/docs/messaging-api/pricing/) 當期公告為準。免費方案不是無限請求、無限資料庫、無限訊息。

輪詢每個可見分頁每 15 秒一次，一天持續開啟約 5,760 次 API 請求，8 小時約 1,920 次；多人／多分頁會累加。ETag 可減少下載與完整查詢，不會讓請求數歸零。D1 有讀寫列數及總容量限制，通知／稽核觸發器也會增加寫入列數。靜態資源由 Pages 提供，API 才消耗 Workers 執行。

每次發送最多處理 5 人，主動發送每帳號每分鐘 30 個建立請求，全域每分鐘最多 60 筆 dispatch 嘗試。LINE 若回 429 不自動重送。綁定猜測每 LINE 身分每小時 10 次，全域 1,000 次；大量無效綁定可能造成暫時無法綁定，需維護者檢查。

整包 Webhook 用 D1 batch，單一 batch 對 Workers 的 D1 呼叫限制計一次；最多 100 個事件、1 MB 本文。自動 reply 最多 40 次，其餘保留略過狀態；先保存資料再回覆。老師一般文字不需要自動 reply，所以仍能完整存入。

每天查看 Pages／Workers 觀測、D1 用量及 LINE 額度。免費額度耗盡、暫停或服務故障期間，採學校既有電話／Email 備援，不應讓緊急行政事項依賴即時送達保證。

## 備份

依校內個資規範訂保留期限及頻率；備份包括教師個資、LINE 身分、密碼雜湊、對話與操作紀錄，必須加密、限制存取，不得提交 Git 或公開下載。本專案 `.local/`、本機 DB、常見 backup SQL 已忽略；仍應在提交前檢查檔案清單。

手動本機／遠端匯出：

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
npx wrangler d1 export office-line-notifier --local --output .local/local-backup.sql
# 經授權的遠端備份，資料不會印到終端機：
npx wrangler d1 export office-line-notifier --remote --output .local/office-backup.sql
```

將檔案移到學校核准的加密備份位置，並備份對應版本的原始碼／Migration。Secrets 必須另外在安全的密碼管理工具保存，SQL 備份不包含 Cloudflare Secrets。若資料庫與金鑰同時遺失，備份中的帳號可能無法登入。

## 還原與演練

先停止該環境主動推播及 Webhook 寫入，再做額外備份；**還原可能覆寫資料，以下遠端操作只能在確認目標及取得核准後執行**。

優先建立隔離的 D1 還原庫，在設定檔填入實際新 ID，以匯出 SQL 還原到空白資料庫（SQL 本身含 schema，不要先套用相同 Migration）：

```powershell
# 名稱與 ID 必須是隔離還原庫，不要指向正式庫。
npx wrangler d1 create office-line-notifier-restore
# 建立專用 wrangler.restore.jsonc，沿用格式但改 database_name / database_id。
npx wrangler d1 execute office-line-notifier-restore --remote --config wrangler.restore.jsonc --file .local/office-backup.sql
```

外鍵及觸發器可能影響匯入，先在本機空庫演練；若匯出工具不含 Migration 管理表，需與備份版本核對後補記已套用的 Migration，不能再次盲目建立同名表。還原庫不接正式 LINE，不啟用 push，核對帳號、教師、訊息、唯一約束與通知狀態後，再另行核准切換。刪除還原的全部 Session，強制重新登入；核對備份後曾發送的通知，避免還原成 queued 再送一次。

D1 另有 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)，可用窗口依方案而異。先查看可用 bookmark，核准後才 restore：

```powershell
npx wrangler d1 time-travel info office-line-notifier
# 將下列值換成官方回傳的真實 bookmark，這會修改遠端資料庫：
npx wrangler d1 time-travel restore office-line-notifier --bookmark 實際BOOKMARK
```

本次沒有執行遠端備份／Time Travel 還原。不要假設備份可用而不演練，也不要把時間回復視為能撤回已經送到 LINE 的訊息。

## 發布與回復版本

GitHub CI 執行測試、Workers 型別檢查及 Pages 編譯，不會部署 Cloudflare。舊 GitHub Pages 手動工作流程只發布展示版。若既有儲存庫啟用了「main 根目錄」Pages，推送 main 的靜態成品仍會觸發舊展示頁更新；正式 Cloudflare 分支應經確認後再推送／綁定。

部署前執行全部測試、備份 D1、檢查 Secrets 不在 `VITE_`／Git／編譯產物。先在隔離測試環境驗證，再由專案擁有者核准正式部署。程式回版不會自動還原 schema；Migration 依前後相容策略前進，重大變更另備回復計畫。

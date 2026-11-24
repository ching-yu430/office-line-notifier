# 辦公室操作流程更新（2026.11.24.1）

本次依照已確認的 grill-me 訪談方向修改。保留暖黃介面、原始透明黑黃 Logo、LINE 文字聯絡及 Email 附件分工。本次尚未部署正式站、操作正式 D1 或發送真實 LINE。

## 操作方式

- **管理員（行政人員）／工讀生**：共用工作流程，無需指派正在處理的人。工讀生能通知、回覆、領件及交接；教師、綁定、帳號及系統設定仍限管理員。
- **訊息中心**：預設「待回覆」，可切換「全部對話」或搜尋。成功送出回覆後自動標記已回覆；老師的新訊息會再列待回覆。LINE API 無法提供私訊已讀狀態，畫面只顯示本系統實際知道的處理結果。
- **對話交接**：對話上方按「交接」，填寫內容及交接人，保留教師連結；完成時照常填寫完成人。兩種角色均可由工作台「交接紀錄」查詢、更正、恢復及查看該筆完整修改紀錄。
- **新增物品**：選老師、物品名稱、編輯文字，再預覽及確認發送。物品與每次 LINE 發送分開保存，發送失敗也保留待領物品。
- **未綁定老師**：可以「僅登記物品」，不會呼叫 LINE。綁定後，在原物品按「重新通知」，編輯內容後發送。
- **重新通知**：沿用同一物品，不會增加待領件數；每次通知保留獨立內容及發送結果。待發送、發送中或結果未明時，禁止另開請求重送該物品。
- **登記領取／取消登記**：需要確認；取消原因選填，保留紀錄。取消不會撤回已送出的 LINE。批次領取與原操作者 60 秒快速復原仍保留。
- **物品紀錄**：「全部領件」可搜尋及篩選待領取、已領取、已取消，每頁 10 筆，查詢完整資料庫。
- **草稿**：同一登入、同一瀏覽器分頁會保留未送出的回覆，重新整理仍可繼續。登出、工作階段失效或切換帳號會清除；不跨電腦同步。儲存期限最長 8 小時，瀏覽器若禁用儲存則僅能在目前頁面暫存。結果未明的回覆保留原請求識別，重新整理後重按不另發一封。
- **聊天歷史**：每次載入 200 則，按「載入較早訊息」可繼續閱讀，保留捲動位置；已載入的舊訊息撤回也會更新。
- **完整統計**：首頁待領件數、發送需檢查及今日完成數直接彙總 D1，不受畫面最近 200／500 筆限制。今日以臺北日期計算。

## 正式更新前

先下載 HTML 預覽確認。更新包不包含 `.env`、`.dev.vars`、個人資料、LINE 憑證，也不覆蓋 `wrangler.jsonc`、`wrangler.worker.jsonc` 及兩個環境範本。請保留已設定的 Database ID、Origin、Secrets 及 Pages 設定。

本版需要 **0006_office_workflows.sql**。必須先備份，再套用 Migration，最後才更新正式前後端；不要只上傳前端。舊領件通知逐筆回填成物品，不以相似內容或教師姓名猜測合併；如舊版已有重複登記，可核對後取消多餘物品。

取得更新後，在包含 `package.json` 與 `wrangler.jsonc` 的專案資料夾開啟 PowerShell：

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:cloudflare
npx.cmd wrangler d1 migrations list office-line-notifier --remote
```

**以下指令會讀寫正式資料庫，請在確認預覽與更新內容後才執行。** 先暫停辦公室同仁操作，選擇安全的本機備份位置：

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
$officeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
npx.cmd wrangler d1 export office-line-notifier --remote --output ".local/office-backup-$officeStamp.sql"
npx.cmd wrangler d1 migrations apply office-line-notifier --remote
npx.cmd wrangler d1 migrations list office-line-notifier --remote
```

確認 0006 已套用後，將更新包中的檔案依原路徑覆蓋至 GitHub 專案；Pages 沿用 `npm run build:cloudflare` 與 `dist`，並重新部署。若 Pages 設定成提交即部署，請先在本機放入新 Migration、完成 D1 更新後再提交整包。此對話尚未替您執行上述正式操作。

## 清理、備份與還原

備份 ZIP 新增「物品登記」，通知含物品關聯，交接含教師關聯。ZIP 是可讀的行政內容備份，不含帳號密碼雜湊、Session、LINE User ID 或綁定碼，**不能用 ZIP 取代完整 D1 還原備份**。

「紀錄清理」新增「已領取或已取消物品」選項，預設不勾。仍有通知引用時，需一併選取符合日期的通知；快速復原期限內及待領物品會保留。刪除失敗通知不會刪除待領物品；若物品本身重複，請先取消登記。

完整 D1 還原建議先建立隔離測試資料庫、匯入 SQL 驗證，再於維護時間切換 Binding；不要直接把舊備份匯入已有資料的正式 D1。依 [維護文件](OPERATIONS.md) 管理 Time Travel、備份及 Secrets。新 Migration 含新表與外鍵，不提供直接刪表降版；若需回復，應使用更新前的完整 D1 備份及相符程式版本。

## 實作限制

輪詢沿用前景 3 秒輕量檢查；資料無變化不重讀對話，背景暫停、錯誤退避。未增加付費即時服務、R2、Supabase 或附件功能。舊版 presence API 保留相容性，網頁不再發送輸入提示或顯示處理人。共用帳號的系統稽核只能辨識登入帳號；交接人及完成人仍依手填姓名記錄。

新功能以本機 workerd／D1、瀏覽器及 LINE HTTP Mock 驗證；需於正式更新後再用測試教師驗收真實 LINE，不能將本次 Mock 測試視為真實 LINE 已驗證。

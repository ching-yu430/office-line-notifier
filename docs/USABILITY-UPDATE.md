# 共同值班操作更新

日期：2026 年 11 月 17 日（台灣）。這是前後端更新包，尚未替使用者部署正式網站。

## 新的操作方式

- 工作台「包裹通知」「信件通知」直接開啟快速通知：搜尋教師、選擇對象、選填領取位置，確認內容後送出。未綁定的教師不能選；多人通知仍使用原「發送通知」頁。
- 訊息中心按「送出」直接回覆，不再出現逐則預覽或「回覆後完成對話」勾選框。成功後自動標記已回覆；老師再傳訊息則回到待回覆。需要繼續處理時可手動切回待回覆。
- 對話依待回覆優先、最近訊息排序，可搜尋姓名與單位，也可只看待回覆或未查看。
- 未查看筆數依目前登入帳號計算；進入對話且訊息已載入後清除。查看不代表已回覆，也不會更改 LINE 的已讀。
- 同事正在輸入時顯示姓名。只傳輸輸入狀態，不傳草稿；每 15 秒更新，停止輸入 30 秒或切離分頁後停止提示，最遲在 45 秒期限後消失。這是協作提示，不鎖住對話，也不能保證不會同時回覆。
- 對話上方可查看待領取的信件、包裹，直接登記已領取。回覆不會自動完成領取。
- 聊天顯示待回覆／已回覆；包裹與信件顯示待領取／已領取；其他通知完成顯示已處理；交接仍為待處理／已完成。資料庫沿用原狀態值，避免破壞既有紀錄。
- 領取與交接完成後，10 秒內可按「復原」。後端限原操作人、60 秒有效、一次使用，並檢查版本。其他人已修改時拒絕復原，所有更正、原完成人與復原紀錄保留。
- 發送失敗用中文說明。管理員可展開技術資訊查看錯誤碼；一般行政人員只看處理建議。失敗及結果未明不清空回覆內容，不能直接當成已送達。

沒有新增稍後追蹤，也沒有新增常用回覆管理。現有固定常用回覆保留。原始 Logo、暖黃色配色、六張卡片排列、系統管理版面、交接姓名與篩選收合維持。

## 更新前先準備

1. 解壓縮更新包，將 `src`、`worker`、`tests`、`docs`、`migrations` 五個資料夾合併到原電腦的專案根目錄（有 `package.json` 的位置），覆寫同名檔案，其餘原檔保留。先不要提交 GitHub，避免 Pages 自動部署到尚未升級的資料庫。
2. 本次需要新增 D1 結構。原教師、綁定、帳號、訊息、通知及交接資料保留；不需要重設密碼或 Secrets。
3. 既有備份包含個資與密碼雜湊，請放在本機 `.local` 並妥善保管，不上傳、不貼終端內容或聊天。

## Windows PowerShell：備份與資料庫更新

在**原專案資料夾**開啟 PowerShell。若新視窗找不到 Node，先執行原先設定的：

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24
```

備份與檢查待套用遷移：

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
$backupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
npx.cmd wrangler d1 export office-line-notifier --remote --output ".local/before-workflow-$backupStamp.sql"
npx.cmd wrangler d1 migrations list office-line-notifier --remote
```

確認原本 `0001_initial.sql` 已套用，待套用清單只有 `0002_workflow.sql` 後，再執行：

```powershell
npx.cmd wrangler d1 migrations apply office-line-notifier --remote
```

看到確認提示時核對是 `office-line-notifier` 與 `0002_workflow.sql`。若 `0001_initial.sql` 也被列為待套用，可能先前用手動 SQL 建表而未留下遷移紀錄；先提供「待套用檔名清單」供維護者確認，不要重建、清空資料庫或重跑初始建表。若 0002 已套用則不需再次執行 SQL。

官方指令：[D1 Wrangler 指令](https://developers.cloudflare.com/d1/wrangler-commands/)、[D1 遷移](https://developers.cloudflare.com/d1/reference/migrations/)。

## 更新網站

1. 資料庫更新成功後，在 GitHub `npust-lc/office-line-notifier` **根目錄**選 **Add file → Upload files**，拖入更新包解壓後的五個資料夾，確認檔案路徑分別為 `src/...`、`worker/...`、`tests/...`、`docs/...`、`migrations/...`，不要多包一層專案名稱。
2. 只上傳更新包檔案，不上傳 `.dev.vars`、`.env`、`.local`、`node_modules`、備份或個資。保留 GitHub 原有 `wrangler.jsonc`、D1 ID、正式網址與 Cloudflare Secrets。
3. 提交 `main` 會觸發既有 Cloudflare Pages 正式部署；準備套用新版時再提交。等最新正式部署成功後，Chrome 按 `Ctrl + Shift + R`。
4. 先只用自己的測試教師驗收快速通知、直接回覆、待回覆切換、領取、復原、跨帳號提示。真人 LINE 驗收由使用者操作，本機測試僅用 Mock LINE HTTP。

本機驗證（選用，不部署）：

```powershell
npm.cmd ci
npx.cmd wrangler d1 migrations apply office-line-notifier --local
npm.cmd test
npm.cmd run build:cloudflare
```

## 限制與維護

- 全站快照仍顯示最近 500 筆通知及訊息；選擇個別教師另載入最近 200 則對話與最多 200 筆待領件，避免舊對話受全站上限影響。更早內容仍存在 D1，由授權管理員依既有匯出方式查詢。
- 未查看與輸入提示是登入後的內部協作功能，未串接 LINE 的 `markAsRead`，也不能得知老師是否已讀。
- 兩個人仍可能同時發送；介面提示有約 15 秒輪詢延遲。發送保持請求去重、固定 LINE 重試鍵與不明結果不自動重送；同一登入期間切頁仍保留原回覆請求，登出或重新整理後須先核對通知紀錄。
- `0002_workflow.sql` 新增 `conversation_views`、`reply_presence`、`undo_actions`，並為通知增加版本欄位。升級失敗時不部署新程式；不要對既有資料庫重跑 `0001_initial.sql`。若程式需回退，保留新增資料表與欄位，回退前版程式即可；不要刪表回復。
- 輸入提示到期後在資料讀取時清理；快速復原資料過期一天後清理，正式稽核與交接修改紀錄保留。

# 系統管理版面調整：2026.11.19.1

此更新包已包含先前尚未上傳的 `2026.11.17.3`、`2026.11.18.1`、`2026.11.18.2`、`2026.11.18.3`、`2026.11.18.4`、`2026.11.18.5`，**之後只需使用這一包**。維持原始透明 Logo、暖黃色設計、六張卡片及原有操作功能。本次沒有更新正式網站、變更遠端資料庫或發送真實 LINE。

## 操作變更

- 系統管理改為「一般設定／操作紀錄／資料維護」三個分類頁籤，主要卡片直接顯示，取消各卡片的獨立收合。
- 一般設定：上方 LINE 與系統狀態、行政帳號權限並排對齊；下方通知範本使用兩欄排列。只有輔助性的維護資訊保留小型展開區。
- 操作紀錄：最近操作與最近交接並排，統一標題、篩選、固定高度清單及頁尾；保留今日／近一週／特定日期、每頁五筆與交接搜尋。
- 資料維護：紀錄備份與紀錄清理並排直接操作，內容過長在卡片內捲動。手機依序改為單欄。
- 分類頁籤及紀錄查詢條件在本次登入保留；支援方向鍵、Home、End 切換。切換分類不會中斷自動備份排程。

本次版面調整沒有新增 Migration 或 Secrets；**累積更新包仍包含先前的 0003／0004／0005**，尚未套用者須在正式更新前依序套用。

## 本包包含的先前修改

- 新增管理員 ZIP 紀錄備份，包含完整 JSON、CSV、筆數與檢查碼，不受畫面最近 500 筆限制。支援此電腦每 1／7／30 天自動備份，需網頁開啟、管理員登入及資料夾授權；關閉網頁後不執行。完整說明見 [紀錄備份](RECORD-BACKUP.md)。
- 修正登入限流誤判、舊 401 誤登出、同時訊息順序、清理舊快照與輸入格式等問題。依賴檢查仍有一項尚待上游修補的開發工具公告，範圍與處理見 [安全檢查報告](SECURITY-REVIEW-2026-11-18.md)。

- 系統管理的「資料維護」提供「紀錄清理」：只有管理員可預覽及刪除指定日期以前的已完成通知／聊天、已完成交接與舊操作紀錄。先看筆數，再輸入「刪除紀錄」確認；保留待辦、每位教師最後一則訊息、教師綁定與清理摘要。此功能不會自動刪除資料，完整規則與分批上限見 [紀錄清理說明](RECORD-CLEANUP.md)。
- 交接事項的「標記完成／更正／修改紀錄」改為電腦版右側同一排，減少每筆上下留白；內容維持電腦 18px、手機 17px。手機及系統管理窄欄的操作放在內容下方靠右同列，保留按鈕文字、完成人填寫、更正與歷程功能。
- 工作台「新增物品」與「全部領件」靠在同一組，新增按鈕放在左側。
- 交接搜尋放在「交接事項」標題右側；手機也保留標題與搜尋同列，新增交接移至下一列。
- 其他待領物品統一改用簡單的提袋圖示，包含選擇、預覽、工作台、訊息中心及多筆領取；信件與包裹維持各自圖示。
- 訊息中心改為直接點按「待回覆／已回覆」，目前狀態以暖黃色標示。回覆成功仍自動改為已回覆，老師新訊息進來再改為待回覆；也可直接切換狀態。同一狀態重複點按不會新增操作紀錄。
- 訊息中心以教師列表、對話、回覆框為主。上方「領件」及「備註」按需打開，同時只顯示一個輔助面板；手機可直接關閉回到聊天。
- 常用回覆改為點開選擇；保留 Enter 換行、Ctrl＋Enter 送出與當次登入的教師草稿。移除重複的教師標示、已送出字樣與頁面介紹；文件附件仍只由 Email 處理。
- 工作台「待領取物品」的「新增物品」、訊息中心領件面板、發送通知的「其他待領物品」，都可填寫物品名稱，例如教材、借用器材、研習資料。
- 自填物品必填 1–80 字；預設訊息會隨名稱更新，手動改過訊息後不覆蓋人工內容。預覽、工作台、聊天領件清單、多筆領取與通知歷史都會顯示物品名稱。
- 自填物品納入待領取、已領取、完成時間／經辦、單筆或整批復原及重複通知提醒。一般「自訂訊息」仍屬行政聯絡，不會自動變成領件。
- 保留上一批：個人綁定 QR／連結、交接大字與收合搜尋、完整交接歷史搜尋、多筆領取、重複通知確認、查詢位置保留及文字對比改善。

## 更新速度與免費方案

| 使用情況 | 檢查間隔 |
| --- | --- |
| 正在操作訊息中心 | 約 3 秒 |
| 其他頁面 | 約 10 秒 |
| 連續 2 分鐘未操作 | 約 30 秒 |
| 隱藏或背景分頁 | 暫停；返回後恢復 |
| 連線失敗 | 5、10、20、40、60 秒逐次退避，上限 60 秒 |

輕量 `GET /api/changes` 先驗證登入、來源，再讀取單列版本；無變更回 304，**不查聊天歷史、不寫稽核、不清理資料、不呼叫 LINE**。只有資料有變更時才取完整快照；目前教師的對話有獨立版本，別人的對話或輸入提示不會反覆載入這位教師的 200 則歷史。完整快照載入會合併同時進行的請求。每分鐘仍會做一次完整檢查，處理卡住的發送及過期資料。閱讀舊訊息時維持捲動位置。

三秒是輪詢間隔，仍有網路、LINE Webhook 與瀏覽器排程延遲，不等於保證三秒內收到或 LINE 已讀。使用者已驗證的正式收發與本版開發測試分開看待：本次沒有使用正式 Token，新增流程仍須手機驗收。

依 Cloudflare 2026-11-17 官方文件，Workers Free 為每日 100,000 次請求與每次 10ms CPU；D1 Free 為每日讀取 5,000,000 列、寫入 100,000 列。一次三秒輪詢不是免費無上限：五個持續操作聊天的分頁、每天八小時，光檢查約 `5 × 8 × 3600 ÷ 3 = 48,000` 次請求，另外還有載入資料、操作與 Webhook。十個長時間開啟的聊天分頁已接近請求上限，請避免同一人重複開很多視窗，並至 Cloudflare Workers / D1 的 Metrics 查看實際用量。閒置與背景暫停可降低用量，沒有加入額外付費服務。

官方參考：[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)。

## 之後要更新時的正確順序

現在暫時無法上傳，不需要立即執行以下步驟。等你確認畫面、準備更新正式網站時再操作。

1. 將整合包解壓後的 `src`、`worker`、`tests`、`docs`、`migrations`、`scripts` **六個資料夾**合併到原本完整專案；覆寫同名檔案、其餘保留，勿刪除既有 0001／0002 Migration。
2. 一併覆寫根目錄的 **`package.json`、`package-lock.json`、`vite.config.ts`、`README.md`**；QR 與 ZIP 套件需要前兩個檔案；`vite.config.ts` 另將開發伺服器預設限於本機，`README.md` 更新操作說明。
3. 原本的 `wrangler.jsonc`、D1 ID、正式網址、`.dev.vars`、Secrets、教師資料與登入帳密保持原樣。此包不含環境設定或真實資料。
4. 先備份 D1，再依序套用尚未執行的 **`0003_pickup_items.sql`**、**`0004_record_cleanup.sql`**、**`0005_record_exports.sql`**。0003 加入自填物品與對話版本；0004 加入清理帳本、稽核摘要欄位及防止已清理通知再次發送的標記。0005 加入備份版本。三者只升級結構，不會自動刪除歷史，也不需重建資料庫。
5. Migration 成功後，確認要更新正式網站，再到 `npust-lc/office-line-notifier` 的 GitHub 根目錄 **Add file → Upload files**，拖入上述六個資料夾及四個檔案。不要上傳 ZIP 本身，不要多包一層外部資料夾。
6. **提交 `main` 會觸發既有 Cloudflare Pages 正式部署。** 成功後開固定網址 `https://office-line-notifier.pages.dev/`，按 `Ctrl + Shift + R`；系統管理的介面／後端版本應同為 `2026.11.19.1`。

本整合包以目前既有專案為基礎，不能單獨從空資料夾啟動。前一版 `BINDING-DESK-UPDATE.md` 中「不需 Migration」只適用 2026.11.17.3，本版應以本文件為準。

## Windows PowerShell：本機先預覽

在原完整專案根目錄（有 `package.json` 與 `wrangler.jsonc` 那層）執行：

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24
npm.cmd ci
$env:VITE_APP_MODE = "mock"
$env:VITE_BASE_PATH = "/"
npm.cmd run dev -- --host 127.0.0.1
```

開啟終端顯示的本機網址，通常為 `http://127.0.0.1:5173/`。此展示不需要套用正式 Migration、不會連接正式 D1 或發送 LINE。按 `Ctrl + C` 停止。

```powershell
npm.cmd test
npm.cmd run build:cloudflare
Remove-Item Env:VITE_APP_MODE -ErrorAction SilentlyContinue
Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue
```

## Windows PowerShell：準備正式更新時才執行

同樣在原完整專案根目錄；先確認本機 `wrangler.jsonc` 指向目前的 `office-line-notifier` D1，保留你原本的實際 Database ID。

```powershell
npm.cmd ci
npx.cmd wrangler d1 migrations list office-line-notifier --remote
```

若目前只套用 0001／0002，預期清單會有 0003、0004、0005；若已完成 0004，這次只會列 0005。請以實際清單為準，不要重複手動執行已套用的 SQL。備份只保留在自己的電腦，不要上傳 GitHub：

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
$officeBackupPath = Join-Path ".local" ("before-0005-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")
npx.cmd wrangler d1 export office-line-notifier --remote --output $officeBackupPath
npx.cmd wrangler d1 migrations apply office-line-notifier --remote
npx.cmd wrangler d1 migrations list office-line-notifier --remote
```

確認沒有待套用遷移，再上傳 GitHub 觸發部署。升級先新增相容舊版的欄位與資料表，舊版程式仍可繼續運作。不要先部署新程式卻漏套用 0003、0004 或 0005，否則介面會提示資料庫版本不符。

## 測試與驗收

詳細結果見 [TEST-REPORT.md](TEST-REPORT.md)。使用虛構資料與 LINE HTTP Mock；沒有讀取真實老師個資、正式帳密或 Secrets。之後由你使用自己的測試教師確認：收到新訊息、物品名稱與發送內容、領取與復原、QR 預填綁定。不要用正式教師做未確認的測試。

## 不安裝 Node 的 HTML 預覽

另提供的 HTML 預覽包只有 `office-line-notifier-preview.html`。解壓縮後直接用 Windows 的 Chrome 開啟即可，不需要開伺服器、上傳 GitHub 或設定 Cloudflare。網頁樣式、程式及原 Logo 已內嵌，沒有外部資源或正式 API 請求，可測試各分頁、通知、領件、交接及模擬 LINE 回覆。

全部使用虛構資料；改動只存在這份預覽的本機瀏覽器資料中，不會同步至正式資料庫。若瀏覽器禁止儲存，會改用本次視窗記憶體；關閉後不保留。模擬收訊從訊息中心下方「測試工具」展開。版面與流程想再調整時，回覆修改清單或截圖，我們會更新同一套 React 原始碼並重建 HTML；此 HTML 是建置後預覽，請勿把它覆寫成正式網站的 `index.html`。

試用紀錄清理時，到「系統管理 → 資料維護 → 紀錄清理」，展開底部「測試工具」，按「加入舊紀錄範例」，就能預覽及刪除虛構舊資料。測試工具只存在展示版，正式模式不會出現。

需要自行重新產生單檔預覽時，在完整專案根目錄執行：

```powershell
npm.cmd run build:html-preview
Start-Process .local/preview/office-line-notifier-preview.html
```

預覽建置獨立使用暫存資料夾，不會覆寫正式 `dist`，不會包含 Worker、帳密、Secrets 或真實教師資料。`.local` 已由 Git 忽略。

HTML 自動化驗證使用同一份建置成品攔截為測試文件載入，確認所有互動與沒有額外 HTTP／API 請求。開發環境的受管理瀏覽器封鎖 `file://` 導航，沒有修改其政策；Windows Chrome 直接開啟檔案仍須在你的電腦試開驗收。

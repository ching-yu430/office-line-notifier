# 個人綁定與值班操作更新：2026.11.17.3

> 尚未上傳前版而使用 2026.11.18.2 整合包時，請改依 [整合更新說明](CONVERSATION-UPDATE.md)，並套用新增的 0003 Migration。

本版依選定的驗證 A、1／2／4／6／7／8 製作，維持原始透明黑黃 Logo、暖黃色配色、六張並列卡片與系統管理兩欄配置。只準備更新檔，沒有操作正式部署或對真實教師發送 LINE。

## 使用方式

- **個人綁定 QR Code／連結**：管理員到教師名單按「產生綁定碼」，可複製個人綁定連結、下載 QR Code 或複製原綁定碼，透過可信管道交給指定教師。老師掃描或點開連結後，在 LINE 按「傳送」；首次使用先加入官方帳號好友。預填文字不代表已驗證，只有 Webhook 核對成功才完成綁定。
- **交接閱讀與搜尋**：內容電腦 18px、手機 17px，行高 1.8。工作台預設顯示最新三筆，可展開、收合或搜尋內容與交接人。系統管理的已完成交接可再查完成人，維持今日／近一週／特定日期、每頁五筆與固定高度捲動。正式版搜尋已完成交接會查詢完整 D1 歷史，不受快照 1,000 筆限制。
- **多筆領取**：同一教師有多筆待領取時，工作台或訊息中心會顯示「多筆領取」。勾選本次已領走的包裹與信件，核對姓名與內容後一次確認；沒有勾選的紀錄不變。每次最多 100 筆，清單最多載入 200 筆，處理後可重新載入。保留每筆完成時間、經辦人及操作紀錄。
- **整批復原**：領件完成的提示可按「復原」，一次還原本批；授權僅限原操作人、限時 60 秒且只能一次。提示顯示 10 秒。任一紀錄被其他人更正或已過期，整批拒絕覆蓋，請核對最新紀錄。
- **重複通知提醒**：包裹與信件在預覽時核對待領取紀錄，顯示教師與筆數。按「確認仍需通知」才建立新通知；若是原本同一件物品，會再次傳送並新增一筆待領取紀錄，請先核對。行政聯絡與聊天回覆不受此提醒限制。後端也檢查，可攔下另一位同事在預覽期間建立的領件通知。
- **查詢位置保留**：通知紀錄進入對話後，可按「返回通知紀錄」，回到原搜尋、篩選、頁碼及捲動位置。教師名單保留本次搜尋與表格位置；系統管理的紀錄保留日期、頁碼與收合狀態。只存在當次登入期間的記憶體，重新整理、登出或工作階段失效即清除。
- **資訊易讀**：時間、姓名、單位、處理狀態等輔助資訊改為至少 12–13px，增加暖褐文字對比；不增加附件或其他服務。

## 綁定與安全

Worker 使用後端 Token 向 LINE 官方 `GET /v2/bot/info` 取得官方帳號 `basicId`，產生 LINE 官方支援的 `https://line.me/R/oaMessage/{LINE ID}/?{文字}` 連結。無須新申請 LIFF 或登入服務。如果 Token 無權限、LINE 暫時無回應或未取得識別碼，介面會提示使用原有綁定碼，不會虛構正式帳號。

QR Code 使用開源 `qrcode-generator` 在瀏覽器內產生 SVG，不經第三方 QR 網站、不上傳檔案、不使用 R2，也不把綁定碼寫入 localStorage。展示版 QR 指向保留測試網域 `example.invalid`，清楚標示無法連接學校 LINE；可用頁面的「模擬老師綁定」測試一次性碼流程。

QR Code 與連結同樣包含有效的綁定碼，只能提供給指定教師。七天期限、單次使用、資料庫 HMAC 雜湊、失敗限制、身分唯一及原有解除綁定流程不變；重新產生立即撤銷舊碼。不要把仍有效的 QR、連結或碼放進公開 GitHub、公開截圖或群組。

多筆領件與整批復原使用 D1 原子批次、版本比對及既有請求帳本；任一筆失效則不部分完成。相同請求重送不重複寫入操作。所有命令仍需後端 Session、Origin、CSRF 與角色驗證；教師產碼仍限管理員。處理領件與復原不會發送 LINE。

LINE API 回傳成功仍只顯示「已送出」，沒有新增老師已讀或保證送達的判定。文件及附件仍請使用辦公室 Email。

## 下載後要上傳哪些檔案

這是**既有完整專案的增量更新包**，不能單獨從空資料夾啟動。原專案已套用 0001、0002；本版沒有新 Migration，不用重建 D1 或重設 Secrets。

1. 先備份目前完整專案。解壓縮更新包，把其中 `src`、`worker`、`tests`、`docs` 四個資料夾合併進原專案；保留原有其他檔案，覆寫同名檔案。
2. **也要覆寫根目錄 `package.json` 與 `package-lock.json` 兩個檔案**，因為新增本機 QR 產生套件。不要只上傳元件。
3. 先依下方指令在電腦預覽。確認要更新正式網站時，才到 `npust-lc/office-line-notifier` 根目錄選 **Add file → Upload files**，拖入更新包中的四個資料夾與上述兩個檔案。不要上傳 ZIP 本身或多包一層外部資料夾。
4. **提交 GitHub `main` 會觸發既有 Cloudflare 正式部署。** 這一步須由網站擁有者確認後操作。更新包不含 `wrangler.jsonc`、環境檔、D1 ID 或 Secrets，不要覆寫或重新建立這些設定。
5. 正式部署成功後，開固定網址 `https://office-line-notifier.pages.dev/`，按 `Ctrl + Shift + R`；系統管理的介面及後端版本應同為 `2026.11.17.3`。

## Windows PowerShell 本機預覽

在原本完整專案根目錄（有 `package.json` 那一層）執行：

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24
npm.cmd ci
$env:VITE_APP_MODE = "mock"
$env:VITE_BASE_PATH = "/"
npm.cmd run dev -- --host 127.0.0.1
```

開啟終端顯示的本機網址，通常為 `http://127.0.0.1:5173/`。展示只使用虛構資料，不會連接正式 D1 或發送 LINE。按 `Ctrl + C` 停止。驗證以下指令只建置測試，不會部署：

```powershell
npm.cmd test
npm.cmd run build:cloudflare
Remove-Item Env:VITE_APP_MODE -ErrorAction SilentlyContinue
Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue
```

測試清單與結果見 [測試報告](TEST-REPORT.md)。本次 LINE HTTP 與 bot info 均為 Mock，尚未在真實手機測試預填連結、官方帳號加好友流程及正式 QR 掃描。

官方參考：[取得 Bot 資訊](https://developers.line.biz/en/reference/messaging-api/#get-bot-info)、[LINE URL scheme：開啟官方帳號並預填訊息](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/#sending-text-messages)。

# 辦公室小幫手

保留現有 React／Vite 介面，改以 **Cloudflare Workers＋D1** 處理登入、教師綁定、LINE 純文字通知與雙向聊天。正式網頁優先使用 **Cloudflare Pages Advanced Mode**：前端與 `/api/*` 在同一網域，由 Workers 執行後端，避免跨站 Cookie 問題。GitHub 繼續管理原始碼。

**目前完成本機版本，沒有建立遠端 D1、部署 Cloudflare 或使用真實 LINE 憑證。LINE HTTP 測試使用 Mock，尚未完成正式服務驗收。** 不使用檔案儲存服務；文件及附件請使用辦公室 Email 傳送。原始黑黃透明 Logo、六張卡片、系統管理配置、交接與內部備註均保留。

## 1. Windows 本機操作

安裝 [Node.js 24 LTS](https://nodejs.org/) 與 [Git for Windows](https://git-scm.com/download/win)。下列為 PowerShell 指令，先下載專案，才會有可進入的資料夾：

```powershell
cd $HOME
# 已下載者不要重複 clone，改進入實際存放位置。
git clone https://github.com/ching-yu430/office-line-notifier.git
cd .\office-line-notifier
npm ci
Copy-Item .env.example .env
npm run dev
```

瀏覽 `http://localhost:5173`。預設 `VITE_APP_MODE=mock`，只有虛構資料、瀏覽器 localStorage，沒有真實 LINE 或跨電腦共用資料。可切換模擬角色、產生綁定碼並模擬老師輸入、發送／接收文字。重設展示資料可刪除瀏覽器 `office-line-demo-v1`。

要測試 **本機 Workers＋真正的本機 SQLite／D1**，先關閉 Vite，執行：

```powershell
npm run db:migrate:local
npm run setup:local
notepad .env
```

`setup:local` 會產生 `.dev.vars` 的隨機 `AUTH_PEPPER`、`BINDING_PEPPER`，並隱藏輸入首位管理員密碼（12 至 128 字）。不輸出密碼、雜湊或金鑰。僅在沒有帳號時新增管理員，不會重跑覆寫既有帳號。後續由網頁「系統管理 → 新增行政帳號」處理。若自行複製 `.dev.vars.example`，請先補齊兩組不同的至少 32 字元安全隨機金鑰。

把 `.env` 改為：

```dotenv
VITE_APP_MODE=cloudflare
VITE_API_BASE=/api
VITE_BASE_PATH=/
```

分別開啟兩個 PowerShell 視窗，均先進入專案資料夾：

```powershell
# 視窗一：本機 API 與 D1，不需要登入 Cloudflare。
npm run dev:api
```

```powershell
# 視窗二：前端，/api/ 由 Vite 代理至 localhost:8787。
npm run dev
```

使用 `http://localhost:5173` 登入。請保持 `localhost` 一致，勿混用 `127.0.0.1`；本機 `ALLOWED_ORIGIN` 預設是 `http://localhost:5173`。本機預設 `LINE_SEND_ENABLED=false`，所以可管理教師、產碼、帳號、交接與內部備註，但不會真的推播。測試完整 LINE 收發以自動化 Mock 測試為主，不需提供任何真實 Token。

**本機 D1 與遠端 D1 是不同資料庫**。`.wrangler/` 不提交，展示資料不會自動匯入正式資料庫。

## 2. 程式位置與架構

```text
src/                       原有 React 頁面、Logo、樣式與展示模式
worker/index.ts            API 路由、Session／CSRF 驗證、資料快照
worker/auth.ts             密碼登入、HttpOnly Cookie、登入限流
worker/commands.ts         教師、綁定碼、通知、權限、交接及內部備註
worker/webhook.ts          LINE 簽章、去重、綁定、文字、撤回與非文字提示
worker/line.ts             純文字 push、固定重試鍵、發送狀態
worker/security.ts         隨機碼、HMAC、密碼雜湊與本文大小限制
migrations/0001_initial.sql D1 資料表、索引、約束及版本觸發器
wrangler.worker.jsonc      獨立 Worker／本機開發設定
wrangler.jsonc             Pages 同源正式部署設定範本
scripts/                   本機初始化及 Pages Worker 打包
tests/                    密碼學、日期、Workers／D1 與瀏覽器測試
```

目前使用記憶體頁面切換，未新增路由套件。正式 API 回傳既有 `Data` 結構，故版面及流程沿用。舊後端套件、部署設定與程式已從目前版本移除；舊版本可由 Git 歷史查閱。

詳細資料表、角色與 API 見 [架構文件](docs/ARCHITECTURE.md)。維護、額度、備份及還原見 [維運文件](docs/OPERATIONS.md)。

## 3. 已實作的行為

- 管理員／行政人員獨立帳號；密碼有隨機鹽及後端 pepper；8 小時 Session，HttpOnly、SameSite Cookie、正式 Secure、CSRF 驗證、來源限制、停用／重設密碼撤銷 Session。
- 一般行政可通知、聊天、更新狀態、交接及寫內部備註；教師名單寫入、綁定及帳號管理需管理員。每個 API 都由後端確認有效帳號及角色，不能用展示用按鈕取得正式權限。
- 綁定碼為 12 字元、60 bits 安全隨機值，只顯示一次；資料庫只有 HMAC-SHA256，預設 7 天失效。每個 LINE 身分每小時最多 10 次未綁定嘗試，全域每小時 1,000 次。重發碼立即使舊碼失效。
- LINE User ID 唯一約束、一位教師一組身分、原子批次綁定／碼失效／稽核。解除綁定撤銷碼與尚未發送的通知；重新綁定須先解除。
- 包裹、實體信件、行政聯絡、自訂及聊天回覆皆為文字。每批最多 100 位，逐一私訊；每次操作最多處理前 5 筆，其他在紀錄顯示「待發送」可逐筆處理。不是 LINE 群組通知。
- API 已接受、待發送、傳送中、失敗、結果未明分開記錄；固定請求識別碼及 LINE retry key 防止重複。逾時／5xx 不自動重送；HTTP 成功不代表送達或已讀。
- 簽章驗證通過才處理 Webhook；事件 ID 與 LINE 訊息 ID 去重；支援訊息撤回及先撤回後收到原訊息；原身分解除後仍可撤回其舊訊息。
- 已綁教師的新文字存入 D1，對話標記待回覆。訊息中心每 15 秒輪詢；隱藏分頁暫停，失敗退避至 60 秒。資料未變時以 ETag 回 304。
- 圖片、檔案、語音等只記錄不支援的類型和 Email 提示；不下載附件、不儲存檔名或內容、不建立下載連結。介面沒有附件上傳操作。
- 交接人及完成人可手動填寫，實際操作帳號另行記錄；更正、恢復及版本衝突保護仍保留。內部備註不呼叫 LINE。
- 最近操作／交接紀錄保留獨立日期篩選、每頁 5 筆、固定高度與收合。

## 4. 自動化測試與編譯

```powershell
npm test
npm run build:cloudflare
# Windows 首次測試瀏覽器：
npx playwright install chromium
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())"
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_CHROMIUM_EXECUTABLE
```

`build:cloudflare` 固定建置正式 Cloudflare 模式，`pages:prepare` 固定建置舊 GitHub 展示模式，兩者只產生成品、不會部署。完成本機初始化後，也可執行 `npm run build:cloudflare` 再 `npm run preview:cloudflare`，在 `http://localhost:8788` 預覽 Pages 同源成品。

Miniflare／workerd 執行真正的本機 D1 Migration、HTTP、Cookie、Session、簽章、綁定及通知；只有 LINE 外部 HTTP 用 Mock。另有瀏覽器測試確認正式模式登入、Webhook → D1 → 輪詢顯示、登出，以及原版展示操作與手機版面。測試帳號密碼、pepper、Token 都在執行時隨機產生，沒有真實教師或憑證。

測試結果與正式未驗證範圍見 [測試報告](docs/TEST-REPORT.md)。不應把本機測試通過宣稱為真實 LINE 串接完成。

## 5. Cloudflare Pages＋D1 部署準備

**以下會建立或變更遠端服務，須取得專案擁有者確認後再執行；本次未代為執行。**

1. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) 建立帳號。若採 Git 自動建置，先決定正式／測試分支；不要讓尚未核准的提交自動部署。
2. 在 PowerShell 登入並建立專用 D1：

   ```powershell
   npx wrangler login
   npx wrangler d1 create office-line-notifier
   ```

3. 將 Cloudflare 回傳的真實 `database_id` 填入 `wrangler.jsonc` 和 `wrangler.worker.jsonc` 的 `d1_databases`，不可使用範本的全零值。將 `wrangler.jsonc` 的 `ALLOWED_ORIGIN` 改為實際 HTTPS 正式網域，`COOKIE_SECURE=true`、`LINE_SEND_ENABLED=false`。
4. 套用遠端 Migration：

   ```powershell
   npx wrangler d1 migrations apply office-line-notifier --remote
   ```

5. Dashboard → Workers & Pages → Create → Pages → Connect to Git，選擇 `ching-yu430/office-line-notifier`。建置命令 `npm run build:cloudflare`，輸出 `dist`，環境變數 `NODE_VERSION=24`、`VITE_APP_MODE=cloudflare`、`VITE_API_BASE=/api`、`VITE_BASE_PATH=/`。產物包含 `_worker.js` 與 `_routes.json`，僅 `/api/*` 進入 Workers。
6. Pages 專案 → Settings → Bindings 設定 **D1，名稱必須是 `DB`**，連到剛建立的資料庫。設定 `ALLOWED_ORIGIN`、`COOKIE_SECURE=true`、`LINE_SEND_ENABLED=false`。專案根目錄 `wrangler.jsonc` 是 Pages 的正式設定來源，D1 ID、vars 與 Dashboard 顯示必須一致；Secrets 僅由 Dashboard／CLI 管理，不寫進設定檔。**不要把正式資料庫綁定給未受信任的預覽部署**；預覽應使用獨立測試 D1，或停用該分支部署。
7. Pages Settings → Variables and Secrets，將以下四項設為 **Secret／加密值**：

   | Secret | 來源 |
   | --- | --- |
   | `AUTH_PEPPER` | 伺服器安全隨機值，至少 32 字元，與初始管理員雜湊所用值一致 |
   | `BINDING_PEPPER` | 另一組安全隨機值，至少 32 字元 |
   | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers 的 Messaging API Channel |
   | `LINE_CHANNEL_SECRET` | 同一 LINE Channel 的 Basic settings |

   不得加上 `VITE_` 前綴，不放 GitHub 原始碼、PowerShell 命令列或聊天。CLI 亦可互動輸入，請逐項執行，不把值當參數：

   ```powershell
   npx wrangler pages secret put AUTH_PEPPER --project-name office-line-notifier
   npx wrangler pages secret put BINDING_PEPPER --project-name office-line-notifier
   npx wrangler pages secret put LINE_CHANNEL_ACCESS_TOKEN --project-name office-line-notifier
   npx wrangler pages secret put LINE_CHANNEL_SECRET --project-name office-line-notifier
   ```

8. 首位正式管理員：在受控電腦執行 `node scripts/setup-local.mjs --sql-only`。它使用 `.dev.vars` 的 `AUTH_PEPPER` 產生 `.local/bootstrap-admin.sql`；**請將相同 AUTH_PEPPER 透過 Secret 安全設定到正式環境，不要顯示在終端機**。確認正式 D1 尚無帳號後才匯入，完成即刪除：

   ```powershell
   npx wrangler d1 execute office-line-notifier --remote --file .local/bootstrap-admin.sql
   Remove-Item .local/bootstrap-admin.sql
   ```

   不把本機完整資料庫匯到正式環境。工具只會新增第一個帳號，後續一律在網頁新增；若已有帳號而忘記密碼，請依維運文件處理。

9. Secrets／Bindings 更動後重新部署核對。測試分支使用另一套 D1、Secrets、LINE 測試官方帳號。完成後再開正式分支自動部署。若不用 Git 整合，可經確認後手動 `npx wrangler pages deploy dist`；先執行 `npm run build:cloudflare`，不可把一般 `npm run build` 的展示成品當正式版。

Pages Advanced Mode 已使用 Workers 執行 API，不需要再部署第二個 API 網域。獨立 `wrangler.worker.jsonc` 留作本機或另有部署需求時使用；**禁止直接以範本的 `COOKIE_SECURE=false` 公開部署**。若將 Pages 和獨立 Worker 分離，需額外處理同站自訂網域、Cookie 與 CSP，這不是本專案預設部署流程。

## 6. LINE 官方帳號設定

1. 至 [LINE Official Account Manager](https://manager.line.biz/) 建立或選取學校授權的官方帳號；官方帳號建立與驗證條件由 LINE 決定，本系統不能繞過 LINE 申請要求。
2. 開啟 Messaging API，至 [LINE Developers Console](https://developers.line.biz/console/) 找到同一個 Provider／Messaging API Channel。
3. 取得 Channel access token 與 Channel secret，依上節放入 Cloudflare Secrets。
4. **取得真實測試確認後**，設定 Webhook URL：`https://實際正式網域/api/line/webhook`。按 Verify，空事件應回 200，開啟 Use webhook 與 Webhook redelivery。關閉容易造成重複回覆的預設自動回應，歡迎訊息由辦公室決定是否關閉。設定 Webhook 後，綁定及加入好友回覆會使用 reply API；`LINE_SEND_ENABLED` 只控制行政主動 push，不代表 Webhook 不會回覆。
5. 用授權測試人員先完成產碼、加入好友、輸入碼、成功回覆、網頁綁定更新；再由老師帳號傳文字，確認 15 秒左右出現在訊息中心。
6. 開啟 `LINE_SEND_ENABLED=true` 前再取得確認；只選授權測試帳號測試 push、回覆、撤回、附件提示與失敗狀態，最後才納入真實教師。

**需要您準備的是 Cloudflare 帳號／D1 ID／實際 Pages 網址、LINE 官方帳號及兩個 LINE Secrets；不需要把密碼或 Token 貼給我。**

## 7. 目前限制

- 未在 Cloudflare 遠端或真實 LINE 驗證，免費方案的實際 CPU、流量與 D1 用量仍須用測試服務確認。密碼成本及限流設計見維運文件；不可為了省成本改成明文或快速單次 SHA 雜湊密碼。
- 前端快照載入最近 500 筆通知／訊息／備註／操作／修改紀錄，教師與交接最多 1,000 筆；舊資料仍保存在 D1，不會自動刪除。現有日期篩選只篩已載入資料。更早紀錄由授權維護者匯出查詢；若要在網頁翻閱完整歷史，需再加伺服器分頁查詢。
- 不提供已讀、送達保證、群組聊天、附件收發、Email 寄件或自動重送不明結果。附件提示不是自動寄 Email，需自行在辦公室 Email 處理。
- 同一包 Webhook 若需要超過 40 次自動回覆，優先綁定成功回覆，其餘標記 `reply_skipped_limit`；所有事件／訊息／綁定仍完整寫入。此限制用來保留免費 Worker 的呼叫空間；維護者可查失敗／略過回覆，但不能重用已過期 reply token。
- 不會把既有 GitHub Pages 改成正式系統，也不會把真實教師資料放進公開展示資料。

官方文件：[Pages Advanced Mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)、[D1 Binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/)。

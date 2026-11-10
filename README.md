# 辦公室 LINE 行政通知與教師身分綁定系統

供學校辦公室使用的繁體中文 React + Vite 應用。教師沿用 LINE 收發訊息；行政人員在網頁工作，不必另外登入 LINE 官方帳號管理後台。

**目前交付：可操作的本機模擬版本、正式 Supabase 整合程式、SQL Migration、Edge Functions、自動化測試。尚未連接真實 LINE／Supabase，未公開部署、未傳送任何真實通知。**

## 1. 立即在 Windows 試用

安裝 [Node.js 24 LTS](https://nodejs.org/)，解壓縮或開啟專案後，在 PowerShell 執行：

```powershell
Set-Location .\office-line-notifier
npm ci
Copy-Item .env.example .env
npm run dev
```

瀏覽 `http://localhost:5173`。預設 `VITE_APP_MODE=mock`，免登入且每頁標示模擬模式。教師為虛構資料，變更保存在此瀏覽器 localStorage；不會呼叫 LINE，也不會存入 Supabase。切換為一般行政人員可檢查介面權限，但這只是模擬，正式權限由資料庫驗證。

建議操作：

1. 教師名單 → 找「示範教師乙」→ 產生綁定碼。新碼只顯示一次，舊碼立即失效。
2. 將碼貼入頁面下方「教師端模擬測試」，按「模擬老師綁定」。教師狀態變更為已綁定。
3. 發送通知 → 勾選教師 → 選包裹通知 → 預覽 → 確認。
4. 訊息中心 → 選教師 → 頁面底部輸入模擬老師回覆 → 模擬接收。訊息立即顯示在對話中。
5. 輸入辦公室回覆，確認預覽；至通知紀錄更新待領取／待回覆／已完成。
6. 系統管理可調整範本、查看稽核與模擬帳號權限。

模擬綁定碼僅保存在記憶體，重新整理後失效；正式碼只在後端保存 HMAC。要重設示範資料，在瀏覽器開發工具刪除 localStorage 的 `office-line-demo-v1`，再重新整理。**模擬模式不適合輸入真實個資，也不代表真正驗證了 LINE 使用者身分。**

## 2. 專案結構與階段

```text
src/                         六個頁面、Auth、Realtime 與模擬介面
supabase/migrations/          完整資料庫、RLS、交易式 RPC
supabase/functions/admin-api/ 登入與行政操作、Messaging API push
supabase/functions/line-webhook/ 簽章驗證、去重、綁定與接收
supabase/functions/_shared/  密碼學與 LINE API 共用程式
tests/                       安全及 PostgreSQL 測試、瀏覽器操作測試
docs/ARCHITECTURE.md          架構、威脅與資料流
docs/OPERATIONS.md            備份、還原、故障及額度處理
docs/TEST-REPORT.md           實測結果及未驗證項目
.github/workflows/           自動測試、手動核准的 Pages 工作流程
```

| 階段 | 本次完成 | 驗證狀態 |
| --- | --- | --- |
| 一、身分綁定 | 教師增修停用、七天一次性碼、HMAC、交易鎖、唯一約束、限流、解除綁定與稽核 | PostgreSQL／模擬 UI 已測試；需真實 LINE 驗收 |
| 二、行政通知 | 範本、多人私訊、重要標記、預覽確認、防重複、逐筆結果、通知紀錄 | 本機資料庫與模擬流程已測試 |
| 三、雙向聊天 | Webhook 接收文字、收回訊息、事件去重、Realtime 訂閱、網頁回覆、對話結案 | 模擬 UI／事件處理已測試；真實 Realtime 與 LINE 尚未實測 |
| 四、行政管理 | Auth、管理員／行政角色、後端權限、帳號停用、篩選、經辦／完成時間、系統狀態 | RLS 與交易檢查已測試 |

LINE 群組聊天室、圖片／附件下載、排程大量派送與完整分頁列為後續擴充。目前「多選教師」是逐一發送個別私訊，不是 LINE 群組通知。Webhook 對 group／room 事件直接略過，不會用群組成員身分綁定教師。

## 3. 建立 Supabase（先使用測試專案）

前往 [Supabase Dashboard](https://supabase.com/dashboard) 建立專用專案。不要提供密碼或私密金鑰到聊天中。

需要的資訊：

- 專案網址：Project Settings → API／Data API。
- Publishable Key（可公開）：Project Settings → API Keys。
- 專案 Reference ID：Project Settings → General。
- Service Role Key：只用於 Supabase Functions 的內建後端環境，絕不能填入 `VITE_` 變數或 GitHub Pages。

先閱讀目前安裝 CLI 的說明，再登入與連結自己建立的測試專案：

```powershell
npx supabase --help
npx supabase login --help
npx supabase login
npx supabase link --help
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --help
npx supabase db push --dry-run
# 確認連結正確、僅套用本專案 Migration 後執行
npx supabase db push
```

這些命令會修改您選定的 Supabase 專案；本次開發未替您執行遠端操作。新建 schema 需透過 CLI 正式建立 Migration；後續不要改寫已套用的 Migration。

### 初始管理員

Dashboard → Authentication → Users → Add user，建立自己的測試行政帳號；確認電子郵件，使用獨立強密碼。正式環境關閉公開註冊與匿名登入，管理員由 Dashboard 建立／邀請。取得該帳號實際 User UID，再於 SQL Editor 執行下列 SQL，先替換所有占位文字：

```sql
insert into public.staff(id, display_name, role, active)
values ('請替換成實際_AUTH_USER_UUID'::uuid, '辦公室管理員', 'admin', true);
```

此 SQL 必須由專案管理者執行；網頁不能將自己提升為管理員。後續由管理員在系統管理輸入已建立的 Auth User UID 授權其他帳號。使用者不能修改自己的權限，避免鎖死最後的管理員。

Migration 已對前端明確授予 SELECT 並啟用 RLS。所有寫入經過 Edge Functions 與僅 `service_role` 可執行的 RPC。Data API 只暴露 public，**不要加入 private schema**。確認 Database → Publications → `supabase_realtime` 包含 teachers、notifications、messages、conversations；Migration 已加入。

```powershell
npx supabase db --help
npx supabase db advisors --help
# 依您安裝版本的說明執行已連結專案的 advisors，修正部署環境警告
```

本機測試使用 PGlite，並未替遠端專案執行 Supabase Advisors。

## 4. 建立 LINE 官方帳號與 Messaging API

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 建立學校辦公室的官方帳號。
2. 在官方帳號設定啟用 Messaging API，選擇／建立學校的 Provider。
3. 到 [LINE Developers Console](https://developers.line.biz/console/) 選該 Messaging API Channel。
4. Basic settings 取得 **Channel Secret**；Messaging API 分頁發行 **Channel Access Token**。只有學校授權管理者可接觸這些值。
5. Messaging API 分頁的 QR Code／加好友連結供測試老師加入。前端不虛構 QR Code，請使用官方提供的內容。
6. 設定 Webhook URL（完成後端部署後才有）：`https://YOUR_PROJECT_REF.supabase.co/functions/v1/line-webhook`，開啟 Use webhook 及 Webhook redelivery。
7. 關閉不需要的預設歡迎訊息與自動回應，避免與本系統回覆重複。按 Verify 測試；空事件會回 200。

使用 **Messaging API**，完全沒有使用已停用的 LINE Notify。

### 設定後端 Secrets

Supabase Dashboard → Edge Functions → Secrets，填入下列值；請勿貼在聊天或終端指令參數中：

| 名稱 | 內容 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers 發行的真實 Channel Access Token |
| `LINE_CHANNEL_SECRET` | 該 Channel 的 Secret |
| `BINDING_PEPPER` | 以密碼管理器產生至少 32 字元的安全隨機值，建議 32 個隨機位元組以上 |
| `ALLOWED_ORIGIN` | 測試時 `http://localhost:5173`；正式為 `https://YOUR_ACCOUNT.github.io`（不含路徑與尾斜線） |
| `LINE_SEND_ENABLED` | 起初 `false`，完成測試並經您核准後才設為 `true` |

`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 是 hosted Edge Functions 的平台內建變數，不能放進前端。`.env.functions.example` 僅為名稱範本，不含 Secrets。輪替 Pepper 會讓既有未使用綁定碼失效，但不影響已綁定教師。

本機要產生 Pepper 可在 PowerShell 使用下列程式，不會輸出秘密到終端，而是直接放剪貼簿；貼入 Supabase Secrets 後清除剪貼簿：

```powershell
$bindingBytes = New-Object byte[] 32
$bindingRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bindingRng.GetBytes($bindingBytes)
[Convert]::ToBase64String($bindingBytes) | Set-Clipboard
$bindingRng.Dispose()
# 貼入 Dashboard 的 BINDING_PEPPER 後
Set-Clipboard -Value ''
Remove-Variable bindingBytes
```

### 部署測試後端（需您自行執行／另行授權）

```powershell
npx supabase functions deploy --help
npx supabase functions deploy admin-api
npx supabase functions deploy line-webhook
```

`config.toml` 的兩個函式均設定 `verify_jwt=false`，原因不同：Webhook 使用 LINE HMAC；admin-api 明確以 `auth.getUser(bearer)` 向 Supabase Auth 驗證 JWT，並查詢當下有效的 `staff` 角色，SQL 交易再驗證一次。**admin-api 仍然強制登入；切勿刪除函式內的驗證。** 這也相容新 publishable keys 與不同 JWT 簽章方式。

## 5. 前端連接正式服務

編輯本機 `.env`，只填公開值：

```dotenv
VITE_APP_MODE=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_BASE_PATH=/office-line-notifier/
```

重啟 `npm run dev`。使用已授權的測試行政帳號登入。Supabase Auth → URL Configuration 設定您實際使用的網址與必要的 Redirect URLs；本版使用電子郵件密碼登入，不依賴 LINE Login。

**綁定碼屬於身分憑證**：管理員必須透過當面、學校內部信箱等可信管道交給指定老師。持有碼者就能完成該教師的綁定；系統無法自行證明持碼者就是教師本人。切勿將綁定碼放在公開教師名單、公開文件或群組公告中。每碼 12 碼、60 bits 隨機熵，預設七天；管理員解除後需重新發碼。

## 6. 測試

```powershell
npm test
npm run build
# 若已安裝 Deno，也可檢查後端型別（本次已通過）
deno check supabase/functions/admin-api/index.ts supabase/functions/line-webhook/index.ts
# Windows：Playwright 使用自行安裝的 Chromium 路徑
npx playwright install chromium
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = node -e "const {chromium}=require('@playwright/test');process.stdout.write(chromium.executablePath())"
npm run test:e2e
```

測試資料全是虛構的。資料庫測試在 PGlite 真實 PostgreSQL 引擎執行 Migration、RLS 與 PL/pgSQL，不會連到遠端。簽章測試使用測試用 key，不包含 LINE Secrets。瀏覽器測試使用 mock，未測真正 LINE HTTP 或真實 Supabase Realtime。詳見 [測試報告](docs/TEST-REPORT.md)。

### 真實服務驗收（僅測試帳號，先取得學校同意）

- 先保持 `LINE_SEND_ENABLED=false`，LINE 測試帳號掃官方 QR、輸入碼，確認只綁對指定教師且網頁自動更新。
- 測試錯碼、過期／重新產生碼、已使用碼、另一個 LINE 帳號重用、同 LINE 嘗試綁另一教師、解除再綁定。
- 測試老師文字回覆／收回、Webhook 重送、一般行政不能呼叫綁定與權限 API、陌生 Auth 帳號看不到資料。
- 用兩個瀏覽器登入驗證 Realtime，測試斷線恢復；簽章偽造應 401，非法本文應 400，資料庫暫時失敗應 500 讓 LINE 重送。
- 經您確認後，才將測試專案 `LINE_SEND_ENABLED=true`，只對授權測試帳號發送並核對逐筆結果與額度。
- 應另以完整 Supabase Postgres 測試真正多連線同時綁定、Webhook gateway、RLS 與 Realtime 發布；PGlite 單程序測試不能替代此驗收。

## 7. GitHub Pages（尚未上線）

展示版本以 mock 模式發布至 GitHub Pages，僅包含虛構資料，尚未連接真實 LINE 或 Supabase。`.github/workflows/ci.yml` 只測試，`pages.yml` **只能手動執行**，預設 mock 模式，且需輸入「確認公開」；不因 push 自動上線。

您核准後，建立儲存庫，把專案內容放在儲存庫根目錄（不是包在第二層 office-line-notifier），上傳前核對 `.gitignore` 與 `git diff --cached`，不得包含 `.env`、資料匯出或個資。GitHub Pages 前端程式本來就能被下載，安全依賴後端驗證與 RLS。

Repository Settings → Pages → Source 選 GitHub Actions；Settings → Secrets and variables → Actions → Variables 建立：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_BASE_PATH`：通常 `/office-line-notifier/`，若儲存庫名稱不同需改為對應路徑，根網域站點用 `/`。

到 Environments → `github-pages` 設定 Required reviewers；手動執行發布流程前請再檢查原始碼與測試報告。**LINE Token、Channel Secret、Service Role Key 都不應存入此前端發布流程。**

## 8. 已知限制與後續

- 尚未實際部署 Supabase／LINE／GitHub Pages；正式服務的簽章、網路、Auth Gateway、Realtime 與 quota 需整合驗收。
- 目前載入最新 500 筆訊息／通知、1000 位教師；頁面上的日期篩選僅針對已載入紀錄。大量歷史資料請增加伺服器分頁或授權匯出。
- 每批最多 100 位，每行政帳號每分鐘最多建立 100 則。為避免 Edge 執行逾時，一次請求只立即處理前 5 筆，其餘保持 `queued`，在紀錄逐筆按「處理待發送」。大量發送建議第二階段加 Queue／排程 worker。
- `sending` 中斷、timeout 或 LINE 5xx 會視為結果未明，不能盲目重送。維護者需核對後處理，詳見 [維護手冊](docs/OPERATIONS.md)。
- LINE 只提供 API 接受結果，私訊不能取得可靠的已讀／實際送達回條。封鎖好友可能仍回 API 接受。
- 無附件儲存、群組發送、已讀標記、SMS 備援、自動到期提醒或完整資料匯出 UI。
- 支援文字收回；若訊息早於收回事件而頁面已呈現，不能保證行政人員未看見。收回後系統替換正文，備份仍依留存政策處理。

完整架構見 [ARCHITECTURE](docs/ARCHITECTURE.md)，備份與錯誤處理見 [OPERATIONS](docs/OPERATIONS.md)。

## GitHub Pages 分支發布

目前展示頁使用 main 分支根目錄發布。根目錄的 index.html、assets/ 與 .nojekyll 為編譯產物，請勿直接編輯；React 入口是 src/index.html。更新展示版時，先執行 `npm run pages:prepare`，測試後一併提交產物。也可在 Pages 設定改選 GitHub Actions，沿用手動發布工作流程。正式整合前請保持 mock 模式。

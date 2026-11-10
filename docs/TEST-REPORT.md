# 測試報告

測試日期：2026-11-10（台灣時間）。測試環境：Linux、Node.js 24.22.1、固定版本 npm 套件；Windows PowerShell 指令已提供，尚未於實體 Windows 測試。

## 結果

| 項目 | 結果 | 範圍 |
| --- | --- | --- |
| `npm test` | 30 / 30 通過 | 4 項密碼學、16 項 PGlite PostgreSQL、10 項 Edge HTTP mock |
| `npm run test:e2e` | 3 / 3 通過 | Chromium 桌機完整流程、行政角色限制、390px 手機版 |
| `deno check`（Deno 2.9.6） | 通過 | admin-api 與 line-webhook 的實際 Deno 型別檢查 |
| `npm run build` | 通過 | TypeScript 前端與測試型別、Vite 正式靜態輸出 |
| `npm audit --omit=dev --audit-level=high` | 通過，0 vulnerabilities | 當次 npm 公告資料庫中正式依賴 |
| 桌機版面檢視 | 通過 | 1440px 總覽截圖檢查 |

Vite 會對 lucide-react 的 `use client` directive 顯示提示；此應用為純瀏覽器 React，建置仍成功。測試與截圖只使用虛構資料，沒有外部個資。

## 已實測的行為

- 隨機碼格式與唯一性樣本、HMAC 正規化／金鑰差異、原始本文 HMAC 簽章、本文竄改、損壞 base64、非法 JSON／事件格式。
- 有效碼、七天到期條件、舊碼替換、使用後刪碼、重複綁定、同 LINE 多教師限制、錯誤次數限制、停用教師。
- 行政角色／未知帳號／停用帳號拒絕、RLS 讀取範圍、前端不可寫資料／讀私有身分／呼叫服務 RPC。
- 事件去重、群組略過、收回事件逆序、換綁後的延遲訊息略過、解除後仍正確收回原對話。
- 整批發送條件與 rollback、相同 request 去重、claim row lock／單次領取、發送中禁止解除、API 接受與結案經辦保存。
- HTTP 401／403、Secrets 未允許真實發送時 409、只將碼雜湊傳進資料庫。
- Webhook 無效簽章 401、格式錯誤 400、空事件 200、DB 失敗 500、重複事件不回覆、LINE 回覆失敗保留成功綁定、push 逾時標記 uncertain 與固定 retry key。
- 模擬 UI 實際完成：教師產碼→老師綁定→包裹通知預覽與確認→接收老師回覆→網頁回覆→更新完成。一般行政無綁定管理按鈕；手機主要頁面無整頁水平溢出。

## 驗證界線

PGlite 執行的是 PostgreSQL 引擎與實際 Migration／RLS／PL/pgSQL，並非以陣列取代資料庫。它仍是單程序測試，沒有驗證多程序連線競爭或 Supabase 的完整 gateway／Auth／Realtime 服務。唯一約束、資料列鎖與交易 advisory lock 已實作；上線前仍需在測試 Supabase 專案做併發驗收。

Edge HTTP 測試以相同 handler 程式執行，但 Auth、Postgres 遠端呼叫、LINE HTTP 回應使用 Mock。瀏覽器測試使用明確標示的 mock 模式。**沒有使用真正 Channel Secret／Access Token、沒有以真實 LINE 帳號驗證簽章與回覆，也沒有驗證實際 Realtime 訊息投遞。**

未執行公開部署、GitHub 推送、LINE 真實通知或遠端資料庫變更。Supabase Advisors 尚未對任何遠端專案執行。正式驗收項目與所需資訊見 README。

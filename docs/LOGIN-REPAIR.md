# 登入相容性修復

Cloudflare 正式環境限制單次 PBKDF2 最多 100,000 次；本機 Node／workerd 可執行 600,000 次，不能據此推論正式可用。原版較高成本可能造成登入回 500。修正版採 100,000 次、每帳號隨機鹽、原有後端 pepper 與登入限流，低於一般 OWASP 的 600,000 次建議，不宣稱強度相同。

已存在的 600,000 次雜湊不能直接修改數字；須由原始密碼重新產生。這是持有 D1 管理權限者的維護操作，沒有新增公開重設密碼 API。

## 修正包與檔案

修正包只包含 `worker`、`scripts`、`tests`、`docs` 四個資料夾，不含 `wrangler.jsonc`、`.dev.vars`、教師資料、密碼或安全金鑰。將四個資料夾複製到原本包含 `package.json` 和 `.dev.vars` 的專案資料夾，選擇取代同名檔案。不要以新空白專案取代原有 `.dev.vars`。

## 重新產生指定管理員密碼雜湊

在原本專案資料夾開啟 PowerShell；若是新視窗，先載入 fnm：

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24
node .\scripts\repair-password.mjs
```

輸入辦公室網站的原管理員登入帳號及想使用的密碼（可沿用原密碼），密碼輸入兩次且不顯示。工具只讀取原 `.dev.vars` 的 `AUTH_PEPPER`，不會覆寫或產生金鑰，也不會連線遠端。成功後建立 `.local/repair-admin-password.sql`，只有安全雜湊，沒有明文密碼或 pepper。

確認目標是原本 D1 並由帳號擁有者執行：

```powershell
npx.cmd wrangler d1 execute office-line-notifier --remote --file .local/repair-admin-password.sql
```

此 SQL 只更新同名且啟用中的管理員：帳號 ID、顯示名稱、角色、教師、綁定、通知均保留；該管理員舊 Session 撤銷，帳號的登入限流桶清除，新增 `password_repair` 稽核。若帳號拼錯或不是啟用管理員，沒有帳號會被建立或更新，請核對輸入後重試。確認執行成功後刪除：

```powershell
Remove-Item .\.local\repair-admin-password.sql
```

## 上傳與驗收

在 GitHub 儲存庫選 Add file → Upload files，僅上傳修正包內四個資料夾 `worker`、`scripts`、`tests`、`docs`。不要上傳整個本機專案，避免帶入 `.dev.vars`、`.local` 或舊的部署設定。

提交後等待 Pages 自動部署，重新整理正式網站，以剛才的管理員帳密登入。Production Secrets 的 `AUTH_PEPPER` 必須與原 `.dev.vars` 完全相同。

- `登入密碼格式需要更新`：仍有啟用帳號使用舊雜湊，請依序由維護者處理。
- `帳號或密碼錯誤`：核對登入帳號、剛輸入的密碼，以及 Production 的 AUTH_PEPPER，勿將值貼到聊天或 GitHub。
- `資料庫資料表尚未建立或版本不符`：檢查 Pages 的 `DB` Binding 與 Migration。
- `後端尚未設定登入金鑰`：Production Secret 未設定或尚未重新部署。

修正不會啟用 LINE 發送，也沒有變更網站版面。實際線上登入仍需儲存庫擁有者部署後驗收。

參考：[Cloudflare workerd 上限追蹤](https://github.com/cloudflare/workerd/issues/1346)。

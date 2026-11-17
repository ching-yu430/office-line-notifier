> 本文件是前次更新說明。目前版本已改為直接回覆、不再勾選完成，並需要 0002 資料庫更新；請依 [共同值班操作更新](USABILITY-UPDATE.md) 操作。

# 回覆流程更新與安裝

## 這次的調整

1. 訊息中心預設勾選「回覆後完成對話」，回覆送出後自動完成對話。取消勾選可保留待回覆。
2. 新訊息到達時重新列為待回覆。預覽後或發送期間的新訊息不會被前一則回覆誤結案。
3. 發送失敗或結果未明不完成對話、不清空草稿；可在通知紀錄查看錯誤碼。
4. 回覆本身記錄完成時間與原發送者。其他通知與包裹／信件領取狀態保持原樣。
5. 聊天、發送結果、操作紀錄統一顯示「已送出」，移除反覆出現的 API 與非已讀文字。

## 上傳方式

這是更新包，包含 `src`、`worker`、`tests`、`docs` 四個資料夾中的變更檔案。它不是整套專案。

1. 解壓縮更新包。
2. 將這四個資料夾合併到原專案根目錄（有 `package.json` 的位置），覆寫同名檔案，其餘原檔案保留。
3. 在 GitHub `npust-lc/office-line-notifier` 根目錄選擇 **Add file → Upload files**，拖入解壓後的四個資料夾，確認待上傳路徑是 `src/...`、`worker/...`、`tests/...`、`docs/...`，再提交。
4. GitHub 提交會觸發已連接的 Cloudflare Pages 部署；準備更新正式網站時才提交至 `main`。
5. 等正式部署成功後重新整理網站。若仍顯示舊文字，在 Windows Chrome 按 `Ctrl + Shift + R`。

本次不需要修改 D1、不需要重設密碼、不需要重新綁定教師，也不需要改動 Secrets。更新包不包含 `wrangler.jsonc`、環境變數、Secrets、帳密或個資。

## Windows PowerShell 本機驗證（選用）

在原專案資料夾開啟 PowerShell，既有 Node／fnm 設定完成後執行：

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:cloudflare
```

`build:cloudflare` 只建立成品，不會自行部署或發送 LINE。不要把 `.dev.vars`、`.env`、`.local` 或 `node_modules` 上傳至 GitHub。

## 已讀說明

LINE Messaging API 無法回報個別老師是否已讀辦公室發出的訊息。老師傳來的訊息則可使用另一個 API 標記已讀；這個更新包尚未加入該功能，網頁開啟對話不會同步 LINE 的已讀。

參考：[個別已讀限制](https://developers.line.biz/en/faq/)、[將老師訊息標記已讀](https://developers.line.biz/en/docs/messaging-api/mark-as-read/)。

## 驗收

僅使用自己綁定的測試教師，不使用真實教師名單。

1. 從自己的 LINE 傳文字，確認網站出現待回覆。
2. 保持勾選「回覆後完成對話」並回覆，確認 LINE 收到且對話變成已完成。
3. LINE 再傳一則文字，確認回到待回覆；取消勾選後回覆，應繼續保留待回覆。
4. 確認既有包裹仍是待領取，發送結果顯示「已送出」。
5. 重新整理確認狀態保留。

以上真實驗收需由使用者更新網站後操作；開發測試使用 Mock LINE HTTP，不會對外發送。

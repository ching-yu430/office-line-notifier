# 辦公室小幫手：2026.11.19.1

本包整合先前尚未上傳的修改。原始透明黑黃 Logo、暖黃色風格、教師綁定、文字通知、訊息中心、交接與領件功能均保留。沒有公開部署、修改遠端 D1、清理真實資料或發送真實 LINE。

[下載 HTML 預覽包](office-line-notifier-html-preview.zip) · [下載整合更新包](office-line-notifier-combined-update.zip) · [更新與 Windows 指令](docs/CONVERSATION-UPDATE.md) · [紀錄備份說明](docs/RECORD-BACKUP.md) · [安全檢查報告](docs/SECURITY-REVIEW-2026-11-18.md) · [測試結果](docs/TEST-REPORT.md)

## 先開 HTML 試用

解壓 HTML 預覽包，用 Windows Chrome 開啟 **office-line-notifier-preview.html**。所有資料皆為虛構，不會連接正式 API 或發送 LINE。可直接到 **系統管理 → 資料維護 → 紀錄備份 → 下載 ZIP 備份**，實際產生一份虛構行政紀錄 ZIP。

圖片、樣式及程式均已內嵌，不必安裝 Node 或先上傳。不要把這份預覽 HTML 覆寫為正式網站的 index.html。開發環境的受管理瀏覽器限制 file://，自動化使用同一份成品載入測試；Windows Chrome 直接開檔與原生資料夾授權仍須你試用驗收。

## 系統管理改為三個分類頁籤

主要卡片直接顯示，取消每張卡片各自收合；保留原本暖黃色、透明 Logo 與操作功能。手機改為單欄，桌面使用對齊的兩欄卡片。

- **一般設定**：上方 LINE 與系統狀態、行政帳號並排；下方通知範本以兩欄排列。
- **操作紀錄**：最近操作、最近交接並排，統一標題、篩選、固定高度與分頁。保留獨立日期、搜尋及每頁五筆。
- **資料維護**：紀錄備份、紀錄清理並排直接操作，長內容在卡片內捲動。

分類與查詢條件在本次登入保留，也支援方向鍵、Home、End。只有輔助性的維護資訊保留小型展開區。自動備份不必停留在此分類。

![一般設定](preview-settings.png)

![操作紀錄](preview-settings-records.png)

![資料維護](preview-settings-maintenance.png)

[手機一般設定](preview-settings-mobile.png) · [手機操作紀錄](preview-settings-records-mobile.png) · [手機資料維護](preview-settings-maintenance-mobile.png)

## 網頁直接下載紀錄 ZIP

管理員可下載完整行政紀錄，不受畫面最近 500 筆限制。ZIP 內含原文 JSON、安全 CSV、筆數與 SHA-256 檢查碼；資料變更或筆數不完整時不會提供部分備份。排除帳密、Session、LINE 憑證、LINE User ID 與綁定碼；這是行政紀錄備份，完整系統復原仍需 D1 SQL 備份及後端 Secrets。

[查看手機版資料維護](preview-settings-maintenance-mobile.png)

可選擇電腦資料夾，設定每 **1／7／30 天**自動備份，預設關閉。需要網頁開啟、管理員仍登入及瀏覽器授權；背景分頁回前景後補做。**關閉網頁後不執行，重新開啟需再選擇資料夾。** 不新增 R2 或付費服務，檔案不存回 D1，也不產生公開個資下載連結。

## 安全與穩定性

已修正成功登入誤累計限制、不同帳號限制桶衝突、舊 401 誤登出新帳號、同時訊息順序、清理舊快照及管理欄位驗證。備份另有後端管理員／來源／CSRF／HMAC／版本驗證、CSV 公式防護、登出取消與多視窗保護。

沿用 2026-11-18 安全檢查結果，本次未變更依賴：正式執行依賴 `npm audit --omit=dev` 為 **0**。開發工具仍有 **1 項 picomatch 根源公告、5 個 high 相依節點**尚待上游發布修補，沒有標示為全部修復；它們不在正式 Pages／Workers 執行程式中，開發及預覽預設限本機。詳見安全檢查報告。

100 項單元／整合、54 項完整瀏覽器及正式模式建置通過；全為虛構資料與 LINE HTTP Mock。資料夾自動化使用 API 替身，不代表已完成 Windows 多日實機驗收。

## 累積功能也已包含

個人綁定 QR、交接搜尋及大字收合、多筆領取與復原、重複通知提醒、提袋圖示、自填待領物品、直接點按對話狀態、輕量三秒更新與紀錄清理均已合併。

![訊息中心](preview-chat.png)

![交接事項](preview-worktable.png)

## 之後正式更新

先看預覽，不必立即更新。準備好時合併 **src、worker、tests、docs、migrations、scripts 六個資料夾**，以及根目錄 **package.json、package-lock.json、vite.config.ts、README.md 四個檔案**；覆寫同名檔案並保留其他舊檔。不要上傳 ZIP 或預覽 HTML；原 wrangler.jsonc、環境檔、D1 ID、帳號與 Secrets 保留。

本次版面調整沒有新增 Migration。累積包仍有先前的升級：**先備份 D1，再依序套用尚未執行的 0003、0004、0005_record_exports.sql**，確認後才上傳 GitHub main 觸發正式部署。Migration 只升級結構，不會自動備份或刪除既有資料。不需新增 Secrets。

整合包 SHA256：`b3c4856394ed3b29ecfedda9b893710e521c636f1b1ce0c0c31cec943a62e38d`

HTML 預覽包 SHA256：`542440f8eef414b6e557caaedf759a7d2e0b61253020bcdf859e09deb3255e5e`

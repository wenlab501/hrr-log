# hrr-log：HRR 測試事件紀錄 PWA

跑步機心率恢復（HRR）測試時，用按鈕記錄暖身、跑步開始、停止跑步、恢復結束等事件的時間點與組數，並匯出 CSV。本版不連接任何心率帶或裝置。

網址：https://wenlab501.github.io/hrr-log/

## 安裝到手機主畫面

- iPhone／iPad：用 Safari 開啟網址 → 分享 → 加入主畫面。
- Android：用 Chrome 開啟網址 → 選單 → 安裝應用程式（或加到主畫面）。

安裝後可離線使用。

## 測試流程

1. 輸入受試者代碼（只用代碼，請勿輸入姓名）與 protocol 名稱，開始新場次。
2. 心率裝置開始記錄時，同時按「同步」，留下兩邊共同的時間點。
3. 依實際狀況按「暖身開始」「跑步開始」「停止跑步」「恢復結束」「緩和開始」。
   - 「跑步開始」會記錄畫面上的速度，並自動把組數加 1。
   - 「停止跑步」後會跳出 RPE（1–10），可略過，之後用「RPE」補記。
   - 按錯時用「撤銷上一筆」；原紀錄不會刪除，CSV 中標為 `valid=false`。
4. 長按「測試結束」1 秒，接著按「匯出 CSV」。

## 資料保存

- 紀錄只存在手機瀏覽器（IndexedDB），不會上傳到 GitHub 或任何伺服器。
- 瀏覽器資料可能被系統清除；**每場測試結束後請立即匯出 CSV**，首頁會標示「未匯出」的場次。

## CSV 格式

- UTF-8（含 BOM）、CRLF 換行。
- 以 `# ` 起始的列為場次資訊；之後是表頭與每列一筆事件。
- 欄位：`session_id, seq, event_type, event_label, bout, speed_kmh, rpe, note, t_epoch_ms, t_local_iso, t_mono_ms, corrects_seq, valid, flags`。
- `t_mono_ms` 為場次開始起算的單調時間，不受手機自動校時影響；`flags` 可能為 `resumed`（頁面重開後的第一筆）或 `clock_jump`（偵測到手機時鐘跳動）。

以 Python 讀取：

```python
import io

import pandas as pd

with open("HRR-log_S01_20261124-1605.csv", encoding="utf-8-sig") as handle:
    lines = [line for line in handle if not line.startswith("# ")]
events = pd.read_csv(io.StringIO("".join(lines)))
valid = events[events["valid"]]
```

## 開發

- 純 HTML／CSS／JavaScript，無框架、無建置步驟、無套件相依。
- 單元測試：`node --test "tests/*.test.mjs"`
- 本機預覽：`python -m http.server 8765 --bind 127.0.0.1`，開啟 `http://127.0.0.1:8765/`。
- 發布新版：同步修改 `version.js` 與 `sw.js` 的版本號（測試會檢查兩者一致），推送到 `main` 後 GitHub Pages 自動更新；手機重新開啟 app 即套用新版。

設計文件：`docs/superpowers/specs/2026-11-24-hrr-log-pwa-design.md`

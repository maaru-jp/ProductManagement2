# Maaru Shop

前端會從 **Google 試算表（Apps Script）** 讀取商品資料。部署到 GitHub Pages 後若畫面上沒有資料，多半是 **CORS（跨站請求）** 被瀏覽器阻擋。

## 已做的處理

- 程式會先直接請求 API，失敗時自動改經 **CORS proxy**（`corsproxy.io`）再試一次，多數情況下在 GitHub Pages 上就能顯示資料。

## 若仍無法載入資料：在 Google Apps Script 加 CORS

若 proxy 不穩或仍失敗，請在 **提供 JSON 的那個 Google Apps Script 專案** 裡加上 CORS 標頭：

1. 開啟試算表 → **擴充功能** → **Apps Script**。
2. 找到負責回傳 JSON 的函式（例如 `doGet(e)`）。
3. 回傳時改成同時設定標頭，例如：

```javascript
function doGet(e) {
  var data = getYourData(); // 你原本取得資料的程式
  var output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  // 允許任何網站呼叫（部署到網頁應用程式後，外部才能載入）
  output.setHeader('Access-Control-Allow-Origin', '*');
  return output;
}
```

4. **部署** → **管理部署** → 編輯現有部署或建立新部署，**誰可以存取** 選「**任何人**」→ 儲存。
5. 重新開啟你的 GitHub Pages 網站，重新整理後再試。

這樣 GitHub Pages 的網域就能通過 CORS，直接取得試算表資料，不依賴 proxy。

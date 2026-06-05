# 訂單進度 API 修復（必讀）

若查詢頁出現「回傳了商品資料」或查不到配送進度，代表 **線上 GAS 仍是舊版**，尚未啟用 `order_status`。

---

## 一、先驗證（30 秒）

用瀏覽器開啟（把網址換成你的 GAS URL）：

```
https://script.google.com/macros/s/你的ID/exec?action=api_meta
```

**已修復** 應看到：

```json
{"ok":true,"apiVersion":"2026-06-04","routes":["points_balance","customer_orders","order_status","orderId_legacy"]}
```

**仍是舊版** 會看到 `products` 商品陣列，或沒有 `api_meta`。

再測訂單（把 `00055` 換成試算表有的編號）：

```
?action=customer_orders&orderId=00055
```

應回傳 `orderId`、`history`，**不可**回傳 `products`。

---

## 二、修復步驟

1. 開啟 **有「訂單」工作表** 的那個 Google 試算表  
2. **擴充功能 → Apps Script**  
3. 左側點 `Code.gs`，**全選刪除**，貼上本專案最新的 `Code.gs` 全文  
4. 按 **儲存**（Ctrl+S）  
5. **部署 → 管理部署**  
6. 點現有「網頁應用程式」右側 **✏ 編輯**  
7. **版本** 選 **新版本**（不要選「上個版本」）  
8. **部署**  
9. 用上方「一、先驗證」兩個網址再測一次  

> 只按儲存不會更新線上服務，一定要「新版本」部署。

---

## 三、常見錯誤

| 狀況 | 原因 |
|------|------|
| 仍回傳 `products` | 未做「新版本」部署，或改錯試算表／專案 |
| `查無此訂單編號` | 試算表「訂單」工作表沒有該筆，或編號格式不同（ORD00055 vs 00055） |
| 有訂單但無歷程 | 「配送歷程」欄空白，系統會用訂單狀態自動產生簡易歷程 |

---

## 四、前端 API URL

確認以下三處為 **同一支** 部署 URL：

- `ProductManagement2-main/js/app.jsx` → `API_URL`
- `ProductManagement2-main/admin.html` → `API_BASE`
- `Order-status-main/index.html` → `API_URL`

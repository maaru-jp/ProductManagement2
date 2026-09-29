# LINE 官方帳號自動建單＋訂單成立回覆

適用流程：顧客在社群記事本喊單（例：`吊飾娃 手機鍊 +1`）→ **回傳到官方 LINE** → 系統自動建立後台「待處理」訂單 → 自動回覆「訂單成立」模板。

> 記事本本身無法被官方 API 讀取；自動化發生在「官方帳號收到私訊」這一步。

---

## 一、要接哪些 LINE 設定

### 1. LINE Developers
1. 開啟 [LINE Developers](https://developers.line.biz/)
2. 選擇你的 **Provider** → 官方帳號對應的 **Messaging API Channel**
3. 開啟 **Messaging API** 分頁，準備：
   - **Channel access token**（長期／發行）
   - **Channel secret**（選填，本專案目前以 URL token 驗證為主）
4. 同一個分頁找到 **Webhook URL**

### 2. Google Apps Script（本專案 `Code.gs`）
1. 開啟 ProductManagement2 試算表 → 擴充功能 → Apps Script
2. 貼上最新 `Code.gs` → 儲存
3. **部署 → 管理部署 → 編輯 → 新版本 → 部署**
4. 複製「網頁應用程式 URL」（與後台 `API_BASE` 同一支）

### 3. 後台「網站設定 → LINE 官方帳號自動建單」
1. 開啟 `admin.html` → 網站設定
2. 貼上 **Channel access token**
3. 按「重新產生」Webhook token（或儲存時產生）
4. 勾選「啟用 LINE 自動建單與自動回覆」
5. 編輯「訂單成立自動回覆模板」後按「儲存 LINE 設定」
6. 複製畫面上的 **Webhook URL**（已含 `?webhook_token=...`）

### 4. 把 Webhook 貼回 LINE（⚠️ 不能直接填 GAS）

**重要：** Google Apps Script 網頁應用程式對 POST 會回 **HTTP 302**，LINE 平台**不跟隨轉址**，Verify 會出現：

`The webhook returned an HTTP status code other than 200.(302 Found)`

因此 LINE 的 Webhook URL **必須填中繼 Proxy**（回 200），由 Proxy 再轉打到 GAS。

#### 用 Cloudflare Workers（免費，約 5 分鐘）

1. 後台按「複製 Webhook URL」，取得完整 GAS 網址（含 `?webhook_token=`）
2. 開啟 [Cloudflare Dashboard](https://dash.cloudflare.com) → 註冊／登入
3. **Workers & Pages** → **Create** → **Create Worker**
4. 開啟專案內 `line-webhook-proxy/cloudflare-worker.js`，全部貼上
5. 把檔案裡的 `GAS_WEBHOOK_URL` 改成步驟 1 複製的完整網址
6. **Save and Deploy**
7. 複製 Worker 網址（例如 `https://xxxx.workers.dev`）
8. LINE Developers → Messaging API → Webhook URL → 貼上 **Worker 網址**（不要貼 GAS）
9. 開啟 **Use webhook** → 按 **Verify**（應成功）
10. （建議）關閉官方帳號「自動回應／問候訊息」

> 之後若重新產生 webhook_token，記得同步改 Worker 裡的 `GAS_WEBHOOK_URL` 再 Deploy。

---

## 二、訊息怎麼解析

系統只處理「像登記」的訊息，一般閒聊不建單、不回覆。

### A. 喊單（記事本常見）
```
吊飾娃 手機鍊 +1
某某商品 S +1
```
- 辨識 `+1`／`＋1`／`加 1`
- 盡量用商品名稱比對試算表售價（比對不到則單價先為 0，後台可再改）

### B. 完整登記清單（官網複製）
```
MAARU 日本萌GO代購登記清單：
商品A 規格 × 2  NT$700
商品總計：NT$1400
```
- 與後台「從顧客訊息建立訂單」相同邏輯

---

## 三、後台訂單長什麼樣

自動建立的訂單欄位：

| 欄位 | 內容 |
|------|------|
| 訂單編號 | 系統下一號（如 `ORD00123`） |
| 狀態 | `待處理` |
| 客戶姓名 | LINE 顯示名稱（取不到則「LINE顧客」） |
| Line ID | LINE `userId` |
| 電話 | 空白（請後台補） |
| 會員卡號 | 同 LINE 用戶／同名舊客沿用；新客依日期規則產生 |
| 品項 | 解析出的商品列 |
| 小計 | 解析或試算 |
| 備註 | 原始 LINE 全文＋「（LINE 自動建單）」 |
| 預購日期 | 當天 |

店家後續只要在訂單管理補：**電話、運費、訂金、出貨**。

---

## 三之一、訂單進度一鍵推播（P0／P1）

### 顧客綁定（必要）

Push 只能打給 Messaging API 的 `userId`（`U` 開頭），不是顧客自填的 Line ID。

請顧客加官方帳號後傳送：

```
綁定 2026092312345
```

（13 碼會員卡號）

- 成功後寫入會員名單「LINE推播ID」
- 從官方 LINE 自動建單的訂單，本身已帶 `userId`，通常無需再綁即可推播

### 後台操作

1. **網站設定 → LINE**：編輯五種推播模板並儲存  
   - 確認／請匯款、已確認匯款、出貨、到店／可取貨、取貨完成  
2. **訂單管理**：每筆訂單操作欄可見「可推播／未綁定」與五個按鈕  
3. 按一下 → 顧客官方 LINE 收到對應模板（**不自動改訂單狀態**）

API：`POST action=order_line_notify`，body `{ orderId, notifyType }`  
`notifyType`：`confirm_pay`｜`paid`｜`shipping`｜`arrived`｜`completed`

---

## 四、自動回覆文案怎麼放

在後台 **網站設定 → LINE 官方帳號自動建單 → 訂單成立自動回覆模板**。

預設模板可用變數：

- `{{orderId}}` 訂單編號  
- `{{memberCardNo}}` 會員卡號  
- `{{itemsSummary}}` 商品摘要  
- `{{subtotal}}` 小計數字  
- `{{customerName}}` 顧客顯示名  

儲存後立即生效（下一次 Webhook 建單就用新文案）。

---

## 五、測試清單

1. 用自己的 LINE 加官方帳號為好友  
2. 傳：`測試商品 款式 +1`  
3. 應收到「訂單成立」回覆（含訂單編號）  
4. 後台「訂單管理」應出現一筆 `待處理`  
5. 傳一般聊天（無 +1）→ 不應建單  

---

## 六、常見問題

| 狀況 | 處理 |
|------|------|
| Verify 出現 302 Found | **正常現象**：GAS 不能直接當 LINE Webhook。請改用 `line-webhook-proxy/cloudflare-worker.js` 中繼，LINE 填 Workers 網址 |
| 完全沒反應 | 1) 確認已「啟用」並儲存 2) Code.gs **新版本部署** 3) LINE Webhook 是否已改成 Proxy（非 script.google.com） 4) Apps Script → 執行作業 |
| 有回覆但沒訂單 | 看 Apps Script 執行紀錄；確認試算表有「歷史訂單」分頁 |
| 後台「模擬建單測試」失敗 | Code.gs 尚未部署到含 `line_test_order` 的版本 |
| 模擬建單成功、LINE 仍無反應 | Webhook 仍指向 GAS（302）／未開 Use webhook／Channel access token 未存成功 |
| 單價都是 0 | 喊單名稱與商品管理名稱不一致，請統一關鍵字或改傳完整登記清單 |

---

## 七、與官網「送出登記」的關係

| 入口 | 用途 |
|------|------|
| 官方 LINE 自動建單 | 維持記事本喊單 → 回傳官方 的習慣 |
| 官網購物車送出登記 | 顧客自己結帳送單，減少 LINE 流量 |

兩條路都寫入同一張「歷史訂單」，可並存。

---

## 八、同顧客再 +1：併單規則（營運流程）

| 情境 | 系統行為 | 店家怎麼做 |
|------|----------|------------|
| 同一 LINE、第一筆喊單 | 開新單 `ORD…`，狀態「待處理」 | 之後補電話／運費／訂金 |
| **2 小時內**再傳 +1，且仍「待處理」、尚未收訂金 | **併入同一張訂單**（不另開編號） | 打開原單即可看到新增品項與備註「LINE 加單」 |
| 超過 2 小時 | 開**新單** | 當另一筆訂單處理 |
| 訂單已改狀態（非待處理）或已收訂金 | 開**新單** | 避免打亂已對帳／出貨中的單 |
| LINE 重試同一則訊息 | **不建第二筆**（去重） | 無需處理 |

建議店家日常：
1. 「待處理」＝還可讓顧客加購併單的窗口  
2. 一開始收訂金或改狀態成處理中 → 自動關閉併單，之後 +1 會變新單  
3. 備註區可看到每次 LINE 原文，方便對帳

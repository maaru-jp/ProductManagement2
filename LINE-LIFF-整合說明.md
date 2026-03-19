# LINE LIFF 整合評估與實作說明

## 一、目前架構摘要

| 項目 | 說明 |
|------|------|
| **顧客端** | `index.html` + `js/app.jsx`（React，hash 路由 `#/`、`#/product/商品名`） |
| **商品來源** | Google Apps Script（`Code.gs`）GET API → 試算表商品 + 匯率 |
| **購物車** | 瀏覽器 localStorage（`maarushop_cart_v1`） |
| **結帳流程** | 複製訂單內容 → 回傳到官方 LINE 登記 → 後台手動「新增訂單」 |
| **訂單儲存** | 僅在後台 `admin.html` 的 **localStorage**（試算表沒有訂單工作表） |
| **後台** | `admin.html`：商品管理（讀寫試算表）、訂單管理（僅本機）、報表、排版、設定 |

結論：**可以**加入 LINE LIFF，讓商品連結在 LINE 內開啟、瀏覽、結帳複製／分享；若要「在 LINE 內直接下單」與「顧客查詢訂單狀態」，需再擴充後端與顧客端。

---

## 二、LINE LIFF 是什麼

- **LIFF** = LINE Front-end Framework，是在 **LINE 內開網頁** 的技術。
- 客人點您傳到 LINE 社群／聊天室的 **商品連結** 時，可選擇在 **LINE 內建瀏覽器** 開啟，不需跳出 LINE。
- 在 LIFF 裡可以：
  - 使用 **LIFF SDK** 取得 LINE 用戶資訊（userId、displayName、頭像）。
  - **分享訊息到聊天室**（例如把訂單內容一鍵傳到與官方帳號的聊天）。
  - 未來可接 **LINE Login** 做「用 LINE 登入」與訂單綁定。

---

## 三、目前架構能直接支援的部分

在 **不改後端** 的前提下，只要把現有顧客端部署到 **HTTPS** 並設定 LIFF，就能做到：

1. **傳送商品連結至 LINE 社群**  
   - 商品頁網址格式：`https://您的網址/#/product/商品名稱`（商品名稱會經 encodeURIComponent）。  
   - 您或客人把這個連結貼到 LINE 社群／聊天即可。

2. **客人在 LINE 中點連結 → 在 LINE 內瀏覽商品**  
   - 將 LIFF 的「Endpoint URL」設成您顧客端首頁（例如 `https://您的網址/` 或 `https://您的網址/index.html`）。  
   - 在 LINE 裡點該 LIFF 連結時，會用 **同一個** `index.html` + `app.jsx` 開啟，因此：
     - 首頁、商品列表、**商品詳情**、購物車都會在 LINE 內正常運作。
   - 商品資料仍來自現有 Google Apps Script API，無須改 `Code.gs`。

3. **在 LINE 內下單（沿用目前流程）**  
   - 結帳流程維持：**複製訂單內容 → 回傳官方 LINE**。  
   - 可在 LIFF 內加一個「傳送到當前聊天」按鈕，用 LIFF **分享訊息** 把訂單內容丟到與官方帳號的聊天，等於一鍵送單，不需手動貼上。

4. **查詢訂單狀態**  
   - 目前訂單只存在 **後台本機 localStorage**，沒有對外的訂單查詢 API，所以 **顧客端無法「查訂單狀態」**。  
   - 若要「客人在 LINE 內查訂單」，需要底下「擴充項目」。

---

## 四、要完成「LIFF + 在 LINE 內瀏覽／下單」需做的事

### 4.1 前置條件（LINE 與主機）

1. **LINE 開發者帳號與 Channel**  
   - 登入 [LINE Developers](https://developers.line.biz/) → 建立 **Provider** → 建立 **Messaging API** 或 **LINE Login** Channel。

2. **建立 LIFF 應用**  
   - 在該 Channel 的 **LIFF** 分頁 → 新增 LIFF：  
     - **Endpoint URL**：您的顧客端首頁，例如 `https://您的網址/`（必須 **HTTPS**）。  
     - Size：建議 **Tall** 或 **Full**（商品頁需要較大畫面）。  
   - 取得 **LIFF ID**（例如 `1234567890-abcdefgh`）。

3. **顧客端必須在 HTTPS 上**  
   - LIFF 只支援 HTTPS。例如：  
     - GitHub Pages  
     - 或您自己的網域 + SSL。

### 4.2 顧客端程式修改（最小改動）

1. **引入 LIFF SDK**  
   - 在 `index.html` 的 `<head>` 或 `</body>` 前加入：  
     ```html
     <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
     ```

2. **在 app.jsx 中初始化 LIFF**  
   - 在 App 最外層（例如 `React.useEffect`）判斷：若網址帶有 LIFF 的 query（例如 `?liff.state=...`）或同源在 LINE 內，則 `liff.init({ liffId: '您的LIFF_ID' })`。  
   - 僅在 **LIFF 環境** 才呼叫 `liff.init`，一般瀏覽器開啟時不要呼叫，避免錯誤。

3. **商品連結格式維持不變**  
   - 現有 `#/product/商品名` 已可當作「商品連結」分享到 LINE；在 LIFF 中開啟時會直接進到商品頁。

4. **（選用）一鍵傳送訂單到 LINE**  
   - 在結帳／購物車區塊，若在 LIFF 內，可顯示「傳送到 LINE」按鈕。  
   - 使用 `liff.shareTargetPicker()` 或預填好的 `liff.sendMessage()`（依您 LIFF 版本與權限）把目前畫面上的訂單摘要當成訊息分享到當前聊天，等於「在 LINE 內完成下單（送單給官方）」。

5. **（選用）取得 LINE 用戶資料**  
   - 若需要「用 LINE 帳號辨識客人」，可呼叫 `liff.getProfile()`，把 `userId` 或 `displayName` 一併複製到訂單文字或之後的訂單 API。

以上 1～3 做完，就達成：**傳送商品連結至 LINE 社群 → 客人點擊 → 在 LINE 中瀏覽商品、加購、複製訂單或一鍵傳到官方 LINE 下單**。

---

## 五、若要「在 LINE 內直接下單 + 查詢訂單狀態」

目前 **訂單只存在後台 localStorage**，沒有試算表或 API。要支援：

- **在 LINE 內直接送單**（寫入一筆訂單）  
- **顧客查詢訂單狀態**（依訂單編號 + 手機末幾碼等）

需要下列擴充（會動到後端與後台）：

### 5.1 後端（Code.gs + 試算表）

1. **試算表新增「訂單」工作表**  
   - 欄位建議：訂單編號、時間、客戶姓名、電話、Email、LINE userId（選填）、商品明細（JSON 或簡化字串）、小計、運費、折扣、總計、狀態（待確認／已確認／已出貨等）、備註等。

2. **Code.gs 新增訂單 API**  
   - **POST**：建立訂單（顧客端或 LIFF 送單時呼叫），寫入「訂單」工作表，回傳訂單編號。  
   - **GET**：查詢單筆訂單（例如 `?action=order&id=訂單編號&phone=手機末四碼`），回傳訂單狀態與簡要內容（僅供顧客查詢用，勿回傳敏感個資）。  
   - 需注意：GET 若用網頁應用程式「任何人」存取，要避免被窮舉；可限制「訂單編號 + 手機末四碼」或加上簡單 token。

### 5.2 後台（admin.html）

1. **訂單改為從試算表讀寫**  
   - 載入訂單：呼叫 Code.gs 的 GET 訂單列表（或讀取試算表「訂單」工作表）。  
   - 新增／更新／刪除訂單：透過 Code.gs POST 寫入試算表，不再只存 localStorage。  
   - 可保留 localStorage 當快取或離線暫存，但以試算表為真實來源。

### 5.3 顧客端（app.jsx）

1. **送單 API**  
   - 結帳時可選擇：  
     - 維持「複製／一鍵傳到 LINE」；或  
     - 呼叫 Code.gs 的 **POST 建立訂單**，成功後顯示訂單編號，並可再一鍵把「訂單編號 + 查詢說明」分享到 LINE。

2. **訂單查詢頁**  
   - 新增路由例如 `#/order/查詢`，表單：訂單編號 + 手機末四碼（或 Email）。  
   - 呼叫 Code.gs **GET 訂單**，顯示狀態（待確認／已確認／已出貨等）與簡要內容。  
   - 在 LIFF 內也可放「查訂單」入口，同一頁在 LINE 內使用。

完成上述擴充後，即可在 LINE 內：**瀏覽商品 → 下單（寫入試算表）→ 查詢訂單狀態**。

---

## 六、建議實作順序

| 階段 | 項目 | 說明 |
|------|------|------|
| **第一階段** | 部署 HTTPS + 建立 LIFF | 顧客端上線到 HTTPS，在 LINE Developers 建立 LIFF，Endpoint 指到首頁。 |
| | 顧客端接 LIFF SDK | `index.html` 加 SDK，`app.jsx` 在 LIFF 環境 init，其餘邏輯不變。 |
| | 分享商品連結 | 商品頁可加「分享到 LINE」按鈕（用 LIFF share 或 `line://msg/text/` 連結）。 |
| **第二階段** | 一鍵傳送訂單到 LINE | 結帳區在 LIFF 內顯示「傳送到 LINE」，用 LIFF 把訂單內容送到聊天。 |
| **第三階段**（選用） | 試算表訂單 + Code.gs API | 訂單工作表、POST 建立訂單、GET 查詢訂單。 |
| | 後台改讀寫試算表訂單 | 訂單管理改為呼叫 API，與試算表同步。 |
| | 顧客端送單 + 訂單查詢頁 | 結帳可送 API；新增「查訂單」頁面並在 LIFF 內可查狀態。 |

---

## 七、總結

- **目前架構可以**加入 LINE LIFF：商品連結在 LINE 內開啟、瀏覽商品、購物車、結帳複製／一鍵傳到 LINE 都可基於現有顧客端與 Google Apps Script 商品 API 完成，**不需訂單後端**。
- **「傳送商品連結 → 客人在 LINE 中瀏覽、下單（複製或一鍵傳到 LINE）」**：只需 LIFF 設定 + 顧客端接 LIFF SDK 與少許 UI（分享、傳送訂單）。
- **「直接寫入訂單 + 顧客查詢訂單狀態」**：需擴充試算表與 Code.gs 訂單 API，並讓後台與顧客端改為使用該 API。

若您希望先實作「第一階段 + 第二階段」（不改訂單後端），我可以依您目前的 `index.html` 與 `app.jsx` 結構，寫出具體的 LIFF 初始化程式碼與「分享／傳送訂單」按鈕範例（含要替換的 LIFF ID 位置）。

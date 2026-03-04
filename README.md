# Maaru Shop - Google Apps Script API

這是給 **Google 試算表** 用的 Apps Script，用來把試算表當成商品與匯率的後端 API。

## 試算表結構

### 1. 商品工作表（第一個工作表，或 CONFIG.sheetName 指定的名稱）

第一列為**標題列**，支援以下欄位名稱（中英文皆可）：

| 用途     | 可用的欄位名稱                                         |
|----------|--------------------------------------------------------|
| 編號     | 序號、編號、id、ID                                     |
| 商品名稱 | 商品名稱、品名、title、name                            |
| 日幣價格 | 日幣價格、價格、price、售價(JPY)                       |
| 台幣售價 | 售價、台幣售價、sellingPrice、售價(TW)                |
| 主圖     | 商品主圖、圖片、圖片URL、image、imageUrl               |
| 規格     | 規格、顏色、option、variant（多個用逗號分隔）          |
| 規格分欄 | 規格1、規格2、規格3、規格4（各欄填一個，API 會合併）   |
| 規格圖片 | 規格圖片、variantImages                               |
| 描述     | 描述、說明、content、description                       |
| 商品介紹 | 商品介紹、介紹、intro、introduction                    |
| 分類     | 分類、category；子分類、subcategory                    |
| 角色     | 角色、角色名稱、character                              |
| 現貨預購 | 現貨預購、stockType（填 現貨 或 預購）                 |
| 熱銷     | 熱銷、hot（填 Y/1 表示是）                             |
| 推薦     | 推薦、recommended                                     |
| 新品     | 新品、isNew                                            |
| 上架日期 | 上架日期、上架時間、publishedAt                        |
| 狀態     | 狀態、status（上架／下架）                             |

第二列起為一筆筆商品資料。

### 2. 匯率（選用）

若要有「日圓 → 台幣」匯率，可新增一個工作表命名為 **設定**：

- 第一列：標題，其中一欄為 **匯率** 或 **rate**
- 第二列：匯率數字（例如 0.23 表示 1 日圓 = 0.23 台幣）

沒有「設定」工作表或沒有匯率欄位時，前端會顯示「價格請洽詢」。

## 部署步驟

1. 開啟你的 **Google 試算表**（商品與選用的匯率都在同一個試算表）。
2. 選單：**擴充功能** → **Apps Script**。
3. 刪除預設的 `function myFunction()`，把 `Code.gs` 的內容全部貼上，儲存。
4. 上方 **部署** → **新增部署** → 類型選 **網頁應用程式**。
5. **說明**可填「Maaru Shop API」。
6. **執行身分**：我。
7. **誰可以存取**：**任何人**（前端才能從 GitHub Pages / 本機開啟的網頁呼叫）。
8. 按 **部署**，完成後複製 **網頁應用程式 URL**。
9. **務必**把這個 URL 貼到專案裡這兩個地方，否則後台無法寫入試算表、顧客頁也讀不到商品：
   - **後台**：`admin.html` 裡搜尋 `API_READ` 與 `API_WRITE`，將兩處的 `https://script.google.com/macros/s/.../exec` 換成你的 URL（本機開發時會用 `/api`、`/api-write`，可略過）。
   - **顧客頁**：`js/app.jsx` 裡搜尋 `API_URL`，將該常數的值換成同一個 URL。

## API 回傳格式

- **GET** 請求會回傳 JSON：
  - `rate`：數字或 null（匯率）。
  - `products`：陣列，每個元素為一筆商品物件（欄位名對應試算表標題轉成的 key）。

前端已支援 `data.rate` 與 `data.products`，無需再改前端邏輯。

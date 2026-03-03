/**
 * Maaru Shop - Google Apps Script API
 * 部署為「網頁應用程式」後，前端可透過此 API 取得試算表內的商品與匯率。
 *
 * 部署步驟：
 * 1. 在試算表選單：擴充功能 → Apps Script
 * 2. 貼上本程式後儲存
 * 3. 部署 → 新增部署 → 類型選「網頁應用程式」
 * 4. 執行身分：我、誰可以存取：任何人 → 部署
 * 5. 複製「網頁應用程式 URL」貼到前端的 API_URL
 */

var CONFIG = {
  // 商品工作表名稱（留空則用第一個工作表）
  sheetName: "",
  // 若有「匯率」或「設定」工作表，可從這裡讀 rate（欄位名：rate 或 匯率）
  rateSheetName: "設定",
  rateColumnName: "匯率"
};

/**
 * 網頁應用程式進入點。前端用 GET 請求此 URL 取得 JSON。
 */
function doGet(e) {
  try {
    var data = getApiData();
    var json = JSON.stringify(data);
    var output = ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
    // 允許從 GitHub Pages、localhost 等任何網域呼叫
    output.setHeader("Access-Control-Allow-Origin", "*");
    return output;
  } catch (err) {
    Logger.log(err);
    var errorBody = JSON.stringify({
      error: true,
      message: err.toString()
    });
    return ContentService.createTextOutput(errorBody)
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

/**
 * 從試算表組出前端要的 { products: [...], rate: number }。
 */
function getApiData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rate = getRate(ss);
  var products = getProducts(ss);
  return {
    rate: rate,
    products: products
  };
}

/**
 * 從「設定」工作表讀匯率（數字），沒有則回傳 null。
 */
function getRate(ss) {
  var name = CONFIG.rateSheetName || "設定";
  var sheet = ss.getSheetByName(name);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return null;
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var rateCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (h === "rate" || h === "匯率") rateCol = i;
  }
  if (rateCol < 0) return null;
  var val = data[1][rateCol];
  if (val === "" || val === null || val === undefined) return null;
  var num = Number(val);
  return isFinite(num) ? num : null;
}

/**
 * 從商品工作表讀取所有列，第一列為標題，轉成物件陣列。
 * 標題支援中英文對照（會轉成前端認識的 key）。
 */
function getProducts(ss) {
  var name = CONFIG.sheetName;
  var sheet = name ? ss.getSheetByName(name) : ss.getSheets()[0];
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var keyMap = buildKeyMap(headers);
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = keyMap[c];
      if (!key) continue;
      var val = row[c];
      if (val !== "" && val !== null && val !== undefined) {
        obj[key] = val;
      }
    }
    if (obj.name || obj["商品名稱"] || obj.title || obj["品名"]) {
      list.push(obj);
    }
  }
  return list;
}

/**
 * 依第一列標題建立「欄位索引 → 前端認識的 key」對照。
 * 前端 normalizeItem 會接受中英文 key，這裡統一產出前端會讀的幾種寫法之一即可。
 */
function buildKeyMap(headers) {
  var map = {};
  var aliases = [
    ["序號", "編號", "id", "ID"],
    ["商品名稱", "品名", "title", "name"],
    ["日幣價格", "價格", "price", "Price", "priceTWD"],
    ["圖片", "圖片URL", "image", "Image", "imageUrl"],
    ["描述", "說明", "content", "description"],
    ["商品介紹", "介紹", "intro", "introduction"],
    ["規格", "顏色", "option", "variant"],
    ["分類", "category"],
    ["熱銷", "hot"],
    ["推薦", "recommended"],
    ["新品", "isNew"],
    ["上架日期", "上架時間", "publishedAt"]
  ];
  for (var c = 0; c < headers.length; c++) {
    var h = (headers[c] || "").toString().trim();
    if (!h) continue;
    for (var a = 0; a < aliases.length; a++) {
      var group = aliases[a];
      for (var g = 0; g < group.length; g++) {
        if (h === group[g] || h.toLowerCase() === group[g].toLowerCase()) {
          map[c] = group[group.length - 1];
          break;
        }
      }
      if (map[c]) break;
    }
  }
  return map;
}

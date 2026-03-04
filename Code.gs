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
  // 商品工作表：留空 = 用第一個分頁；多張分頁時可填名稱指定商品表
  sheetName: "",
  // 第二張分頁「設定」專用於匯率，請勿變動；表內需有「匯率」或 rate 欄位
  rateSheetName: "設定",
  rateColumnName: "匯率"
};

/**
 * 網頁應用程式進入點。GET = 讀取商品與匯率；POST = 後台寫入/更新商品。
 */
function doGet(e) {
  try {
    var data = getApiData();
    var json = JSON.stringify(data);
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log(err);
    var errorBody = JSON.stringify({
      error: true,
      message: err.toString()
    });
    return ContentService.createTextOutput(errorBody)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 後台寫入/刪除商品：POST 傳入 JSON
 * - action: "append"|"update"|"delete"
 * - append/update 時需 product: {...}；update/delete 時需 rowIndex: 試算表列號（從 2 起算）
 */
function doPost(e) {
  try {
    var raw = e.postData && e.postData.contents ? e.postData.contents : "{}";
    var body = JSON.parse(raw);
    var action = body.action || "append";
    var product = body.product || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = CONFIG.sheetName ? ss.getSheetByName(CONFIG.sheetName) : ss.getSheets()[0];
    if (!sheet) {
      return jsonResponse({ error: true, message: "找不到商品工作表" });
    }
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return (h || "").toString().trim(); });

    if (action === "delete" && body.rowIndex != null) {
      var delRow = parseInt(body.rowIndex, 10);
      if (delRow >= 2 && delRow <= sheet.getLastRow()) {
        sheet.deleteRow(delRow);
        return jsonResponse({ ok: true, message: "已刪除該筆商品" });
      }
      return jsonResponse({ error: true, message: "無效的 rowIndex" });
    }

    var row = buildRowFromProduct(headers, product);
    if (action === "append") {
      sheet.appendRow(row);
      return jsonResponse({ ok: true, message: "已新增一筆商品" });
    }
    if (action === "update" && body.rowIndex != null) {
      var rowIndex = parseInt(body.rowIndex, 10);
      if (rowIndex >= 2 && rowIndex <= sheet.getLastRow()) {
        sheet.getRange(rowIndex, 1, rowIndex, headers.length).setValues([row]);
        return jsonResponse({ ok: true, message: "已更新商品" });
      }
    }
    return jsonResponse({ error: true, message: "不支援的 action 或 rowIndex" });
  } catch (err) {
    Logger.log(err);
    return jsonResponse({ error: true, message: err.toString() });
  }
}

function jsonResponse(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

/** 將規格字串拆成陣列（與顧客頁邏輯一致），用於寫入規格1～規格4 */
function splitVariantForWrite(variantStr) {
  if (variantStr == null || variantStr === "") return [];
  var s = String(variantStr).trim();
  if (!s) return [];
  var normalized = s
    .replace(/[\uFF0C\u3000\u00A0，、;；\n\r\u30FB\u2027\u201A\u2039]/g, ",")
    .replace(/\s+/g, ",");
  var parts = normalized.split(/[,]+/).map(function(p) { return p.trim(); }).filter(function(p) { return p; });
  return parts;
}

/** 依試算表標題列順序，從 product 物件組出一列陣列（寫入用）。規格1～規格4 會由 variant 拆開寫入。 */
function buildRowFromProduct(headers, product) {
  var fullToHalf = function(str) {
    return String(str).replace(/[\uFF10-\uFF19]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  };
  var headerToKey = {
    "序號": "id", "編號": "id", "id": "id", "ID": "id",
    "商品名稱": "name", "品名": "name", "title": "name",
    "分類": "category", "category": "category",
    "子分類": "subcategory", "subcategory": "subcategory",
    "角色": "character", "角色名稱": "character", "character": "character",
    "規格": "variant", "顏色": "variant", "option": "variant", "variant": "variant",
    "日幣價格": "price", "價格": "price", "price": "price", "priceTWD": "price", "售價(JPY)": "price",
    "售價": "sellingPrice", "台幣售價": "sellingPrice", "sellingPrice": "sellingPrice", "售價(TW)": "sellingPrice",
    "匯率": "rate", "rate": "rate",
    "利潤": "profit", "profit": "profit",
    "成本": "cost", "cost": "cost",
    "庫存": "stock", "stock": "stock",
    "圖片": "image", "圖片URL": "image", "商品主圖": "image", "image": "image", "imageUrl": "image",
    "規格圖片": "variantImages", "variantImages": "variantImages",
    "描述": "description", "說明": "description", "content": "description", "description": "description",
    "商品介紹": "introduction", "介紹": "introduction", "intro": "introduction", "introduction": "introduction",
    "熱銷": "hot", "hot": "hot",
    "推薦": "recommended", "recommended": "recommended",
    "新品": "isNew", "isNew": "isNew",
    "上架日期": "publishedAt", "上架時間": "publishedAt", "publishedAt": "publishedAt",
    "狀態": "status", "status": "status",
    "貨況": "stockType", "現貨預購": "stockType", "現貨/預購": "stockType", "stockType": "stockType",
    "規格庫存": "variantStock", "variantStock": "variantStock"
  };
  var variantStr = product.variant != null ? String(product.variant).trim() : (product.規格 != null ? String(product.規格).trim() : "");
  var variantParts = splitVariantForWrite(variantStr);
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var rawH = (headers[i] || "").toString().trim();
    var h = fullToHalf(rawH.replace(/\*+/g, "")).trim();
    var val = "";
    if (h === "規格1") { val = variantParts[0] != null ? variantParts[0] : ""; }
    else if (h === "規格2") { val = variantParts[1] != null ? variantParts[1] : ""; }
    else if (h === "規格3") { val = variantParts[2] != null ? variantParts[2] : ""; }
    else if (h === "規格4") { val = variantParts[3] != null ? variantParts[3] : ""; }
    else {
      var key = headerToKey[h] || headerToKey[h.toLowerCase()];
      val = key ? (product[key] != null ? product[key] : "") : "";
    }
    row.push(val === null || val === undefined ? "" : val);
  }
  return row;
}

/**
 * 從試算表組出前端要的 { products: [...], rate: number }。
 * 台幣售價來自商品工作表的「售價」/「台幣售價」；匯率來自「設定」工作表（有則用於日幣換算）。
 */
function getApiData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var products = getProducts(ss);
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p.sellingPrice != null && p.sellingPrice !== "") {
      p["台幣售價"] = p.sellingPrice;
      p.priceTWD = p.sellingPrice;
    }
  }
  return {
    rate: getRate(ss),
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
        obj[key] = typeof val === "string" ? val.trim() : val;
      }
    }
    // 若有規格1、規格2 等分欄，合併成單一規格字串（逗號分隔），顧客頁才能拆成多個選項
    var variantParts = [obj.variant, obj.variant1, obj.variant2, obj.variant3, obj.variant4].filter(function(x) {
      return x !== undefined && x !== null && String(x).trim() !== "";
    });
    if (variantParts.length > 0) {
      obj.variant = variantParts.map(function(x) { return String(x).trim(); }).join(", ");
    }
    delete obj.variant1;
    delete obj.variant2;
    delete obj.variant3;
    delete obj.variant4;
    if (obj.imageUrl != null && obj.imageUrl !== "" && (obj.image == null || obj.image === "")) {
      obj.image = obj.imageUrl;
    }
    if (obj.stockType != null && obj.stockType !== "") {
      obj.stockType = String(obj.stockType).trim();
      obj["現貨預購"] = obj.stockType;
      obj["貨況"] = obj.stockType;
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
    ["日幣價格", "價格", "Price", "priceTWD", "售價(JPY)", "price"],
    ["售價", "台幣售價", "售價(TW)", "sellingPrice"],
    ["匯率", "rate"],
    ["利潤", "profit"],
    ["成本", "cost"],
    ["庫存", "stock"],
    ["圖片", "圖片URL", "商品主圖", "image", "Image", "imageUrl"],
    ["規格圖片", "variantImages"],
    ["描述", "說明", "content", "description"],
    ["商品介紹", "介紹", "intro", "introduction"],
    ["規格", "顏色", "option", "variant"],
    ["規格1", "variant1"],
    ["規格2", "variant2"],
    ["規格3", "variant3"],
    ["規格4", "variant4"],
    ["分類", "category"],
    ["子分類", "subcategory"],
    ["角色", "角色名稱", "character"],
    ["熱銷", "hot"],
    ["推薦", "recommended"],
    ["新品", "isNew"],
    ["上架日期", "上架時間", "publishedAt"],
    ["狀態", "status"],
    ["貨況", "現貨預購", "現貨/預購", "stockType"],
    ["規格庫存", "variantStock"]
  ];
  var fullToHalf = function(s) {
    return String(s).replace(/[\uFF10-\uFF19]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  };
  for (var c = 0; c < headers.length; c++) {
    var raw = (headers[c] || "").toString().trim();
    var h = fullToHalf(raw.replace(/\*+/g, "")).trim();
    if (!h) continue;
    for (var a = 0; a < aliases.length; a++) {
      var group = aliases[a];
      for (var g = 0; g < group.length; g++) {
        var alias = fullToHalf((group[g] || "").toString().trim());
        if (h === alias || h.toLowerCase() === alias.toLowerCase()) {
          map[c] = group[group.length - 1];
          break;
        }
      }
      if (map[c]) break;
    }
  }
  return map;
}

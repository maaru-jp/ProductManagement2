/**
 * Maaru Shop - Google Apps Script API
 * 部署為「網頁應用程式」後，前端可透過此 API 取得試算表內的商品與匯率。
 *
 * 部署步驟：
 * 1. 開啟「要編輯的那個」試算表 → 擴充功能 → Apps Script
 * 2. 貼上本程式後儲存
 * 3. 若儲存/刪除後試算表沒更新：在 CONFIG 填 spreadsheetId（試算表網址中 /d/ 與 /edit 之間那串）
 * 4. 部署 → 新增部署 → 類型選「網頁應用程式」
 * 5. 執行身分：我、誰可以存取：任何人 → 部署
 * 6. 複製「網頁應用程式 URL」貼到前端的 API_BASE
 */

var CONFIG = {
  // 試算表 ID：留空 = 使用「綁定本腳本的試算表」（從該試算表 擴充功能→Apps Script 部署）。
  // 若儲存/刪除後試算表沒更新，請填這裡：從試算表網址複製 /d/ 與 /edit 之間那串 ID。
  spreadsheetId: "",
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
    var action = String(body.action || "append").toLowerCase();
    var product = body.product || {};
    var ss = CONFIG.spreadsheetId
      ? SpreadsheetApp.openById(CONFIG.spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ error: true, message: "無法取得試算表。請在 CONFIG 填寫 spreadsheetId，或從要編輯的試算表「擴充功能 → Apps Script」開啟並部署。" });
    }
    var sheet = CONFIG.sheetName ? ss.getSheetByName(CONFIG.sheetName) : ss.getSheets()[0];
    if (!sheet) {
      return jsonResponse({ error: true, message: "找不到商品工作表" });
    }
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return (h || "").toString().trim(); });
    var fullToHalfHeader = function(s) {
      return String(s).replace(/[\uFF10-\uFF19]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      }).replace(/\*+/g, "").trim();
    };
    var hasStockColumn = headers.some(function(h) {
      var n = fullToHalfHeader(h);
      return n === "庫存" || n.toLowerCase() === "stock";
    });
    if (!hasStockColumn && (action === "append" || action === "update")) {
      var lastCol = sheet.getLastColumn();
      sheet.getRange(1, lastCol + 1).setValue("庫存");
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return (h || "").toString().trim(); });
    }
    var hasVariantStockColumn = headers.some(function(h) {
      var n = fullToHalfHeader(h).replace(/\s+/g, "");
      return n === "規格庫存" || n.toLowerCase() === "variantstock";
    });
    if (!hasVariantStockColumn && (action === "append" || action === "update")) {
      var lastCol2 = sheet.getLastColumn();
      sheet.getRange(1, lastCol2 + 1).setValue("規格庫存");
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return (h || "").toString().trim(); });
    }

    if (action === "delete") {
      if (body.rowIndex == null || body.rowIndex === "") {
        return jsonResponse({ error: true, message: "刪除時必須提供 rowIndex（試算表列號）。請重新整理後台列表後再試。" });
      }
      var delRow = parseInt(body.rowIndex, 10);
      if (isNaN(delRow) || delRow < 2) {
        return jsonResponse({ error: true, message: "刪除的列號無效（列號須為 2 以上的數字）。請重新整理後台列表後再試。" });
      }
      var lastRow = sheet.getLastRow();
      if (delRow > lastRow) {
        return jsonResponse({ error: true, message: "刪除的列號無效（列號須在 2 ～ " + lastRow + " 之間）。請重新整理後台列表後再試。" });
      }
      sheet.deleteRow(delRow);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, message: "已刪除該筆商品" });
    }

    var row = buildRowFromProduct(headers, product);
    if (action === "append") {
      sheet.appendRow(row);
      return jsonResponse({ ok: true, message: "已新增一筆商品" });
    }
    if (action === "update") {
      if (body.rowIndex == null || body.rowIndex === "") {
        return jsonResponse({ error: true, message: "更新商品時必須提供 rowIndex（試算表列號）。請重新整理後台列表後再編輯儲存。" });
      }
      var rowIndex = parseInt(body.rowIndex, 10);
      if (isNaN(rowIndex) || rowIndex < 2) {
        return jsonResponse({ error: true, message: "rowIndex 必須為 2 以上的數字（第 1 列為標題）。請重新整理後台列表後再試。" });
      }
      var lastRow = sheet.getLastRow();
      if (rowIndex > lastRow) {
        return jsonResponse({ error: true, message: "列號 " + rowIndex + " 超出試算表範圍（目前最後一列為 " + lastRow + "）。請重新整理後台列表後再試。" });
      }
      sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, message: "已更新商品（含規格庫存）" });
    }
    return jsonResponse({ error: true, message: "不支援的 action（請傳 append、update 或 delete）；update/delete 時需提供 rowIndex。" });
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

/** 將規格庫存字串拆成數字陣列，用於寫入規格1庫存～規格4庫存 */
function splitVariantStockForWrite(variantStockStr) {
  if (variantStockStr == null && variantStockStr !== 0) return [];
  var s = String(variantStockStr).trim();
  if (s === "") return [];
  var parts = s.split(/[,，、\s]+/).map(function(p) {
    var n = parseInt(String(p).trim(), 10);
    return isNaN(n) ? "" : Math.max(0, n);
  });
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
    "庫存": "stock", "stock": "stock", "庫存總數": "stock",
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
  var rawVariantStock = (product.variantStock != null && product.variantStock !== "") ? product.variantStock : (product.規格庫存 != null && product.規格庫存 !== "" ? product.規格庫存 : "");
  if (Array.isArray(rawVariantStock)) {
    rawVariantStock = rawVariantStock.map(function(x) { return x != null ? String(x).trim() : ""; }).filter(Boolean).join(",");
  } else {
    rawVariantStock = rawVariantStock != null && rawVariantStock !== "" ? String(rawVariantStock).trim() : "";
  }
  var variantStockStr = rawVariantStock;
  var variantStockParts = splitVariantStockForWrite(variantStockStr);
  var variantStockTotal = 0;
  for (var k = 0; k < variantStockParts.length; k++) {
    var v = variantStockParts[k];
    if (v !== "" && v !== undefined && !isNaN(Number(v))) variantStockTotal += Number(v);
  }
  var stockFromForm = product.stock != null && product.stock !== "" ? Number(product.stock) : (product.庫存 != null && product.庫存 !== "" ? Number(product.庫存) : NaN);
  if (isNaN(stockFromForm) || stockFromForm < 0) stockFromForm = NaN;
  var effectiveStock = variantStockParts.length > 0 ? variantStockTotal : (isFinite(stockFromForm) ? stockFromForm : "");
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var rawH = (headers[i] || "").toString().trim();
    var h = fullToHalf(rawH.replace(/\*+/g, "")).trim();
    var val = "";
    if (h === "規格1") { val = variantParts[0] != null ? variantParts[0] : ""; }
    else if (h === "規格2") { val = variantParts[1] != null ? variantParts[1] : ""; }
    else if (h === "規格3") { val = variantParts[2] != null ? variantParts[2] : ""; }
    else if (h === "規格4") { val = variantParts[3] != null ? variantParts[3] : ""; }
    else if (h === "規格1庫存") { val = variantStockParts[0] !== undefined && variantStockParts[0] !== "" ? variantStockParts[0] : ""; }
    else if (h === "規格2庫存") { val = variantStockParts[1] !== undefined && variantStockParts[1] !== "" ? variantStockParts[1] : ""; }
    else if (h === "規格3庫存") { val = variantStockParts[2] !== undefined && variantStockParts[2] !== "" ? variantStockParts[2] : ""; }
    else if (h === "規格4庫存") { val = variantStockParts[3] !== undefined && variantStockParts[3] !== "" ? variantStockParts[3] : ""; }
    else if (h === "庫存" || h === "庫存總數" || h.toLowerCase() === "stock") {
      val = effectiveStock !== "" ? effectiveStock : "";
    }
    else {
      var key = headerToKey[h] || headerToKey[h.toLowerCase()];
      val = key ? (product[key] != null ? product[key] : "") : "";
      if ((h === "狀態" || (key && key === "status")) && (val === "" || val == null || String(val).trim() === "")) {
        val = "上架";
      }
    }
    row.push(val === null || val === undefined ? "" : val);
  }
  for (var j = 0; j < headers.length; j++) {
    var hj = fullToHalf((headers[j] || "").toString().trim().replace(/\*+/g, "")).trim();
    var isStockCol = (hj === "庫存" || hj === "庫存總數" || hj.toLowerCase() === "stock" || hj.indexOf("庫存") >= 0);
    if (isStockCol && (row[j] === "" || row[j] == null) && effectiveStock !== "") {
      row[j] = effectiveStock;
    }
    var hjNorm = hj.replace(/\s+/g, "");
    if (hj === "規格庫存" || hjNorm.toLowerCase() === "variantstock") {
      row[j] = variantStockStr || "";
    }
  }
  return row;
}

/**
 * 從試算表組出前端要的 { products: [...], rate: number, characters: [...] }。
 * 台幣售價來自商品工作表的「售價」/「台幣售價」；匯率來自「設定」工作表；角色來自「角色」工作表。
 */
function getApiData() {
  var ss = CONFIG.spreadsheetId
    ? SpreadsheetApp.openById(CONFIG.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { rate: null, products: [], characters: [], error: "無法取得試算表，請從 Google 試算表依「擴充功能 → Apps Script」開啟並部署此腳本（需綁定至試算表）" };
  }
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
    products: products,
    characters: getCharacters(ss)
  };
}

/**
 * 從「角色」工作表讀取角色名稱與圖片，回傳 [{ name, image }, ...]。
 * 工作表名稱：角色；第一列為標題，支援「角色」「角色圖片」或「角色名稱」「圖片」等欄位名。
 */
function getCharacters(ss) {
  if (!ss) return [];
  var sheet = ss.getSheetByName("角色");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var nameCol = -1;
  var imageCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    if (h === "角色" || h === "角色名稱" || h === "name" || h === "名稱") nameCol = c;
    if (h === "角色圖片" || h === "圖片" || h === "image" || h === "圖片URL" || h === "url") imageCol = c;
  }
  if (nameCol < 0) return [];
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = row[nameCol] != null ? String(row[nameCol]).trim() : "";
    if (!name) continue;
    var image = imageCol >= 0 && row[imageCol] != null ? String(row[imageCol]).trim() : "";
    list.push({ name: name, image: image });
  }
  return list;
}

/**
 * 從「設定」工作表讀匯率（數字），沒有則回傳 null。
 */
function getRate(ss) {
  if (!ss) return null;
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
 * 讀取試算表某一列為物件（用於規格庫存累加時取得該列現有規格庫存）。
 */
function getRowAsObject(sheet, rowIndex, headers) {
  var keyMap = buildKeyMap(headers);
  var row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var obj = {};
  for (var c = 0; c < row.length; c++) {
    var key = keyMap[c];
    if (!key) continue;
    var val = row[c];
    if (val !== "" && val !== null && val !== undefined) {
      obj[key] = typeof val === "string" ? val.trim() : val;
    }
  }
  var stockParts = [
    obj.variantStock1, obj.variantStock2, obj.variantStock3, obj.variantStock4
  ].map(function(x) {
    if (x === undefined || x === null) return "";
    var n = parseInt(String(x).trim(), 10);
    return isNaN(n) ? "" : Math.max(0, n);
  });
  if (stockParts.some(function(x) { return x !== ""; })) {
    obj.variantStock = stockParts.map(function(x) { return x === "" ? "0" : String(x); }).join(",");
  }
  return obj;
}

/**
 * 從商品工作表讀取所有列，第一列為標題，轉成物件陣列。
 * 標題支援中英文對照（會轉成前端認識的 key）。
 */
function getProducts(ss) {
  if (!ss) return [];
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
    // 若有規格1庫存～規格4庫存 分欄，合併成單一「規格庫存」字串（逗號分隔），與規格順序對應
    var stockParts = [
      obj.variantStock1, obj.variantStock2, obj.variantStock3, obj.variantStock4
    ].map(function(x) {
      if (x === undefined || x === null) return "";
      var n = parseInt(String(x).trim(), 10);
      return isNaN(n) ? "" : Math.max(0, n);
    });
    var hasSplitStock = stockParts.some(function(x) { return x !== ""; });
    if (hasSplitStock) {
      obj.variantStock = stockParts.map(function(x) { return x === "" ? "0" : String(x); }).join(",");
      obj["規格庫存"] = obj.variantStock;
    } else if (obj.variantStock != null && obj.variantStock !== "") {
      obj.variantStock = String(obj.variantStock).trim();
      obj["規格庫存"] = obj.variantStock;
    }
    if (obj.variantStock != null && obj.variantStock !== "") {
      var sum = 0;
      String(obj.variantStock).split(/[,，、\s]+/).forEach(function(s) {
        var n = parseInt(String(s).trim(), 10);
        if (!isNaN(n) && n >= 0) sum += n;
      });
      if (obj.stock == null || obj.stock === "" || obj.stock === undefined) {
        obj.stock = sum;
        obj["庫存"] = sum;
      }
    }
    delete obj.variantStock1;
    delete obj.variantStock2;
    delete obj.variantStock3;
    delete obj.variantStock4;
    if (obj.imageUrl != null && obj.imageUrl !== "" && (obj.image == null || obj.image === "")) {
      obj.image = obj.imageUrl;
    }
    if (obj.stockType != null && obj.stockType !== "") {
      obj.stockType = String(obj.stockType).trim();
      obj["現貨預購"] = obj.stockType;
      obj["貨況"] = obj.stockType;
    }
    if (obj.name || obj["商品名稱"] || obj.title || obj["品名"]) {
      obj._sheetRowIndex = r + 2;
      list.push(obj);
    }
  }
  // 依「角色 + 商品名稱」合併多列為一商品（一商品多規格時試算表常為多列，合併後顧客頁才能顯示全部規格與庫存）
  var byKey = {};
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    var n = (o.name || o["商品名稱"] || o.title || o["品名"] || "").toString().trim();
    var ch = (o.character || o.角色 || "").toString().trim();
    var key = n + "\n" + ch;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(o);
  }
  var mergedList = [];
  for (var k in byKey) {
    var group = byKey[k];
    if (group.length === 0) continue;
    if (group.length === 1) {
      mergedList.push(group[0]);
      continue;
    }
    var base = group[0];
    var allVariantParts = [];
    var allStockParts = [];
    for (var g = 0; g < group.length; g++) {
      var row = group[g];
      var vStr = (row.variant != null && row.variant !== "" ? String(row.variant).trim() : (row.規格 != null ? String(row.規格).trim() : ""));
      var sStr = (row.variantStock != null && row.variantStock !== "" ? String(row.variantStock).trim() : (row["規格庫存"] != null ? String(row["規格庫存"]).trim() : ""));
      var vParts = vStr ? vStr.split(/[,，、\s]+/).map(function(p) { return p.trim(); }).filter(Boolean) : [];
      var sParts = sStr ? sStr.split(/[,，、\s]+/).map(function(p) {
        var num = parseInt(String(p).trim(), 10);
        return isNaN(num) ? "0" : String(Math.max(0, num));
      }) : [];
      if (vParts.length === 0 && sParts.length === 0) continue;
      var len = Math.max(vParts.length, sParts.length, 1);
      for (var idx = 0; idx < len; idx++) {
        allVariantParts.push(vParts[idx] !== undefined ? vParts[idx] : "");
        allStockParts.push(sParts[idx] !== undefined ? sParts[idx] : "0");
      }
    }
    var merged = {};
    for (var prop in base) {
      if (prop !== "variant" && prop !== "variantStock" && prop !== "規格" && prop !== "規格庫存") merged[prop] = base[prop];
    }
    merged.variant = allVariantParts.filter(Boolean).length > 0 ? allVariantParts.map(function(p) { return p || "—"; }).join(", ") : (base.variant || base.規格 || "");
    merged.variantStock = allStockParts.length > 0 ? allStockParts.join(",") : (base.variantStock || base["規格庫存"] || "");
    merged["規格"] = merged.variant;
    merged["規格庫存"] = merged.variantStock;
    var totalMerged = 0;
    (merged.variantStock || "").split(/[,，、\s]+/).forEach(function(s) {
      var n = parseInt(String(s).trim(), 10);
      if (!isNaN(n) && n >= 0) totalMerged += n;
    });
    if (totalMerged > 0 && (merged.stock == null || merged.stock === "")) {
      merged.stock = totalMerged;
      merged["庫存"] = totalMerged;
    }
    merged._sheetRowIndex = base._sheetRowIndex != null ? base._sheetRowIndex : (group[0]._sheetRowIndex);
    mergedList.push(merged);
  }
  for (var m = 0; m < mergedList.length; m++) {
    var item = mergedList[m];
    if (item.variantStock !== undefined && item.variantStock !== null && typeof item.variantStock !== "string") {
      item.variantStock = String(item.variantStock);
      item["規格庫存"] = item.variantStock;
    }
  }
  return mergedList;
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
    ["庫存", "庫存總數", "stock"],
    ["圖片", "圖片URL", "商品主圖", "image", "Image", "imageUrl"],
    ["規格圖片", "variantImages"],
    ["描述", "說明", "content", "description"],
    ["商品介紹", "介紹", "intro", "introduction"],
    ["規格", "顏色", "option", "variant"],
    ["規格1", "variant1"],
    ["規格2", "variant2"],
    ["規格3", "variant3"],
    ["規格4", "variant4"],
    ["規格1庫存", "variantStock1"],
    ["規格2庫存", "variantStock2"],
    ["規格3庫存", "variantStock3"],
    ["規格4庫存", "variantStock4"],
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

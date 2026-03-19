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
  rateColumnName: "匯率",
  // 後台寫入驗證 token（請改成高強度字串，並與 admin.html 的 ADMIN_WRITE_TOKEN 一致）
  adminWriteToken: "CHANGE_ME_TO_A_STRONG_TOKEN_2026",
  // 訂單工作表名稱（不存在會自動建立）
  orderSheetName: "訂單"
};

/**
 * 網頁應用程式進入點。前端用 GET 請求此 URL 取得 JSON。
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
 * POST 進入點。前端用於寫入試算表：append / update / delete / info。
 * 一律回傳 JSON，避免前端收到 HTML 錯誤頁。
 */
function doPost(e) {
  var out = { error: false, message: "" };
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var body = {};
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      out.error = true;
      out.message = "請求內容不是有效 JSON";
      return jsonOutput(out);
    }
    if (!isAuthorizedPost_(body)) {
      out.error = true;
      out.message = "未授權：token 無效";
      return jsonOutput(out);
    }
    var action = (body.action || "").toString().toLowerCase();
    var ss = null;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (ssErr) {
      out.error = true;
      out.message = "無法取得試算表：" + ssErr.toString();
      return jsonOutput(out);
    }
    if (action === "info") {
      var info = getSpreadsheetInfo(ss);
      out.sheetName = info.sheetName;
      out.rowCount = info.rowCount;
      out.message = "已連線";
      return jsonOutput(out);
    }

    // 訂單：list / upsert / delete
    if (action === "order_list" || action === "order_upsert" || action === "order_delete") {
      var orderSheet = getOrderSheet(ss);
      if (!orderSheet) {
        out.error = true;
        out.message = "找不到訂單工作表";
        return jsonOutput(out);
      }
      if (action === "order_list") {
        out.orders = getOrders(orderSheet);
        out.message = "OK";
        return jsonOutput(out);
      }
      if (action === "order_delete") {
        var delId = (body && body.id != null) ? String(body.id).trim() : "";
        if (!delId) {
          out.error = true;
          out.message = "缺少訂單編號 id";
          return jsonOutput(out);
        }
        var deleted = deleteOrderById(orderSheet, delId);
        out.message = deleted ? ("已刪除訂單 " + delId) : ("找不到訂單 " + delId);
        return jsonOutput(out);
      }
      var order = body.order;
      if (!order || typeof order !== "object") {
        out.error = true;
        out.message = "缺少 order 資料";
        return jsonOutput(out);
      }
      var upId = (order.id != null) ? String(order.id).trim() : "";
      if (!upId) {
        out.error = true;
        out.message = "訂單缺少 id";
        return jsonOutput(out);
      }
      upsertOrder(orderSheet, order);
      out.message = "已寫入訂單 " + upId;
      return jsonOutput(out);
    }

    var sheet = getProductSheet(ss);
    if (!sheet) {
      out.error = true;
      out.message = "找不到商品工作表";
      return jsonOutput(out);
    }
    if (action === "delete") {
      var rowIndex = body.rowIndex;
      if (rowIndex == null || rowIndex === "") {
        out.error = true;
        out.message = "缺少列號 rowIndex";
        return jsonOutput(out);
      }
      var rowNum = parseInt(rowIndex, 10);
      if (isNaN(rowNum) || rowNum < 2) {
        out.error = true;
        out.message = "列號無效，必須為 2 以上";
        return jsonOutput(out);
      }
      var maxRow = sheet.getLastRow();
      if (rowNum > maxRow) {
        out.error = true;
        out.message = "列號超出試算表範圍（最大列 " + maxRow + "）";
        return jsonOutput(out);
      }
      sheet.deleteRow(rowNum);
      out.message = "已刪除第 " + rowNum + " 列";
      return jsonOutput(out);
    }
    if (action === "append" || action === "update") {
      var product = body.product;
      if (!product || typeof product !== "object") {
        out.error = true;
        out.message = "缺少 product 資料";
        return jsonOutput(out);
      }
      var row = buildRowFromProduct(sheet, product);
      if (action === "update") {
        var rowIndexUpdate = body.rowIndex;
        if (rowIndexUpdate == null || rowIndexUpdate === "") {
          out.error = true;
          out.message = "缺少列號 rowIndex";
          return jsonOutput(out);
        }
        var rowNumUpdate = parseInt(rowIndexUpdate, 10);
        if (isNaN(rowNumUpdate) || rowNumUpdate < 2) {
          out.error = true;
          out.message = "列號無效，必須為 2 以上";
          return jsonOutput(out);
        }
        var maxRowUpdate = sheet.getLastRow();
        if (rowNumUpdate > maxRowUpdate) {
          out.error = true;
          out.message = "列號超出試算表範圍（最大列 " + maxRowUpdate + "）";
          return jsonOutput(out);
        }
        var numCols = row.length;
        if (numCols > 0) {
          sheet.getRange(rowNumUpdate, 1, 1, numCols).setValues([row]);
        }
        out.message = "已更新第 " + rowNumUpdate + " 列";
        return jsonOutput(out);
      }
      sheet.appendRow(row);
      out.message = "已新增一列";
      return jsonOutput(out);
    }
    out.error = true;
    out.message = "不支援的 action：" + (body.action || "(空)");
    return jsonOutput(out);
  } catch (err) {
    Logger.log(err);
    out.error = true;
    out.message = err.toString();
    return jsonOutput(out);
  }
}

function isAuthorizedPost_(body) {
  var expected = (CONFIG.adminWriteToken || "").toString().trim();
  if (!expected) return false;
  var actual = (body && body.token != null) ? String(body.token).trim() : "";
  return actual === expected;
}

function getOrderSheet(ss) {
  var name = CONFIG.orderSheetName || "訂單";
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  ensureOrderHeaderRow_(sheet);
  return sheet;
}

function ensureOrderHeaderRow_(sheet) {
  var headers = [
    "訂單編號",
    "狀態",
    "日期",
    "客戶姓名",
    "電話",
    "Email",
    "Line ID",
    "運送方式",
    "門市",
    "店號",
    "地址",
    "小計",
    "折扣",
    "運費",
    "運費狀態",
    "預購訂金",
    "總計",
    "備註",
    "收訂金歷程記錄",
    "預購日期",
    "出貨日期",
    "品項(JSON)"
  ];
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  var row1 = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  var existing = row1.map(function(h) { return (h || "").toString().trim(); }).filter(Boolean);
  if (!existing.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  // 若已有表頭，則保持不動（避免覆蓋使用者自訂欄位順序）
}

function getOrderHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var row1 = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return row1.map(function(h) { return (h || "").toString().trim(); });
}

function orderKeyMap_(headers) {
  var map = {};
  var aliases = [
    ["訂單編號", "id", "ID"],
    ["狀態", "status"],
    ["日期", "date"],
    ["客戶姓名", "customerName", "姓名", "name"],
    ["電話", "phone"],
    ["Email", "email"],
    ["Line ID", "lineId", "LineID", "line id"],
    ["運送方式", "shippingMethod"],
    ["門市", "storeName"],
    ["店號", "storeId"],
    ["地址", "address"],
    ["小計", "subtotal"],
    ["折扣", "discount"],
    ["運費", "shippingFee"],
    ["運費狀態", "shippingStatus"],
    ["預購訂金", "depositAmount"],
    ["總計", "total"],
    ["備註", "remark"],
    ["收訂金歷程記錄", "depositRemark"],
    ["預購日期", "preorderDate"],
    ["出貨日期", "shipDate"],
    ["品項(JSON)", "itemsJson", "items"]
  ];
  for (var c = 0; c < headers.length; c++) {
    var h = (headers[c] || "").toString().trim();
    if (!h) continue;
    for (var a = 0; a < aliases.length; a++) {
      var group = aliases[a];
      for (var g = 0; g < group.length; g++) {
        if (h === group[g] || h.toLowerCase() === String(group[g]).toLowerCase()) {
          map[c] = group[group.length - 1];
          break;
        }
      }
      if (map[c]) break;
    }
  }
  return map;
}

function normalizeOrderForSheet_(order) {
  var o = order || {};
  var id = (o.id != null) ? String(o.id).trim() : "";
  var out = {
    id: id,
    status: (o.status != null && String(o.status).trim() !== "") ? String(o.status).trim() : "",
    date: (o.date != null) ? String(o.date) : "",
    customerName: (o.customerName != null) ? String(o.customerName) : "",
    phone: (o.phone != null) ? String(o.phone) : "",
    email: (o.email != null) ? String(o.email) : "",
    lineId: (o.lineId != null) ? String(o.lineId) : "",
    shippingMethod: (o.shippingMethod != null) ? String(o.shippingMethod) : "",
    storeName: (o.storeName != null) ? String(o.storeName) : "",
    storeId: (o.storeId != null) ? String(o.storeId) : "",
    address: (o.address != null) ? String(o.address) : "",
    subtotal: (o.subtotal != null && o.subtotal !== "") ? Number(o.subtotal) : "",
    discount: (o.discount != null && o.discount !== "") ? Number(o.discount) : "",
    shippingFee: (o.shippingFee != null && o.shippingFee !== "") ? Number(o.shippingFee) : "",
    shippingStatus: (o.shippingStatus != null) ? String(o.shippingStatus) : "",
    depositAmount: (o.depositAmount != null && o.depositAmount !== "") ? Number(o.depositAmount) : "",
    total: (o.total != null && o.total !== "") ? Number(o.total) : "",
    remark: (o.remark != null) ? String(o.remark) : "",
    depositRemark: (o.depositRemark != null) ? String(o.depositRemark) : "",
    preorderDate: (o.preorderDate != null) ? String(o.preorderDate) : "",
    shipDate: (o.shipDate != null) ? String(o.shipDate) : "",
    itemsJson: ""
  };
  try {
    if (o.items != null) out.itemsJson = JSON.stringify(o.items);
  } catch (e) {
    out.itemsJson = "";
  }
  return out;
}

function findOrderRowById_(sheet, id, headers) {
  var safeId = (id || "").toString().trim();
  if (!safeId) return -1;
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return -1;
  var idCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = (headers[c] || "").toString().trim();
    if (h === "訂單編號") { idCol = c; break; }
  }
  if (idCol < 0) idCol = 0;
  for (var r = 1; r < data.length; r++) {
    var v = data[r][idCol];
    if (v != null && String(v).trim() === safeId) return r + 1; // 1-indexed row
  }
  return -1;
}

function buildRowFromOrder_(sheet, order) {
  var headers = getOrderHeaders_(sheet);
  var keyMap = orderKeyMap_(headers);
  var norm = normalizeOrderForSheet_(order);
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    var val = "";
    if (key === "items") key = "itemsJson";
    if (key && norm[key] !== undefined && norm[key] !== null && norm[key] !== "") val = norm[key];
    row.push(val);
  }
  return row;
}

function upsertOrder(sheet, order) {
  ensureOrderHeaderRow_(sheet);
  var headers = getOrderHeaders_(sheet);
  var id = (order && order.id != null) ? String(order.id).trim() : "";
  if (!id) return;
  var row = buildRowFromOrder_(sheet, order);
  var existingRow = findOrderRowById_(sheet, id, headers);
  if (existingRow >= 2) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteOrderById(sheet, id) {
  ensureOrderHeaderRow_(sheet);
  var headers = getOrderHeaders_(sheet);
  var row = findOrderRowById_(sheet, id, headers);
  if (row >= 2) {
    sheet.deleteRow(row);
    return true;
  }
  return false;
}

function getOrders(sheet) {
  ensureOrderHeaderRow_(sheet);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var keyMap = orderKeyMap_(headers);
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = keyMap[c];
      if (!key) continue;
      var val = row[c];
      if (val === "" || val === null || val === undefined) continue;
      if (key === "items") key = "itemsJson";
      obj[key] = val;
    }
    var id = (obj.id != null) ? String(obj.id).trim() : "";
    if (!id) continue;
    // itemsJson → items
    if (obj.itemsJson != null && String(obj.itemsJson).trim() !== "") {
      try {
        var parsed = JSON.parse(String(obj.itemsJson));
        if (parsed && typeof parsed === "object") obj.items = parsed;
      } catch (e) {
        // ignore parse error
      }
    }
    delete obj.itemsJson;
    list.push(obj);
  }
  // 依日期由新到舊（無日期則置底）
  list.sort(function(a, b) {
    var ad = a.date ? new Date(a.date).getTime() : 0;
    var bd = b.date ? new Date(b.date).getTime() : 0;
    if (!isFinite(ad)) ad = 0;
    if (!isFinite(bd)) bd = 0;
    return bd - ad;
  });
  return list;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getProductSheet(ss) {
  var name = CONFIG.sheetName;
  if (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  var sheets = ss.getSheets();
  return sheets.length > 0 ? sheets[0] : null;
}

function getSpreadsheetInfo(ss) {
  var sheet = getProductSheet(ss);
  var sheetName = sheet ? sheet.getName() : "";
  var rowCount = sheet ? sheet.getLastRow() : 0;
  return { sheetName: sheetName, rowCount: rowCount };
}

/**
 * 依工作表第一列標題，將 product 物件轉成與欄位對應的一列陣列；並補上庫存、規格庫存。
 */
function buildRowFromProduct(sheet, product) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 1) return [];
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var keyMap = buildKeyMap(headers);
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    var val = "";
    if (key && product[key] !== undefined && product[key] !== null && product[key] !== "") {
      val = product[key];
    }
    row.push(val);
  }
  // 與 getProducts 一致：用 keyMap 找欄位，試算表標題用中文或英文都能正確寫入（key 可能為 stock 或 Stock）
  var stockCol = -1;
  var variantCol = -1;
  var statusCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var key = keyMap[i];
    if (key && (key === "stock" || key.toLowerCase() === "stock")) stockCol = i;
    if (key === "variantStock") variantCol = i;
    if (key === "status") statusCol = i;
  }
  if (statusCol >= 0) {
    var statusVal = (product.status !== undefined && product.status !== null && String(product.status).trim() !== "") ? String(product.status).trim() : "上架";
    row[statusCol] = (statusVal === "下架") ? "下架" : "上架";
  }
  if (variantCol >= 0) {
    row[variantCol] = (product.variantStock !== undefined && product.variantStock !== null) ? String(product.variantStock).trim() : "";
  }
  if (stockCol >= 0) {
    // 庫存總和：有規格庫存時為各規格數量加總，否則用表單的庫存欄位
    var total = 0;
    var variantStockStr = (product.variantStock !== undefined && product.variantStock !== null) ? String(product.variantStock).trim() : "";
    if (variantStockStr !== "") {
      var parts = variantStockStr.split(/[,，、\s]+/);
      for (var p = 0; p < parts.length; p++) {
        var num = parseInt(parts[p], 10);
        if (!isNaN(num)) total += num;
      }
    } else {
      var stockVal = product.stock !== undefined && product.stock !== null && product.stock !== "" ? product.stock : (product.Stock !== undefined && product.Stock !== null && product.Stock !== "" ? product.Stock : null);
      if (stockVal !== null) {
        var n = Number(stockVal);
        if (isFinite(n)) total = n;
      }
    }
    row[stockCol] = total;
  }
  return row;
}

/**
 * 從試算表組出前端要的 { products: [...], rate: number, characterImages: {} }。
 */
function getApiData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rate = getRate(ss);
  var products = getProducts(ss);
  var characterImages = getCharacterImages(ss);
  return {
    rate: rate,
    products: products,
    characterImages: characterImages
  };
}

/**
 * 從試算表讀取角色對應圖片。
 * 優先使用名為「角色」或「角色圖片」的工作表，否則用第二張工作表。
 * 預期格式：第一列標題含「角色」/「角色名稱」與「圖片」/「圖片URL」；第二列起為角色名稱與圖片網址。
 * 回傳 { "角色名": "圖片URL", ... }，例如 { "全部": "https://...", "凱蒂貓": "https://..." }。
 */
function getCharacterImages(ss) {
  var sheet = ss.getSheetByName("角色") || ss.getSheetByName("角色圖片");
  if (!sheet) {
    var sheets = ss.getSheets();
    if (!sheets || sheets.length < 2) return {};
    sheet = sheets[1];
  }
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return {};
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var roleCol = -1;
  var imgCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = (headers[i] || "").toLowerCase();
    if (h === "角色" || h === "角色名稱" || h === "character" || h === "name" || h.indexOf("角色") >= 0) roleCol = i;
    if (h === "圖片" || h === "圖片url" || h === "image" || h === "圖片網址" || h.indexOf("圖片") >= 0) imgCol = i;
  }
  if (roleCol < 0 && headers.length >= 1) roleCol = 0;
  if (imgCol < 0 && headers.length >= 2) imgCol = 1;
  if (roleCol < 0 || imgCol < 0) return {};
  var out = {};
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = (row[roleCol] != null && row[roleCol] !== "") ? String(row[roleCol]).trim() : "";
    var url = (row[imgCol] != null && row[imgCol] !== "") ? String(row[imgCol]).trim() : "";
    if (name && url) out[name] = url;
  }
  return out;
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
      if (key === "status") {
        obj.status = (val !== "" && val !== null && val !== undefined && String(val).trim() === "下架") ? "下架" : "上架";
      } else if (val !== "" && val !== null && val !== undefined) {
        obj[key] = val;
      }
    }
    if (obj.name || obj["商品名稱"] || obj.title || obj["品名"]) {
      obj._rowIndex = r + 1;
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
    ["圖片", "圖片URL", "Image", "imageUrl", "商品主圖", "主圖", "image"],
    ["描述", "說明", "content", "description"],
    ["商品介紹", "介紹", "intro", "introduction"],
    ["規格", "顏色", "option", "variant"],
    ["分類", "category"],
    ["子分類", "subcategory"],
    ["角色", "character"],
    ["售價", "售價(TW)", "sellingPrice"],
    ["顧客顯示售價", "customerDisplayPrice"],
    ["利潤", "profit"],
    ["成本", "成本(台幣)", "Cost", "cost"],
    ["狀態", "上架狀態", "status", "Status"],
    ["貨況", "stockType"],
    ["庫存", "庫存數量", "stock", "Stock"],
    ["規格庫存", "規格庫存數量", "variantStock"],
    ["規格圖片", "variantImages"],
    ["熱銷", "hot"],
    ["推薦", "recommended"],
    ["新品", "isNew"],
    ["新上架", "isNewListing"],
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
  for (var c = 0; c < headers.length; c++) {
    if (map[c]) continue;
    var h = (headers[c] || "").toString().trim();
    if (h.indexOf("成本") >= 0) map[c] = "cost";
    else if (h.indexOf("利潤") >= 0) map[c] = "profit";
    else if (h.indexOf("狀態") >= 0) map[c] = "status";
  }
  return map;
}

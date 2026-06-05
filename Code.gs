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
  orderSheetName: "訂單",
  pointsSheetName: "紅利紀錄"
};

/**
 * 網頁應用程式進入點。前端用 GET 請求此 URL 取得 JSON。
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || "").toString().toLowerCase().trim();
    if (action === "points_balance") {
      return jsonOutput(getPointsBalancePublic_(params));
    }
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

    // 紅利紀錄：list / sync
    if (action === "points_list" || action === "points_sync") {
      var pointsSheet = getPointsSheet(ss);
      if (!pointsSheet) {
        out.error = true;
        out.message = "找不到紅利紀錄工作表";
        return jsonOutput(out);
      }
      if (action === "points_list") {
        out.ledger = getPointsLedger(pointsSheet);
        out.message = "OK";
        return jsonOutput(out);
      }
      var ledger = body.ledger;
      if (!ledger || !Array.isArray(ledger)) {
        out.error = true;
        out.message = "缺少 ledger 陣列";
        return jsonOutput(out);
      }
      syncPointsLedger(pointsSheet, ledger);
      out.message = "已同步 " + ledger.length + " 筆紅利紀錄";
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
        var merged = mergeRowFromProduct_(sheet, rowNumUpdate, product);
        var numCols = merged.length;
        if (numCols > 0) {
          sheet.getRange(rowNumUpdate, 1, 1, numCols).setValues([merged]);
        }
        out.message = "已更新第 " + rowNumUpdate + " 列";
        out.rowIndex = rowNumUpdate;
        return jsonOutput(out);
      }
      var row = buildRowFromProduct(sheet, product);
      sheet.appendRow(row);
      out.message = "已新增一列";
      out.rowIndex = sheet.getLastRow();
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
  var name = (CONFIG.orderSheetName || "訂單").toString().trim();
  var sheet = ss.getSheetByName(name);
  // 允許分頁名稱有前後空白或含「訂單」字樣
  if (!sheet) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var s = sheets[i];
      var n = (s.getName() || "").toString().trim();
      if (n === name || n.indexOf("訂單") >= 0) {
        sheet = s;
        break;
      }
    }
  }
  // 再保底：找第一列含「訂單編號」的分頁
  if (!sheet) {
    var all = ss.getSheets();
    for (var j = 0; j < all.length; j++) {
      var cand = all[j];
      var lastCol = cand.getLastColumn();
      if (lastCol < 1) continue;
      var headers = cand.getRange(1, 1, 1, lastCol).getValues()[0];
      var hasOrderId = headers.some(function(h) { return (h || "").toString().trim() === "訂單編號"; });
      if (hasOrderId) {
        sheet = cand;
        break;
      }
    }
  }
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
    "待結清總金額",
    "備註",
    "收訂金歷程記錄",
    "預購日期",
    "出貨日期",
    "品項(JSON)",
    "使用紅利",
    "獲得紅利",
    "紅利已處理"
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
    ["待結清總金額", "總計", "total"],
    ["備註", "remark"],
    ["收訂金歷程記錄", "depositRemark"],
    ["預購日期", "preorderDate"],
    ["出貨日期", "shipDate"],
    ["品項(JSON)", "itemsJson", "items"],
    ["使用紅利", "pointsUsed"],
    ["獲得紅利", "pointsEarned"],
    ["紅利已處理", "pointsProcessed"]
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
    pointsUsed: (o.pointsUsed != null && o.pointsUsed !== "") ? Number(o.pointsUsed) : "",
    pointsEarned: (o.pointsEarned != null && o.pointsEarned !== "") ? Number(o.pointsEarned) : "",
    pointsProcessed: (o.pointsProcessed != null) ? String(o.pointsProcessed) : "",
    itemsJson: ""
  };
  try {
    if (o.items != null) out.itemsJson = JSON.stringify(o.items);
  } catch (e) {
    out.itemsJson = "";
  }
  return out;
}

function getOrderIdColumns_(headers) {
  var cols = [];
  for (var c = 0; c < headers.length; c++) {
    var h = (headers[c] || "").toString().trim();
    if (!h) continue;
    var hl = h.toLowerCase();
    if (h === "訂單編號" || hl === "id" || hl === "orderid" || h.indexOf("訂單編號") >= 0) cols.push(c);
  }
  if (cols.length === 0) cols.push(0);
  return cols;
}

function normalizeOrderId_(v) {
  if (v == null) return "";
  // 去除前後空白與中間空白，統一大寫，並盡量規範成 ORD+5碼
  var s = String(v).trim().replace(/\s+/g, "").toUpperCase();
  var m = s.match(/^ORD(\d+)$/);
  if (m) {
    var n = parseInt(m[1], 10);
    if (!isNaN(n) && n >= 0) return "ORD" + ("00000" + n).slice(-5);
    return s;
  }
  if (/^\d+$/.test(s)) {
    var n2 = parseInt(s, 10);
    if (!isNaN(n2) && n2 >= 0) return "ORD" + ("00000" + n2).slice(-5);
  }
  return s;
}

function findOrderRowsById_(sheet, id, headers) {
  var safeId = normalizeOrderId_(id);
  if (!safeId) return [];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var idCols = getOrderIdColumns_(headers);
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    for (var i = 0; i < idCols.length; i++) {
      var col = idCols[i];
      var v = data[r][col];
      if (normalizeOrderId_(v) === safeId) {
        rows.push(r + 1); // 1-indexed row
        break;
      }
    }
  }
  return rows;
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
  // 強制回填訂單編號欄，避免表頭別名不一致導致 id 空值
  var idCols = getOrderIdColumns_(headers);
  for (var i = 0; i < idCols.length; i++) {
    row[idCols[i]] = norm.id;
  }
  return row;
}

function upsertOrder(sheet, order) {
  ensureOrderHeaderRow_(sheet);
  var headers = getOrderHeaders_(sheet);
  var id = normalizeOrderId_(order && order.id != null ? order.id : "");
  if (!id) return;
  // 寫入統一為標準格式，避免 ORD1 / ORD00001 造成重複列
  if (order && order.id != null) order.id = id;
  var row = buildRowFromOrder_(sheet, order);
  var existingRows = findOrderRowsById_(sheet, id, headers);
  if (existingRows.length > 0) {
    var keepRow = existingRows[0];
    sheet.getRange(keepRow, 1, 1, row.length).setValues([row]);
    // 若有重複訂單編號，保留第一筆、刪除其餘
    if (existingRows.length > 1) {
      var toDelete = existingRows.slice(1).sort(function(a, b) { return b - a; });
      for (var i = 0; i < toDelete.length; i++) {
        sheet.deleteRow(toDelete[i]);
      }
    }
  } else {
    sheet.appendRow(row);
  }
}

function deleteOrderById(sheet, id) {
  ensureOrderHeaderRow_(sheet);
  var headers = getOrderHeaders_(sheet);
  var rows = findOrderRowsById_(sheet, id, headers);
  if (!rows.length) return false;
  rows.sort(function(a, b) { return b - a; });
  for (var i = 0; i < rows.length; i++) {
    sheet.deleteRow(rows[i]);
  }
  return true;
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

/** 統一欄位 key（Stock → stock） */
function canonicalFieldKey_(key) {
  if (!key) return key;
  if (String(key).toLowerCase() === "stock") return "stock";
  return key;
}

/** 只保留純數字 token，過濾日期（2026-03-07）、子分類（2025年03月）等誤寫 */
function sanitizeVariantStockString_(str) {
  if (str === undefined || str === null || String(str).trim() === "") return "";
  var parts = String(str).trim().split(/[,，、\s]+/);
  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i].trim();
    if (/^\d+$/.test(t)) nums.push(t);
  }
  return nums.join(", ");
}

/** 只加總純數字的規格庫存 token，避免「2025年03月」被 parseInt 誤判為 2025 */
function sumVariantStockStrict_(str) {
  var clean = sanitizeVariantStockString_(str);
  if (clean === "") return null;
  var parts = clean.split(/[,，、\s]+/);
  var total = 0;
  for (var i = 0; i < parts.length; i++) {
    total += parseInt(parts[i], 10);
  }
  return total;
}

/** 讀取後正規化庫存：合併 Stock/stock/庫存，清除規格庫存中的日期雜訊 */
function normalizeProductStockFields_(obj) {
  if (!obj || typeof obj !== "object") return obj;
  var rawStock = obj.stock;
  if ((rawStock === undefined || rawStock === null || rawStock === "") && obj.Stock !== undefined && obj.Stock !== null && obj.Stock !== "") {
    rawStock = obj.Stock;
  }
  if ((rawStock === undefined || rawStock === null || rawStock === "") && obj.庫存 !== undefined && obj.庫存 !== null && obj.庫存 !== "") {
    rawStock = obj.庫存;
  }
  var vsRaw = obj.variantStock != null ? obj.variantStock : (obj.規格庫存 != null ? obj.規格庫存 : "");
  var cleanVs = sanitizeVariantStockString_(vsRaw);
  if (cleanVs) {
    obj.variantStock = cleanVs;
    obj.規格庫存 = cleanVs;
    var sum = sumVariantStockStrict_(cleanVs);
    if (sum !== null) {
      obj.stock = sum;
      obj.Stock = sum;
      obj.庫存 = sum;
    }
  } else if (rawStock !== undefined && rawStock !== null && rawStock !== "") {
    var n = Number(rawStock);
    if (isFinite(n)) {
      obj.stock = n;
      obj.Stock = n;
      obj.庫存 = n;
    }
  }
  return obj;
}

/** 試算表 Date 以腳本時區輸出 yyyy-MM-dd，避免 UTC 差一天 */
function formatSheetDateLocal_(d) {
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function isSheetDate_(val) {
  return val instanceof Date && !isNaN(val.getTime());
}

/**
 * 更新既有列：保留試算表原有欄位，只覆寫 product 物件中有帶的 key（避免未對應欄位被清空）。
 */
function mergeRowFromProduct_(sheet, rowNum, product) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = headerRow.map(function(h) { return (h || "").toString().trim(); });
  var keyMap = buildKeyMap(headers);
  var existingRow = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  var row = existingRow.slice();
  var hasKey = function(k) {
    return product && Object.prototype.hasOwnProperty.call(product, k);
  };

  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    if (!key || !hasKey(key)) continue;
    var val = product[key];
    row[c] = (val !== undefined && val !== null) ? val : "";
  }

  var stockCols = [];
  var variantCol = -1;
  var statusCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var km = keyMap[i];
    if (km && String(km).toLowerCase() === "stock") stockCols.push(i);
    if (km === "variantStock") variantCol = i;
    if (km === "status") statusCol = i;
  }
  if (statusCol >= 0 && hasKey("status")) {
    var statusVal = (product.status !== undefined && product.status !== null && String(product.status).trim() !== "") ? String(product.status).trim() : "上架";
    row[statusCol] = (statusVal === "下架") ? "下架" : "上架";
  }
  var cleanVariantStock = hasKey("variantStock")
    ? sanitizeVariantStockString_(product.variantStock)
    : "";
  if (variantCol >= 0 && hasKey("variantStock")) {
    row[variantCol] = cleanVariantStock;
  }
  if (stockCols.length > 0 && (hasKey("stock") || hasKey("variantStock"))) {
    var total = 0;
    if (cleanVariantStock !== "") {
      var strictSum = sumVariantStockStrict_(cleanVariantStock);
      if (strictSum !== null) total = strictSum;
    } else if (hasKey("stock")) {
      var stockVal = product.stock !== undefined && product.stock !== null && product.stock !== ""
        ? product.stock
        : (product.Stock !== undefined && product.Stock !== null && product.Stock !== "" ? product.Stock : null);
      if (stockVal !== null) {
        var n = Number(stockVal);
        if (isFinite(n)) total = n;
      }
    }
    for (var sc = 0; sc < stockCols.length; sc++) {
      row[stockCols[sc]] = total;
    }
  }
  return row;
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
    if (key && product[key] !== undefined && product[key] !== null) {
      val = product[key];
    }
    row.push(val);
  }
  // 與 getProducts 一致：用 keyMap 找欄位，試算表標題用中文或英文都能正確寫入（key 可能為 stock 或 Stock）
  var stockCols = [];
  var variantCol = -1;
  var statusCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var key = keyMap[i];
    if (key && String(key).toLowerCase() === "stock") stockCols.push(i);
    if (key === "variantStock") variantCol = i;
    if (key === "status") statusCol = i;
  }
  if (statusCol >= 0) {
    var statusVal = (product.status !== undefined && product.status !== null && String(product.status).trim() !== "") ? String(product.status).trim() : "上架";
    row[statusCol] = (statusVal === "下架") ? "下架" : "上架";
  }
  var cleanVariantStock2 = sanitizeVariantStockString_(product.variantStock);
  if (variantCol >= 0) {
    row[variantCol] = cleanVariantStock2;
  }
  if (stockCols.length > 0) {
    var total2 = 0;
    if (cleanVariantStock2 !== "") {
      var strictSum2 = sumVariantStockStrict_(cleanVariantStock2);
      if (strictSum2 !== null) total2 = strictSum2;
    } else {
      var stockVal2 = product.stock !== undefined && product.stock !== null && product.stock !== ""
        ? product.stock
        : (product.Stock !== undefined && product.Stock !== null && product.Stock !== "" ? product.Stock : null);
      if (stockVal2 !== null) {
        var n2 = Number(stockVal2);
        if (isFinite(n2)) total2 = n2;
      }
    }
    for (var sc2 = 0; sc2 < stockCols.length; sc2++) {
      row[stockCols[sc2]] = total2;
    }
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
    characterImages: characterImages,
    serverTime: new Date().getTime(),
    nonce: Utilities.getUuid()
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
      } else if (isSheetDate_(val)) {
        obj[key] = formatSheetDateLocal_(val);
      } else if (val !== "" && val !== null && val !== undefined) {
        obj[key] = val;
      }
    }
    if (obj.name || obj["商品名稱"] || obj.title || obj["品名"]) {
      obj._rowIndex = r + 1;
      normalizeProductStockFields_(obj);
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
    ["規格售價", "規格台幣售價", "variantPrices"],
    ["規格維度1名稱", "variantDim1Label"],
    ["規格維度1選項", "variantDim1Options"],
    ["規格維度2名稱", "variantDim2Label"],
    ["規格維度2選項", "variantDim2Options"],
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
          map[c] = canonicalFieldKey_(group[group.length - 1]);
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
    else if (h.indexOf("規格") >= 0 && h.indexOf("庫存") >= 0) map[c] = "variantStock";
    else if (h.indexOf("規格") >= 0 && h.indexOf("售價") >= 0) map[c] = "variantPrices";
    else if (h.indexOf("庫存") >= 0) map[c] = "stock";
  }
  return map;
}

function getPointsSheet(ss) {
  var name = (CONFIG.pointsSheetName || "紅利紀錄").toString().trim();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      var n = (all[i].getName() || "").toString().trim();
      if (n === name || n.indexOf("紅利") >= 0) {
        sheet = all[i];
        break;
      }
    }
  }
  if (!sheet) sheet = ss.insertSheet(name);
  ensurePointsHeaderRow_(sheet);
  return sheet;
}

function ensurePointsHeaderRow_(sheet) {
  var headers = [
    "紀錄ID",
    "日期",
    "電話",
    "Line ID",
    "姓名",
    "類型",
    "點數",
    "剩餘",
    "到期日",
    "訂單編號",
    "備註"
  ];
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function normalizePointRecordForSheet_(rec) {
  var r = rec || {};
  return {
    id: (r.id != null) ? String(r.id).trim() : "",
    date: (r.date != null) ? String(r.date) : "",
    phone: (r.phone != null) ? String(r.phone) : "",
    lineId: (r.lineId != null) ? String(r.lineId) : "",
    customerName: (r.customerName != null) ? String(r.customerName) : "",
    type: (r.type != null) ? String(r.type) : "",
    points: (r.points != null && r.points !== "") ? Number(r.points) : "",
    remaining: (r.remaining != null && r.remaining !== "") ? Number(r.remaining) : "",
    expireDate: (r.expireDate != null) ? String(r.expireDate) : "",
    orderId: (r.orderId != null) ? String(r.orderId) : "",
    note: (r.note != null) ? String(r.note) : ""
  };
}

function pointsKeyMap_(headers) {
  var map = {};
  var aliases = [
    ["紀錄ID", "id"],
    ["日期", "date"],
    ["電話", "phone"],
    ["Line ID", "lineId"],
    ["姓名", "customerName"],
    ["類型", "type"],
    ["點數", "points"],
    ["剩餘", "remaining"],
    ["到期日", "expireDate"],
    ["訂單編號", "orderId"],
    ["備註", "note"]
  ];
  for (var c = 0; c < headers.length; c++) {
    var h = (headers[c] || "").toString().trim();
    if (!h) continue;
    for (var a = 0; a < aliases.length; a++) {
      var group = aliases[a];
      for (var g = 0; g < group.length; g++) {
        if (h === group[g]) {
          map[c] = group[group.length - 1];
          break;
        }
      }
      if (map[c]) break;
    }
  }
  return map;
}

function buildRowFromPointRecord_(sheet, rec) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return (h || "").toString().trim(); });
  var keyMap = pointsKeyMap_(headers);
  var norm = normalizePointRecordForSheet_(rec);
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    var val = "";
    if (key && norm[key] !== undefined && norm[key] !== null && norm[key] !== "") val = norm[key];
    row.push(val);
  }
  return row;
}

function normalizeSheetDateValue_(val) {
  if (val == null || val === "") return "";
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "Asia/Taipei", "yyyy-MM-dd");
  }
  var s = String(val).trim();
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function normalizePointLedgerRecord_(obj) {
  if (!obj) return obj;
  if (obj.date != null && obj.date !== "") obj.date = normalizeSheetDateValue_(obj.date);
  if (obj.expireDate != null && obj.expireDate !== "") obj.expireDate = normalizeSheetDateValue_(obj.expireDate);
  if (obj.customerName != null) obj.customerName = String(obj.customerName).trim();
  if (obj.type != null) obj.type = String(obj.type).trim();
  if (obj.remaining != null && obj.remaining !== "") obj.remaining = Number(obj.remaining);
  if (obj.points != null && obj.points !== "") obj.points = Number(obj.points);
  return obj;
}

function getPointsLedger(sheet) {
  ensurePointsHeaderRow_(sheet);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var keyMap = pointsKeyMap_(headers);
  var list = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      var key = keyMap[c];
      if (!key) continue;
      var val = row[c];
      if (val === "" || val === null || val === undefined) continue;
      obj[key] = val;
      empty = false;
    }
    if (empty || !obj.id) continue;
    list.push(normalizePointLedgerRecord_(obj));
  }
  return list;
}

function syncPointsLedger(sheet, ledger) {
  ensurePointsHeaderRow_(sheet);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return (h || "").toString().trim(); });
  var colCount = headers.length;
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  if (!ledger || !ledger.length) return;
  var rows = [];
  for (var i = 0; i < ledger.length; i++) {
    rows.push(buildRowFromPointRecord_(sheet, ledger[i]));
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, colCount).setValues(rows);
  }
}

/** 顧客端公開查詢：依客戶姓名回傳可用紅利餘額（唯讀，不含完整異動明細） */
function normalizeCustomerNameForPoints_(name) {
  return String(name || "").trim().replace(/\s+/g, "");
}

function todayStrForPoints_() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

function getPointRecordCustomerName_(rec) {
  if (!rec) return "";
  if (rec.customerName != null && String(rec.customerName).trim() !== "") return String(rec.customerName);
  if (rec["姓名"] != null && String(rec["姓名"]).trim() !== "") return String(rec["姓名"]);
  return "";
}

function recordMatchesCustomerForPoints_(rec, customerName) {
  var n = normalizeCustomerNameForPoints_(customerName);
  if (!n) return false;
  return normalizeCustomerNameForPoints_(getPointRecordCustomerName_(rec)) === n;
}

function isActivePointLot_(rec, today) {
  var type = (rec.type || "").toString().trim();
  if (type !== "發放" && type !== "調整") return false;
  var remaining = Number(rec.remaining);
  if (!remaining || remaining <= 0 || isNaN(remaining)) return false;
  var exp = normalizeSheetDateValue_(rec.expireDate);
  if (!exp) return true;
  return exp >= today;
}

function getActiveLotsForCustomer_(ledger, customerName) {
  var today = todayStrForPoints_();
  var lots = [];
  for (var i = 0; i < ledger.length; i++) {
    var rec = ledger[i];
    if (!recordMatchesCustomerForPoints_(rec, customerName)) continue;
    if (!isActivePointLot_(rec, today)) continue;
    lots.push({
      date: rec.date != null ? normalizeSheetDateValue_(rec.date) : "",
      remaining: Number(rec.remaining) || 0,
      expireDate: normalizeSheetDateValue_(rec.expireDate)
    });
  }
  lots.sort(function(a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  });
  return lots;
}

function getPointsBalancePublic_(params) {
  var name = (params.name || params.customerName || params["姓名"] || "").toString().trim();
  var normalized = normalizeCustomerNameForPoints_(name);
  if (!normalized || normalized.length < 2) {
    return { error: true, message: "請輸入至少兩個字的客戶姓名" };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pointsSheet = getPointsSheet(ss);
  if (!pointsSheet) {
    return { error: true, message: "找不到紅利紀錄工作表" };
  }
  var ledger = getPointsLedger(pointsSheet);
  var lots = getActiveLotsForCustomer_(ledger, name);
  var balance = 0;
  for (var j = 0; j < lots.length; j++) {
    balance += Number(lots[j].remaining) || 0;
  }
  var nextExpireDate = "";
  var nextExpirePoints = 0;
  if (lots.length > 0) {
    nextExpireDate = lots[0].expireDate || "";
    nextExpirePoints = Number(lots[0].remaining) || 0;
  }
  return {
    error: false,
    customerName: name,
    balance: balance,
    pointValue: 1,
    discountAmount: balance,
    nextExpireDate: nextExpireDate,
    nextExpirePoints: nextExpirePoints,
    rules: {
      spendPerPoint: 100,
      pointValue: 1,
      expireDays: 365
    },
    message: balance > 0 ? "OK" : "目前尚無可用紅利點數"
  };
}

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
 *
 * 顧客端 GET action：
 * - points_balance   紅利餘額（card / memberCardNo）
 * - customer_orders  會員卡號歷史訂單
 * - order_status     單筆配送進度（orderId，5 碼或 ORD00001）
 * - （相容）?orderId=00001 同 order_status
 */

var CONFIG = {
  // 商品工作表名稱（留空則用第一個工作表）
  sheetName: "",
  // 若有「匯率」或「設定」工作表，可從這裡讀 rate（欄位名：rate 或 匯率）
  rateSheetName: "設定",
  rateColumnName: "匯率",
  // 後台寫入驗證 token（請改成高強度字串，並與 admin.html 的 ADMIN_WRITE_TOKEN 一致）
  adminWriteToken: "CHANGE_ME_TO_A_STRONG_TOKEN_2026",
  // 訂單工作表：會員卡查詢與後台同步寫入「歷史訂單」（備援「訂單」）
  orderSheetName: "歷史訂單",
  orderSheetFallbackNames: ["訂單", "订单"],
  // 此 GAS 必須部署在 ProductManagement2 試算表（後台寫入用，與訂單進度試算表不同）
  spreadsheetId: "14dqpeCDpKRA8_Ca2b5Phinh00ydPiaBh3MHKrVYMVOI",
  // 顧客訂單進度查詢（五碼編號）優先讀此分頁，搭配「歷程」
  legacyProgressSheetName: "工作表1",
  legacyHistorySheetName: "歷程",
  pointsSheetName: "紅利紀錄"
};

/**
 * 網頁應用程式進入點。前端用 GET 請求此 URL 取得 JSON。
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || "").toString().toLowerCase().trim();
    if (action === "api_meta" || action === "spreadsheet_info") {
      var ssMeta = SpreadsheetApp.getActiveSpreadsheet();
      return jsonOutput({
        ok: true,
        apiVersion: "2026-06-04-sheet1",
        spreadsheetId: ssMeta.getId(),
        spreadsheetName: ssMeta.getName(),
        orderSheetName: (CONFIG.orderSheetName || "歷史訂單"),
        routes: ["points_balance", "customer_orders", "order_status", "orderId_legacy", "sheet1_progress", "spreadsheet_info"],
        postRoutes: ["order_list", "order_upsert", "order_delete", "order_sheet_repair", "points_sync", "append", "update", "delete"]
      });
    }
    if (action === "points_balance") {
      return jsonOutput(getPointsBalancePublic_(params));
    }
    if (action === "customer_orders") {
      return jsonOutput(getCustomerOrdersPublic_(params));
    }
    if (action === "order_status") {
      return jsonOutput(getOrderStatusPublic_(params));
    }
    // 相容舊 Order-status：?orderId=00001（無 action）
    var legacyOrderId = (params.orderId || params.id || params["訂單編號"] || "").toString().trim();
    if (legacyOrderId) {
      return jsonOutput(getOrderStatusPublic_(params));
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
      if (action === "order_sheet_repair") {
        var repaired = repairOrderSheetLayout_(orderSheet, ss);
        if (!repaired) ensureOrderHeaderRow_(orderSheet);
        var list = parseOrdersFromSheetData_(orderSheet);
        list = enrichOrdersMemberCardFromLedger_(list, ss);
        out.message = repaired
          ? ("已修復「" + orderSheet.getName() + "」表頭，共 " + list.length + " 筆訂單")
          : ("表頭正常，共 " + list.length + " 筆訂單");
        out.sheetName = orderSheet.getName();
        out.orderCount = list.length;
        out.repaired = repaired;
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
      out.message = "已寫入訂單 " + upId + " →「" + orderSheet.getName() + "」";
      out.sheetName = orderSheet.getName();
      out.spreadsheetId = ss.getId();
      out.spreadsheetName = ss.getName();
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

function isPointsLedgerSheetName_(name) {
  var n = String(name || "").trim();
  return n.indexOf("紅利") >= 0;
}

function isPointsLedgerHeaders_(headers) {
  var h0 = String((headers && headers[0]) || "").trim();
  return h0 === "紀錄ID" || (h0.indexOf("紀錄") >= 0 && h0.indexOf("訂單") < 0);
}

function isLikelyOrderSheetHeaders_(headers) {
  headers = headers || [];
  var h0 = String(headers[0] || "").trim();
  if (h0 === "訂單編號") return true;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim();
    if (h.indexOf("品項") >= 0 || h === "小計" || h === "客戶姓名" || h === "待結清總金額") return true;
  }
  return false;
}

function sheetHasOrderIdHeader_(headers) {
  for (var h = 0; h < (headers || []).length; h++) {
    var t = String(headers[h] || "").trim();
    if (t === "訂單編號" || t.indexOf("訂單編號") >= 0) return true;
  }
  return false;
}

function scoreOrderSheetCandidate_(sheet) {
  if (!sheet) return -1;
  var sname = String(sheet.getName() || "").trim();
  if (isPointsLedgerSheetName_(sname)) return -1;
  var headers = getOrderHeaders_(sheet);
  if (isPointsLedgerHeaders_(headers)) return -1;
  if (!sheetHasOrderIdHeader_(headers) && !isLikelyOrderSheetHeaders_(headers)) return -1;
  var score = 0;
  if (String(headers[0] || "").trim() === "訂單編號") score += 20;
  if (isLikelyOrderSheetHeaders_(headers)) score += 10;
  if (sname.indexOf("歷史") >= 0 && sname.indexOf("訂單") >= 0) score += 12;
  if (sname === (CONFIG.orderSheetName || "歷史訂單")) score += 15;
  if (sname.indexOf("訂單") >= 0 && sname.indexOf("紅利") < 0) score += 8;
  score += Math.min(Math.max(0, sheet.getLastRow() - 1), 200);
  return score;
}

/** 後台訂單讀寫分頁：優先「歷史訂單」，排除「紅利紀錄」 */
function getOrderSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var preferred = [
    (CONFIG.orderSheetName || "歷史訂單").toString().trim(),
    "歷史訂單",
    "历史订单"
  ];
  var fallbacks = CONFIG.orderSheetFallbackNames || ["訂單", "订单"];
  for (var f = 0; f < fallbacks.length; f++) {
    preferred.push(String(fallbacks[f] || "").trim());
  }
  var seen = {};
  for (var p = 0; p < preferred.length; p++) {
    var pname = preferred[p];
    if (!pname || seen[pname]) continue;
    seen[pname] = true;
    var hit = ss.getSheetByName(pname);
    if (hit && scoreOrderSheetCandidate_(hit) >= 0) {
      repairOrderSheetLayout_(hit, ss);
      ensureOrderHeaderRow_(hit);
      return hit;
    }
  }
  var all = ss.getSheets();
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < all.length; i++) {
    var cand = all[i];
    var score = scoreOrderSheetCandidate_(cand);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  if (best) {
    repairOrderSheetLayout_(best, ss);
    ensureOrderHeaderRow_(best);
    return best;
  }
  var createName = (CONFIG.orderSheetName || "歷史訂單").toString().trim();
  var sheet = ss.insertSheet(createName);
  ensureOrderHeaderRow_(sheet);
  return sheet;
}

function getStandardOrderHeaders_() {
  return [
    "訂單編號",
    "狀態",
    "日期",
    "客戶姓名",
    "會員卡號",
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
    "紅利已處理",
    "關聯訂單",
    "配送歷程",
    "更新時間"
  ];
}

/** 歷史訂單表頭被紅利紀錄欄位污染（B 欄為紀錄ID、缺會員卡號） */
function isCorruptedOrderSheetHeaders_(headers) {
  headers = headers || [];
  if (String(headers[1] || "").trim() === "紀錄ID") return true;
  var hasMemberCard = false;
  var hasLedgerMix = false;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim();
    if (h === "會員卡號" || h === "会员卡号") hasMemberCard = true;
    if (h === "類型" || h === "點數" || h === "剩餘") hasLedgerMix = true;
  }
  return !hasMemberCard && hasLedgerMix && String(headers[0] || "").trim() === "訂單編號";
}

function isOrderIdLike_(id) {
  var s = String(id || "").trim();
  if (!s) return false;
  if (/^ORD\d+$/i.test(s)) return true;
  var digits = s.replace(/\D/g, "");
  return digits.length >= 1 && digits.length <= 6;
}

function isPointsLedgerRow_(obj) {
  var t = String((obj && obj.ledgerType) || (obj && obj.type) || "").trim();
  if (/^(發放|調整|使用|過期|扣除)$/.test(t)) return true;
  var pts = obj && obj.points;
  var rem = obj && obj.remaining;
  if ((pts !== "" && pts != null && pts !== undefined) || (rem !== "" && rem != null && rem !== undefined)) {
    if (!isOrderIdLike_(obj && obj.id)) return true;
  }
  return false;
}

function findMemberCardColumnIndex_(headers) {
  for (var c = 0; c < (headers || []).length; c++) {
    var h = String(headers[c] || "").trim();
    if (!h) continue;
    if (h === "會員卡號" || h === "会员卡号" || /會員.*卡/.test(h) || /member\s*card/i.test(h)) {
      return c;
    }
  }
  return -1;
}

function extractMemberCardFromRowCells_(row, displayRow) {
  var len = Math.max((row || []).length, (displayRow || []).length);
  for (var c = 0; c < len; c++) {
    var vals = [];
    if (displayRow && displayRow[c] != null && displayRow[c] !== "") vals.push(displayRow[c]);
    if (row && row[c] != null && row[c] !== "") vals.push(row[c]);
    for (var i = 0; i < vals.length; i++) {
      var card = normalizeMemberCardNo_(vals[i]);
      if (isValidMemberCardNo_(card)) return card;
    }
  }
  return "";
}

function extractOrderIdFromRowCells_(row, displayRow) {
  var len = Math.min(Math.max((row || []).length, (displayRow || []).length), 12);
  for (var c = 0; c < len; c++) {
    var vals = [];
    if (displayRow && displayRow[c] != null && displayRow[c] !== "") vals.push(displayRow[c]);
    if (row && row[c] != null && row[c] !== "") vals.push(row[c]);
    for (var i = 0; i < vals.length; i++) {
      var raw = String(vals[i] || "").trim();
      if (isOrderIdLike_(raw)) return raw;
      var norm = normalizeOrderId_(raw);
      if (isOrderIdLike_(norm)) return norm;
    }
  }
  return "";
}

/** 從「紅利紀錄」依姓名／訂單編號補齊歷史訂單的會員卡號 */
function enrichOrdersMemberCardFromLedger_(orders, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getPointsSheet(ss);
  if (!sheet) return orders;
  var ledger = getPointsLedger(sheet);
  var byName = {};
  var byOrderId = {};
  for (var i = 0; i < ledger.length; i++) {
    var rec = ledger[i];
    var card = normalizeMemberCardNo_(getPointRecordMemberCard_(rec));
    if (!isValidMemberCardNo_(card)) continue;
    var name = normalizeCustomerNameForPoints_(rec.customerName);
    if (name) byName[name] = card;
    var oid = normalizeOrderId_(rec.orderId);
    if (oid) byOrderId[oid] = card;
  }
  for (var j = 0; j < (orders || []).length; j++) {
    var ord = orders[j];
    if (isValidMemberCardNo_(ord && ord.memberCardNo)) continue;
    var nid = normalizeOrderId_(ord && ord.id);
    if (nid && byOrderId[nid]) {
      ord.memberCardNo = byOrderId[nid];
      continue;
    }
    var n = normalizeCustomerNameForPoints_(ord && ord.customerName);
    if (n && byName[n]) ord.memberCardNo = byName[n];
  }
  return orders;
}

function parseOrdersFromSheetData_(sheet) {
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var display = sheet.getDataRange().getDisplayValues();
  var headers = data[0].map(function(h) { return (h || "").toString().trim(); });
  var keyMap = orderKeyMap_(headers);
  var cardCol = findMemberCardColumnIndex_(headers);
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
    if (cardCol >= 0) {
      var dispCard = normalizeMemberCardNo_((display[r] && display[r][cardCol]) || row[cardCol]);
      if (dispCard) obj.memberCardNo = dispCard;
    }
    if (!isValidMemberCardNo_(obj.memberCardNo)) {
      var scanned = extractMemberCardFromRowCells_(row, display[r]);
      if (scanned) obj.memberCardNo = scanned;
    }
    var id = (obj.id != null) ? String(obj.id).trim() : "";
    if (!id) {
      id = extractOrderIdFromRowCells_(row, display[r]);
      if (id) obj.id = id;
    }
    if (!id) continue;
    if (isPointsLedgerRow_(obj)) continue;
    if (obj.itemsJson != null && String(obj.itemsJson).trim() !== "") {
      try {
        var parsed = JSON.parse(String(obj.itemsJson));
        if (parsed && typeof parsed === "object") obj.items = parsed;
      } catch (e) { /* ignore */ }
    }
    delete obj.itemsJson;
    if (obj.id != null) obj.id = normalizeOrderId_(obj.id);
    if (obj.memberCardNo != null && obj.memberCardNo !== "") {
      obj.memberCardNo = normalizeMemberCardNo_(obj.memberCardNo);
    }
    list.push(obj);
  }
  list.sort(function(a, b) {
    var ad = a.date ? new Date(a.date).getTime() : 0;
    var bd = b.date ? new Date(b.date).getTime() : 0;
    if (!isFinite(ad)) ad = 0;
    if (!isFinite(bd)) bd = 0;
    return bd - ad;
  });
  return list;
}

/** 將錯誤表頭的歷史訂單重整為標準欄位並保留資料 */
function repairOrderSheetLayout_(sheet, ss) {
  if (!sheet) return false;
  var headers = getOrderHeaders_(sheet);
  if (!isCorruptedOrderSheetHeaders_(headers)) return false;
  var orders = parseOrdersFromSheetData_(sheet);
  orders = enrichOrdersMemberCardFromLedger_(orders, ss);
  var stdHeaders = getStandardOrderHeaders_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  sheet.getRange(1, 1, 1, stdHeaders.length).setValues([stdHeaders]);
  for (var i = 0; i < orders.length; i++) {
    upsertOrder(sheet, orders[i]);
  }
  Logger.log("[repairOrderSheetLayout_] repaired " + orders.length + " orders on「" + sheet.getName() + "」");
  return true;
}

function ensureOrderHeaderRow_(sheet) {
  var headers = getStandardOrderHeaders_();
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
  appendMissingOrderHeaders_(sheet, headers);
}

function appendMissingOrderHeaders_(sheet, requiredHeaders) {
  if (!sheet || !requiredHeaders || !requiredHeaders.length) return;
  var headers = getOrderHeaders_(sheet);
  var existing = {};
  headers.forEach(function(h) {
    var t = (h || "").toString().trim();
    if (t) existing[t] = true;
  });
  var toAdd = [];
  for (var i = 0; i < requiredHeaders.length; i++) {
    var name = (requiredHeaders[i] || "").toString().trim();
    if (name && !existing[name]) toAdd.push(name);
  }
  if (!toAdd.length) return;
  var startCol = Math.max(sheet.getLastColumn(), 1) + 1;
  for (var j = 0; j < toAdd.length; j++) {
    sheet.getRange(1, startCol + j).setValue(toAdd[j]);
  }
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
    ["紀錄ID", "recordId"],
    ["日期", "date"],
    ["類型", "ledgerType"],
    ["點數", "points"],
    ["剩餘", "remaining"],
    ["到期日", "expireDate"],
    ["狀態", "status"],
    ["出貨狀態", "status"],
    ["商品內容", "product"],
    ["商品圖", "productImage"],
    ["圖片網址", "productImage"],
    ["商品狀態", "productItemStatus"],
    ["最後更新", "updated", "updatedAt", "lastUpdated"],
    ["客戶姓名", "customerName", "name"],
    ["姓名", "customerName"],
    ["會員卡號", "memberCardNo", "memberCard", "会员卡号"],
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
    ["紅利已處理", "pointsProcessed"],
    ["關聯訂單", "linkedOrderIds", "linkedOrders"],
    ["配送歷程", "trackingHistory", "deliveryHistory", "historyJson", "history"],
    ["更新時間", "updated", "updatedAt", "lastUpdated"],
    ["商品摘要", "product"]
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
    memberCardNo: normalizeMemberCardNo_(o.memberCardNo != null ? o.memberCardNo : ""),
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
    linkedOrderIds: (o.linkedOrderIds != null) ? String(o.linkedOrderIds).trim() : "",
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
    if (key === "memberCardNo" && val) {
      val = normalizeMemberCardNo_(val);
      if (val) val = "'" + val;
    }
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
  var list = parseOrdersFromSheetData_(sheet);
  return enrichOrdersMemberCardFromLedger_(list, SpreadsheetApp.getActiveSpreadsheet());
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
function normalizeHeaderName_(h) {
  return (h || "").toString().trim().replace(/[１２]/g, function(ch) { return ch === "１" ? "1" : "2"; });
}

function getSheetHeaderMeta_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var scanCol = Math.max(lastCol, 40);
  var headerRow = sheet.getRange(1, 1, 1, scanCol).getValues()[0];
  var maxUsed = 0;
  for (var i = 0; i < headerRow.length; i++) {
    if (normalizeHeaderName_(headerRow[i])) maxUsed = i + 1;
  }
  var colCount = Math.max(lastCol, maxUsed);
  var headers = [];
  for (var c = 0; c < colCount; c++) {
    headers.push(c < headerRow.length ? normalizeHeaderName_(headerRow[c]) : "");
  }
  return { headers: headers, colCount: colCount };
}

var VARIANT_DIM_CN_KEYS_ = {
  variantDim1Label: "規格維度1名稱",
  variantDim1Options: "規格維度1選項",
  variantDim2Label: "規格維度2名稱",
  variantDim2Options: "規格維度2選項",
  variantPrices: "規格售價"
};

function productHasField_(product, key) {
  if (!product || !key) return false;
  if (Object.prototype.hasOwnProperty.call(product, key)) return true;
  var cn = VARIANT_DIM_CN_KEYS_[key];
  return !!(cn && Object.prototype.hasOwnProperty.call(product, cn));
}

function productFieldValue_(product, key) {
  if (!product) return null;
  if (Object.prototype.hasOwnProperty.call(product, key)) return product[key];
  var cn = VARIANT_DIM_CN_KEYS_[key];
  if (cn && Object.prototype.hasOwnProperty.call(product, cn)) return product[cn];
  return null;
}

function isBlankProductValue_(val) {
  return val === undefined || val === null || String(val).trim() === "";
}

function mergeRowFromProduct_(sheet, rowNum, product) {
  var meta = getSheetHeaderMeta_(sheet);
  var headers = meta.headers;
  var colCount = meta.colCount;
  var keyMap = buildKeyMap(headers);
  var existingRow = sheet.getRange(rowNum, 1, 1, colCount).getValues()[0];
  var row = existingRow.slice();
  while (row.length < colCount) row.push("");
  var forceWrite = product && product._writeAllFields === true;
  var preserveIfEmptyKeys = {
    variantDim1Label: true,
    variantDim1Options: true,
    variantDim2Label: true,
    variantDim2Options: true,
    variantPrices: true
  };

  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    if (!key || !productHasField_(product, key)) continue;
    var val = productFieldValue_(product, key);
    if (!forceWrite && preserveIfEmptyKeys[key] && isBlankProductValue_(val)) continue;
    row[c] = (val !== undefined && val !== null) ? val : "";
  }

  applyVariantDimHeadersToRow_(headers, row, product, forceWrite);

  var stockCols = [];
  var variantCol = -1;
  var statusCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var km = keyMap[i];
    if (km && String(km).toLowerCase() === "stock") stockCols.push(i);
    if (km === "variantStock") variantCol = i;
    if (km === "status") statusCol = i;
  }
  if (statusCol >= 0 && productHasField_(product, "status")) {
    var statusVal = (product.status !== undefined && product.status !== null && String(product.status).trim() !== "") ? String(product.status).trim() : "上架";
    row[statusCol] = (statusVal === "下架") ? "下架" : "上架";
  }
  var cleanVariantStock = productHasField_(product, "variantStock")
    ? sanitizeVariantStockString_(product.variantStock)
    : "";
  if (variantCol >= 0 && productHasField_(product, "variantStock")) {
    row[variantCol] = cleanVariantStock;
  }
  if (stockCols.length > 0 && (productHasField_(product, "stock") || productHasField_(product, "variantStock"))) {
    var total = 0;
    if (cleanVariantStock !== "") {
      var strictSum = sumVariantStockStrict_(cleanVariantStock);
      if (strictSum !== null) total = strictSum;
    } else if (productHasField_(product, "stock")) {
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

function applyVariantDimHeadersToRow_(headers, row, product, forceWrite) {
  if (!product || !headers || !row) return;
  var pairs = [
    ["規格維度1名稱", "variantDim1Label"],
    ["規格維度1選項", "variantDim1Options"],
    ["規格維度2名稱", "variantDim2Label"],
    ["規格維度2選項", "variantDim2Options"],
    ["規格售價", "variantPrices"],
    ["規格台幣售價", "variantPrices"]
  ];
  for (var p = 0; p < pairs.length; p++) {
    var headerName = pairs[p][0];
    var fieldKey = pairs[p][1];
    var val = productFieldValue_(product, fieldKey);
    if (!forceWrite && isBlankProductValue_(val)) continue;
    var target = normalizeHeaderName_(headerName);
    for (var c = 0; c < headers.length; c++) {
      if (headers[c] === target) {
        row[c] = val != null ? val : "";
        break;
      }
    }
  }
}

/**
 * 依工作表第一列標題，將 product 物件轉成與欄位對應的一列陣列；並補上庫存、規格庫存。
 */
function buildRowFromProduct(sheet, product) {
  var meta = getSheetHeaderMeta_(sheet);
  var headers = meta.headers;
  var keyMap = buildKeyMap(headers);
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = keyMap[c];
    var val = "";
    if (key) {
      var raw = productFieldValue_(product, key);
      if (raw !== undefined && raw !== null) val = raw;
    }
    row.push(val);
  }
  applyVariantDimHeadersToRow_(headers, row, product, true);
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
    var h = normalizeHeaderName_(headers[c]);
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
    var h = normalizeHeaderName_(headers[c]);
    if (h.indexOf("規格維度") >= 0 && h.indexOf("名稱") >= 0) {
      map[c] = (h.indexOf("2") >= 0) ? "variantDim2Label" : "variantDim1Label";
    } else if (h.indexOf("規格維度") >= 0 && h.indexOf("選項") >= 0) {
      map[c] = (h.indexOf("2") >= 0) ? "variantDim2Options" : "variantDim1Options";
    } else if (h.indexOf("成本") >= 0) map[c] = "cost";
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
    "會員卡號",
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
    memberCardNo: normalizeMemberCardNo_(r.memberCardNo != null ? r.memberCardNo : ""),
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
    ["會員卡號", "memberCardNo", "memberCard"],
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
    if (key === "memberCardNo" && val) {
      val = normalizeMemberCardNo_(val);
      if (val) val = "'" + val;
    }
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
  if (obj.memberCardNo != null && obj.memberCardNo !== "") obj.memberCardNo = normalizeMemberCardNo_(obj.memberCardNo);
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

/** 顧客端公開查詢：依會員卡號（13 碼純數字） */
function normalizeMemberCardNo_(card) {
  return String(card || "").replace(/^'/, "").replace(/\D/g, "").slice(0, 13);
}

function isValidMemberCardNo_(card) {
  return /^\d{13}$/.test(normalizeMemberCardNo_(card));
}

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

function getPointRecordMemberCard_(rec) {
  if (rec.memberCardNo != null && String(rec.memberCardNo).trim() !== "") {
    return normalizeMemberCardNo_(rec.memberCardNo);
  }
  return "";
}

function recordMatchesMemberCardForPoints_(rec, memberCardNo) {
  var card = normalizeMemberCardNo_(memberCardNo);
  if (!isValidMemberCardNo_(card)) return false;
  return getPointRecordMemberCard_(rec) === card;
}

function getActiveLotsForMemberCard_(ledger, memberCardNo) {
  var today = todayStrForPoints_();
  var lots = [];
  for (var i = 0; i < ledger.length; i++) {
    var rec = ledger[i];
    if (!recordMatchesMemberCardForPoints_(rec, memberCardNo)) continue;
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

function collectCustomerNamesForMemberCard_(orders, card) {
  var names = {};
  if (!isValidMemberCardNo_(card)) return [];
  for (var i = 0; i < (orders || []).length; i++) {
    var ord = orders[i];
    if (!orderMatchesMemberCard_(ord, card)) continue;
    var n = normalizeCustomerNameForPoints_(ord && ord.customerName);
    if (n) names[n] = true;
  }
  return Object.keys(names);
}

function orderMatchesMemberCardExtended_(order, card, linkedNames) {
  if (orderMatchesMemberCard_(order, card)) return true;
  if (!linkedNames || !linkedNames.length) return false;
  var n = normalizeCustomerNameForPoints_(order && order.customerName);
  return !!(n && linkedNames.indexOf(n) >= 0);
}

function findOrdersForMemberCard_(allOrders, card) {
  var matched = [];
  var seenIds = {};
  var linkedNames = collectCustomerNamesForMemberCard_(allOrders, card);
  for (var i = 0; i < (allOrders || []).length; i++) {
    var ord = allOrders[i];
    if (!ord) continue;
    if (!orderMatchesMemberCardExtended_(ord, card, linkedNames)) continue;
    var id = normalizeOrderId_(ord.id);
    if (!id || seenIds[id]) continue;
    seenIds[id] = true;
    matched.push(ord);
  }
  return matched;
}

function recordMatchesMemberCardExtended_(rec, card, linkedNames) {
  if (recordMatchesMemberCardForPoints_(rec, card)) return true;
  if (getPointRecordMemberCard_(rec)) return false;
  if (!linkedNames || !linkedNames.length) return false;
  var n = normalizeCustomerNameForPoints_(getPointRecordCustomerName_(rec));
  return !!(n && linkedNames.indexOf(n) >= 0);
}

function getActiveLotsForMemberCardExtended_(ledger, allOrders, card) {
  var linkedNames = collectCustomerNamesForMemberCard_(allOrders, card);
  var today = todayStrForPoints_();
  var lots = [];
  for (var i = 0; i < (ledger || []).length; i++) {
    var rec = ledger[i];
    if (!recordMatchesMemberCardExtended_(rec, card, linkedNames)) continue;
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

/** 顧客端查詢：從 GET 參數解析 13 碼卡號（支援 card / memberCardNo / 誤填在 name 欄） */
function resolvePublicMemberCardParam_(params) {
  params = params || {};
  var direct = normalizeMemberCardNo_(
    params.card || params.memberCardNo || params["會員卡號"] || ""
  );
  if (isValidMemberCardNo_(direct)) return direct;
  var fromText = normalizeMemberCardNo_(
    params.name || params.customerName || params["姓名"] || ""
  );
  if (isValidMemberCardNo_(fromText)) return fromText;
  return "";
}

function buildPointsBalanceResult_(ledger, card, allOrders) {
  var lots = getActiveLotsForMemberCardExtended_(ledger, allOrders || [], card);
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
    memberCardNo: card,
    balance: balance,
    pointValue: 1,
    discountAmount: balance,
    nextExpireDate: nextExpireDate,
    nextExpirePoints: nextExpirePoints,
    rules: {
      spendPerPoint: 100,
      pointValue: 1,
      expireDays: 365,
      minRedeemNet: 199
    },
    message: balance > 0 ? "OK" : "目前尚無可用紅利點數"
  };
}

function getPointsBalancePublic_(params) {
  params = params || {};
  var card = resolvePublicMemberCardParam_(params);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pointsSheet = getPointsSheet(ss);
  if (!pointsSheet) {
    return { error: true, message: "找不到紅利紀錄工作表" };
  }
  var ledger = getPointsLedger(pointsSheet);
  var orderSheet = getOrderSheet(ss);
  var allOrders = orderSheet ? getOrders(orderSheet) : [];
  if (isValidMemberCardNo_(card)) {
    return buildPointsBalanceResult_(ledger, card, allOrders);
  }
  // 舊版相容：僅姓名查詢（無卡號的舊紀錄）
  var legacyName = normalizeCustomerNameForPoints_(
    params.name || params.customerName || params["姓名"] || ""
  );
  if (legacyName.length >= 2) {
    var nameLots = getActiveLotsForCustomer_(ledger, legacyName);
    var nameBalance = 0;
    for (var i = 0; i < nameLots.length; i++) {
      nameBalance += Number(nameLots[i].remaining) || 0;
    }
    var nameNextExpireDate = "";
    var nameNextExpirePoints = 0;
    if (nameLots.length > 0) {
      nameNextExpireDate = nameLots[0].expireDate || "";
      nameNextExpirePoints = Number(nameLots[0].remaining) || 0;
    }
    return {
      error: false,
      memberCardNo: "",
      customerName: legacyName,
      balance: nameBalance,
      pointValue: 1,
      discountAmount: nameBalance,
      nextExpireDate: nameNextExpireDate,
      nextExpirePoints: nameNextExpirePoints,
      rules: {
        spendPerPoint: 100,
        pointValue: 1,
        expireDays: 365,
        minRedeemNet: 199
      },
      message: nameBalance > 0 ? "OK" : "目前尚無可用紅利點數"
    };
  }
  return { error: true, message: "請輸入 13 碼會員卡號" };
}

function orderMatchesMemberCard_(order, memberCardNo) {
  var card = normalizeMemberCardNo_(memberCardNo);
  if (!isValidMemberCardNo_(card)) return false;
  return normalizeMemberCardNo_(order && order.memberCardNo) === card;
}

function orderMatchesCustomerName_(order, customerName) {
  var n = normalizeCustomerNameForPoints_(customerName);
  if (!n) return false;
  return normalizeCustomerNameForPoints_(order && order.customerName) === n;
}

function orderEffectiveShippingPublic_(ord) {
  var fee = Number(ord && ord.shippingFee);
  if (isNaN(fee)) fee = 38;
  var st = String(ord && ord.shippingStatus || "");
  if (st.indexOf("免運") >= 0) return 0;
  return Math.max(0, Math.ceil(fee));
}

function orderAmountDuePublic_(ord) {
  var sub = Number(ord && ord.subtotal) || 0;
  var disc = Number(ord && ord.discount) || 0;
  if (isNaN(disc)) disc = 0;
  var pts = Math.floor(Number(ord && ord.pointsUsed) || 0);
  var ship = orderEffectiveShippingPublic_(ord);
  var dep = Number(ord && ord.depositAmount) || 0;
  if (isNaN(dep) || dep < 0) dep = 0;
  var gross = Math.max(0, Math.ceil(sub - disc - pts + ship));
  return dep > 0 ? Math.max(0, gross - dep) : gross;
}

function sanitizePublicOrderItem_(it) {
  var o = it || {};
  var price = (o.price != null && o.price !== "" && !isNaN(Number(o.price))) ? Number(o.price) : null;
  return {
    lineName: String(o.lineName != null ? o.lineName : "").trim(),
    qty: Math.max(0, Math.floor(Number(o.qty) || 0)),
    price: price,
    shipStatus: String(o.shipStatus != null ? o.shipStatus : "待出貨").trim() || "待出貨"
  };
}

function sanitizePublicOrder_(ord) {
  var items = [];
  if (ord && ord.items && Array.isArray(ord.items)) {
    for (var i = 0; i < ord.items.length; i++) {
      var it = sanitizePublicOrderItem_(ord.items[i]);
      if (it.lineName) items.push(it);
    }
  }
  return {
    id: String(ord && ord.id != null ? ord.id : "").trim(),
    status: String(ord && ord.status != null ? ord.status : "").trim() || "待處理",
    date: ord && ord.date != null ? String(ord.date) : "",
    product: String(ord && ord.product != null ? ord.product : "").trim(),
    subtotal: Number(ord && ord.subtotal) || 0,
    discount: Number(ord && ord.discount) || 0,
    pointsUsed: Math.floor(Number(ord && ord.pointsUsed) || 0),
    shippingFee: orderEffectiveShippingPublic_(ord),
    depositAmount: Number(ord && ord.depositAmount) || 0,
    amountDue: orderAmountDuePublic_(ord),
    pointsEarned: Math.floor(Number(ord && ord.pointsEarned) || 0),
    linkedOrderIds: String(ord && ord.linkedOrderIds != null ? ord.linkedOrderIds : "").trim(),
    preorderDate: ord && ord.preorderDate != null ? String(ord.preorderDate) : "",
    shipDate: ord && ord.shipDate != null ? String(ord.shipDate) : "",
    shippingMethod: String(ord && ord.shippingMethod != null ? ord.shippingMethod : "").trim(),
    items: items
  };
}

function getCustomerOrdersPublic_(params) {
  params = params || {};
  var card = resolvePublicMemberCardParam_(params);
  var orderIdOnly = resolvePublicOrderIdParam_(params);
  // 僅帶 orderId、無卡號時，改走單筆配送進度（與 order_status 相同）
  if (orderIdOnly && !isValidMemberCardNo_(card)) {
    return getOrderStatusPublic_(params);
  }
  if (!isValidMemberCardNo_(card)) {
    return { error: true, message: "請輸入 13 碼會員卡號" };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var all = getAllOrdersMerged_(ss);
  var matched = findOrdersForMemberCard_(all, card);
  matched.sort(function(a, b) {
    var ma = String(a.id || "").match(/^ORD(\d+)$/i);
    var mb = String(b.id || "").match(/^ORD(\d+)$/i);
    var na = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER;
    var nb = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER;
    return nb - na;
  });
  var publicOrders = [];
  for (var j = 0; j < matched.length; j++) {
    publicOrders.push(sanitizePublicOrder_(matched[j]));
  }
  var totalDue = 0;
  var activeCount = 0;
  for (var k = 0; k < publicOrders.length; k++) {
    var o = publicOrders[k];
    if (o.status === "已取消") continue;
    activeCount++;
    if (o.status !== "已完成") totalDue += o.amountDue;
  }
  return {
    error: false,
    memberCardNo: card,
    orders: publicOrders,
    orderCount: publicOrders.length,
    activeCount: activeCount,
    totalDue: totalDue,
    message: publicOrders.length ? "OK" : "目前尚無訂單紀錄"
  };
}

function resolvePublicOrderIdParam_(params) {
  params = params || {};
  return normalizeOrderId_(params.orderId || params.id || params["訂單編號"] || "");
}

function orderIdsEquivalent_(a, b) {
  if (!a || !b) return false;
  if (normalizeOrderId_(a) === normalizeOrderId_(b)) return true;
  var da = String(a).replace(/\D/g, "");
  var db = String(b).replace(/\D/g, "");
  if (!da || !db) return false;
  var na = parseInt(da, 10);
  var nb = parseInt(db, 10);
  return !isNaN(na) && !isNaN(nb) && na === nb;
}

function findOrderById_(orders, id) {
  if (!id) return null;
  for (var i = 0; i < (orders || []).length; i++) {
    if (orderIdsEquivalent_(orders[i].id, id)) return orders[i];
  }
  return null;
}

function listOrderSourceSheets_(ss) {
  var result = [];
  var seen = {};
  var preferred = [
    (CONFIG.orderSheetName || "歷史訂單").toString().trim(),
    "歷史訂單",
    "历史订单",
    "訂單",
    "工作表1"
  ];
  var fallbacks = CONFIG.orderSheetFallbackNames || ["訂單", "订单"];
  for (var f = 0; f < fallbacks.length; f++) {
    preferred.push(String(fallbacks[f] || "").trim());
  }
  for (var i = 0; i < preferred.length; i++) {
    var pname = preferred[i];
    if (!pname) continue;
    var s = ss.getSheetByName(pname);
    if (!s) continue;
    var sname = String(s.getName() || "").trim();
    if (isPointsLedgerSheetName_(sname)) continue;
    var headers = getOrderHeaders_(s);
    if (isPointsLedgerHeaders_(headers)) continue;
    if (!sheetHasOrderIdHeader_(headers) && !isLikelyOrderSheetHeaders_(headers)) continue;
    var sid = s.getSheetId();
    if (!seen[sid]) {
      seen[sid] = true;
      result.push(s);
    }
  }
  var all = ss.getSheets();
  for (var j = 0; j < all.length; j++) {
    var cand = all[j];
    var sid2 = cand.getSheetId();
    if (seen[sid2]) continue;
    var cname = String(cand.getName() || "").trim();
    if (isPointsLedgerSheetName_(cname)) continue;
    var headers2 = getOrderHeaders_(cand);
    if (isPointsLedgerHeaders_(headers2)) continue;
    if (!sheetHasOrderIdHeader_(headers2) && !isLikelyOrderSheetHeaders_(headers2)) continue;
    seen[sid2] = true;
    result.push(cand);
  }
  return result;
}

function getAllOrdersMerged_(ss) {
  var sheets = listOrderSourceSheets_(ss);
  var merged = [];
  var seenIds = {};
  for (var i = 0; i < sheets.length; i++) {
    var list = getOrders(sheets[i]);
    for (var j = 0; j < list.length; j++) {
      var nid = normalizeOrderId_(list[j].id);
      if (!nid || seenIds[nid]) continue;
      seenIds[nid] = true;
      merged.push(list[j]);
    }
  }
  return merged;
}

function isPublicUrlLike_(text) {
  var v = String(text || "").trim();
  return /^https?:\/\//i.test(v) || /res\.cloudinary\.com/i.test(v);
}

function sanitizePublicHistoryStep_(step) {
  var status = String((step && step.status) || "").trim();
  var note = String((step && step.note) || "").trim();
  var time = String((step && step.time) || "").trim();
  if (isPublicUrlLike_(status) && note && !isPublicUrlLike_(note)) {
    status = note;
    note = "";
  }
  if (isPublicUrlLike_(status)) status = "狀態更新";
  return {
    status: cleanStatusLabel_(status),
    note: note,
    time: time
  };
}

function cleanStatusLabel_(text) {
  return String(text || "")
    .trim()
    .replace(/^[\uD800-\uDBFF][\uDC00-\uDFFF]\s*/g, "")
    .replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, "")
    .trim();
}

function parseSheet1ProductLines_(text) {
  return String(text || "")
    .trim()
    .split(/\n|；|;/)
    .map(function(part) {
      return String(part || "")
        .replace(/^\d+[、.．)\]]\s*/, "")
        .trim();
    })
    .filter(Boolean);
}

function parseSheet1ImageLines_(text) {
  return String(text || "")
    .trim()
    .split(/\n|；|;/)
    .map(function(part) { return String(part || "").trim(); })
    .filter(function(part) { return isPublicUrlLike_(part); });
}

function getSheet1OrderColumns_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 5);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = {
    orderId: 1,
    product: 2,
    productImage: 0,
    productItemStatus: 0,
    shipStatus: 0,
    note: 0,
    updated: 0
  };
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim();
    var col = i + 1;
    if (/訂單編號/.test(h)) cols.orderId = col;
    else if (/商品內容/.test(h)) cols.product = col;
    else if (/商品圖|圖片網址|cloudinary/i.test(h)) cols.productImage = col;
    else if (/商品狀態|品項狀態/.test(h)) cols.productItemStatus = col;
    else if (/出貨狀態/.test(h)) cols.shipStatus = col;
    else if (/備註/.test(h)) cols.note = col;
    else if (/最後更新|更新時間/.test(h)) cols.updated = col;
  }
  return cols;
}

function buildSheet1ProductItems_(productText, imageText, itemStatusText, shipStatusFallback) {
  var names = parseSheet1ProductLines_(productText);
  if (!names.length) return [];
  var images = parseSheet1ImageLines_(imageText);
  var statuses = parseSheet1ProductLines_(itemStatusText).map(cleanStatusLabel_);
  var fallback = cleanStatusLabel_(shipStatusFallback);
  var items = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (isPublicUrlLike_(name)) name = "商品";
    var image = images[i] || "";
    if (!image && images.length === 1) image = images[0];
    var label = statuses[i] || "";
    if (!label && statuses.length === 1) label = statuses[0];
    if (!label && names.length === 1) label = fallback;
    if (!label) label = "待出貨";
    items.push(mapPublicStatusItem_({
      lineName: name,
      image: image,
      shipStatus: label
    }));
  }
  return items;
}

/**
 * 顧客五碼查詢：讀「工作表1」+「歷程」（MAARU 訂單進度試算表格式）
 * 欄位：訂單編號｜商品內容｜圖片網址｜商品狀態｜出貨狀態
 */
function getSheet1OrderStatusPublic_(ss, id) {
  var sheetName = (CONFIG.legacyProgressSheetName || "工作表1").toString().trim();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  var cols = getSheet1OrderColumns_(sheet);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { error: true, message: "查無此訂單編號", notFound: true };
  }

  var foundRow = null;
  var displayOrderId = "";
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowOrderId = String(row[cols.orderId - 1] || "").trim();
    if (!rowOrderId) continue;
    if (orderIdsEquivalent_(rowOrderId, id)) {
      foundRow = row;
      displayOrderId = rowOrderId;
      break;
    }
  }
  if (!foundRow) {
    return { error: true, message: "查無此訂單編號", notFound: true };
  }

  var product = String(foundRow[cols.product - 1] || "").trim();
  var productImages = cols.productImage
    ? String(foundRow[cols.productImage - 1] || "").trim()
    : "";
  var productItemStatus = cols.productItemStatus
    ? String(foundRow[cols.productItemStatus - 1] || "").trim()
    : "";
  var shipStatus = cols.shipStatus
    ? cleanStatusLabel_(foundRow[cols.shipStatus - 1])
    : "";
  var note = cols.note ? String(foundRow[cols.note - 1] || "").trim() : "";
  var updated = cols.updated
    ? normalizeSheetDateValue_(foundRow[cols.updated - 1])
    : "";

  var items = buildSheet1ProductItems_(product, productImages, productItemStatus, shipStatus);
  var itemSummary = buildPublicItemSummary_(items);
  var history = getLegacyTrackingHistory_(ss, displayOrderId);
  var trackingStatus = shipStatus || derivePublicTrackingStatus_({ status: shipStatus }, items);

  if ((!history || !history.length) && (trackingStatus || updated)) {
    history = [{
      time: updated || "",
      status: trackingStatus || "狀態更新",
      note: ""
    }];
  }

  return {
    error: false,
    orderId: orderStatusQueryDisplayId_(displayOrderId),
    orderIdFull: normalizeOrderId_(displayOrderId),
    memberCardNo: "",
    product: product,
    items: items,
    itemSummary: itemSummary,
    note: sanitizePublicOrderNote_({ remark: note }),
    history: history,
    status: trackingStatus,
    updated: updated
  };
}

function getLegacyTrackingHistory_(ss, orderId) {
  var names = [
    (CONFIG.legacyHistorySheetName || "歷程"),
    "歷程",
    "配送歷程",
    "狀態"
  ];
  var seen = {};
  for (var n = 0; n < names.length; n++) {
    var sheetName = String(names[n] || "").trim();
    if (!sheetName || seen[sheetName]) continue;
    seen[sheetName] = true;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) continue;
    var list = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var rowOrderId = String(row[0] || "").trim();
      if (!orderIdsEquivalent_(rowOrderId, orderId)) continue;
      var step = sanitizePublicHistoryStep_(normalizeHistoryEntry_({
        status: row[1],
        note: row[2],
        time: row[3]
      }));
      if (step && (step.status || step.time)) list.push(step);
    }
    if (list.length) {
      list.sort(function(a, b) {
        var ta = new Date(a.time || 0).getTime();
        var tb = new Date(b.time || 0).getTime();
        return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      });
      return list;
    }
  }
  return [];
}

function buildItemsFromProductFields_(ord) {
  var product = String((ord && ord.product) || "").trim();
  if (!product) return [];
  var names = product.split(/\n|；|;/).map(function(s) {
    return String(s || "").trim();
  }).filter(Boolean);
  var images = String((ord && ord.productImage) || "").split(/\n|；|;/).map(function(s) {
    return String(s || "").trim();
  }).filter(Boolean);
  var statuses = String((ord && ord.productItemStatus) || "").split(/\n|；|;/).map(function(s) {
    return String(s || "").trim();
  }).filter(Boolean);
  var fallbackStatus = String((ord && ord.status) || "").trim();
  var items = [];
  for (var i = 0; i < names.length; i++) {
    var label = statuses[i] || (statuses.length === 1 ? statuses[0] : "") || fallbackStatus || "待出貨";
    items.push(mapPublicStatusItem_({
      lineName: names[i],
      image: images[i] || (images.length === 1 ? images[0] : ""),
      shipStatus: label
    }));
  }
  return items;
}

function orderStatusQueryDisplayId_(id) {
  var safeId = normalizeOrderId_(id);
  var m = safeId.match(/^ORD(\d+)$/);
  if (m) return ("00000" + parseInt(m[1], 10)).slice(-5);
  return String(id || "").trim();
}

function normalizeHistoryEntry_(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") {
    var text = String(entry).trim();
    if (!text) return null;
    var idx = text.indexOf("：");
    if (idx < 0) idx = text.indexOf(":");
    if (idx > 0) {
      return {
        time: text.slice(0, idx).trim(),
        status: text.slice(idx + 1).trim(),
        note: ""
      };
    }
    return { time: "", status: text, note: "" };
  }
  if (typeof entry !== "object") return null;
  return {
    time: normalizeSheetDateValue_(entry.time || entry.updated || entry.date || ""),
    status: String(entry.status || entry.state || "").trim(),
    note: String(entry.note || entry.remark || "").trim()
  };
}

function parsePublicTrackingHistory_(ord) {
  if (!ord) return null;
  var candidates = [
    ord.trackingHistory,
    ord.deliveryHistory,
    ord.historyJson,
    ord.history,
    ord["配送歷程"]
  ];
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      var arr = [];
      for (var j = 0; j < v.length; j++) {
        var step = normalizeHistoryEntry_(v[j]);
        if (step && (step.status || step.time)) arr.push(step);
      }
      if (arr.length) return arr;
      continue;
    }
    var s = String(v).trim();
    if (!s) continue;
    try {
      var parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        var list = [];
        for (var k = 0; k < parsed.length; k++) {
          var item = normalizeHistoryEntry_(parsed[k]);
          if (item && (item.status || item.time)) list.push(item);
        }
        if (list.length) return list;
      }
    } catch (parseErr) {
      // 非 JSON，保留原文字串給前端 normalizeHistory 解析
      return s;
    }
    return s;
  }
  return null;
}

function mapPublicStatusItemCode_(label) {
  var text = String(label || "").trim();
  if (/已出貨|已寄出|已到貨|配送中|賣貨便|7-11/.test(text)) return "shipped";
  return "pending";
}

function mapPublicStatusItem_(it) {
  var o = it || {};
  var label = String(o.shipStatus || o.itemStatus || o.status || "待出貨").trim() || "待出貨";
  var name = String(o.lineName || o.name || o.product || "").trim();
  var image = String(o.image || o.imageUrl || "").trim();
  return {
    name: name || "商品",
    image: image,
    itemStatus: label,
    itemStatusCode: mapPublicStatusItemCode_(label)
  };
}

function buildPublicItemSummary_(items) {
  var total = (items || []).length;
  var shipped = 0;
  for (var i = 0; i < total; i++) {
    if (items[i].itemStatusCode === "shipped") shipped++;
  }
  return {
    total: total,
    shipped: shipped,
    pending: Math.max(total - shipped, 0)
  };
}

function buildOrderProductText_(ord, items) {
  if (items && items.length) {
    var names = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].name) names.push(items[i].name);
    }
    if (names.length) return names.join("\n");
  }
  return String((ord && ord.product) || "").trim();
}

function sanitizePublicOrderNote_(ord) {
  return String((ord && (ord.remark || ord["備註"])) || "").trim();
}

function derivePublicTrackingStatus_(ord, items) {
  var parsed = parsePublicTrackingHistory_(ord);
  if (Array.isArray(parsed) && parsed.length) {
    return String(parsed[0].status || "").trim() || "狀態更新";
  }
  var shipped = 0;
  for (var i = 0; i < (items || []).length; i++) {
    if (items[i].itemStatusCode === "shipped") shipped++;
  }
  if (items && items.length && shipped === items.length) return "已出貨";
  if (shipped > 0) return "部分已出貨";
  var st = String(ord && ord.status || "").trim();
  if (st === "已完成") return "已出貨";
  if (st === "出貨中") return "集運中";
  if (st === "已確認") return "已採購";
  if (st === "待處理") return "訂單成立";
  return st || "訂單成立";
}

function buildSyntheticTrackingHistory_(ord, items) {
  var steps = [];
  var orderDate = normalizeSheetDateValue_(ord && ord.date);
  if (orderDate) {
    steps.push({ time: orderDate, status: "訂單成立", note: "" });
  }
  var preorderDate = normalizeSheetDateValue_(ord && ord.preorderDate);
  if (preorderDate) {
    steps.push({ time: preorderDate, status: "預購/採購中", note: "" });
  }
  if (items && items.length) {
    var lines = [];
    for (var i = 0; i < items.length; i++) {
      lines.push(items[i].name + "：" + (items[i].itemStatus || "待出貨"));
    }
    steps.push({
      time: normalizeSheetDateValue_(ord.updated || ord.shipDate || ord.date) || orderDate || "",
      status: lines.join("\n"),
      note: ""
    });
  }
  var orderStatus = String(ord && ord.status || "").trim();
  if (orderStatus && orderStatus !== "待處理") {
    var mapped = orderStatus;
    if (orderStatus === "出貨中") mapped = "集運中";
    if (orderStatus === "已完成") mapped = "已出貨";
    steps.push({
      time: normalizeSheetDateValue_(ord.updated || ord.shipDate || ord.date) || orderDate || "",
      status: mapped,
      note: ""
    });
  }
  var shipDate = normalizeSheetDateValue_(ord && ord.shipDate);
  if (shipDate) {
    steps.push({ time: shipDate, status: "已出貨", note: "" });
  }
  var depositRemark = String(ord && ord.depositRemark || "").trim();
  if (depositRemark) {
    steps.push({
      time: orderDate || "",
      status: "收訂金紀錄",
      note: depositRemark
    });
  }
  return steps;
}

function getOrderStatusPublic_(params) {
  params = params || {};
  var id = resolvePublicOrderIdParam_(params);
  if (!id) {
    return { error: true, message: "請輸入訂單編號" };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 優先：MAARU 訂單進度試算表「工作表1」+「歷程」
  var sheet1Result = getSheet1OrderStatusPublic_(ss, id);
  if (sheet1Result && sheet1Result.error === false) {
    return sheet1Result;
  }

  var all = getAllOrdersMerged_(ss);
  var ord = findOrderById_(all, id);
  if (!ord) {
    if (sheet1Result && sheet1Result.notFound) {
      return { error: true, message: "查無此訂單編號" };
    }
    return { error: true, message: "查無此訂單編號（請確認「工作表1」A 欄訂單編號）" };
  }

  var rawItems = Array.isArray(ord.items) ? ord.items : [];
  var items = [];
  for (var i = 0; i < rawItems.length; i++) {
    var mapped = mapPublicStatusItem_(rawItems[i]);
    if (mapped.name) items.push(mapped);
  }
  if (!items.length) {
    items = buildItemsFromProductFields_(ord);
  }
  var itemSummary = buildPublicItemSummary_(items);

  var history = parsePublicTrackingHistory_(ord);
  if (!history || (Array.isArray(history) && history.length === 0)) {
    history = getLegacyTrackingHistory_(ss, id);
  }
  if (!history || (Array.isArray(history) && history.length === 0)) {
    history = buildSyntheticTrackingHistory_(ord, items);
  }

  var updated = normalizeSheetDateValue_(
    ord.updated || ord.updatedAt || ord.lastUpdated || ord.shipDate || ord.date
  ) || "";

  return {
    error: false,
    orderId: orderStatusQueryDisplayId_(ord.id),
    orderIdFull: normalizeOrderId_(ord.id),
    memberCardNo: normalizeMemberCardNo_(ord.memberCardNo || ""),
    product: buildOrderProductText_(ord, items),
    items: items,
    itemSummary: itemSummary,
    note: sanitizePublicOrderNote_(ord),
    history: history,
    status: derivePublicTrackingStatus_(ord, items),
    updated: updated
  };
}

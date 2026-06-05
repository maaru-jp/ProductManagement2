/**
 * MAARU 紅利點數 — 消費滿 100 元集 1 點，1 點折 1 元，商品淨額滿 199 元才可折抵，1 年內有效
 * 會員以「客戶姓名」識別（電話／Line ID 僅供備註，舊資料無姓名時仍可以電話／Line 對應）
 */
(function (global) {
  var CONFIG_KEY = "maaru_loyalty_config";
  var LEDGER_KEY = "adminLoyaltyLedger";

  var DEFAULT_CONFIG = {
    spendPerPoint: 100,
    pointValue: 1,
    minRedeemNet: 199,
    expireDays: 365,
    earnStatuses: ["已確認", "已完成"],
  };

  function getConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return Object.assign({}, DEFAULT_CONFIG);
      var parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CONFIG, parsed || {});
    } catch (e) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(Object.assign({}, DEFAULT_CONFIG, cfg || {})));
  }

  function normalizeCustomerName(name) {
    return String(name || "").trim().replace(/\s+/g, "");
  }

  function normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function normalizeLineId(lineId) {
    return String(lineId || "").trim().toLowerCase();
  }

  function customerKey(customerName, phone, lineId) {
    var n = normalizeCustomerName(customerName);
    if (n) return "N:" + n;
    var p = normalizePhone(phone);
    if (p) return "P:" + p;
    var l = normalizeLineId(lineId);
    if (l) return "L:" + l;
    return "";
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function addDaysStr(dateStr, days) {
    var d = new Date(dateStr + "T12:00:00");
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function newRecordId() {
    return "PT" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function getLedger() {
    try {
      var raw = localStorage.getItem(LEDGER_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLedger(list) {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  }

  function recordMatchesCustomer(rec, customerName, phone, lineId) {
    var n = normalizeCustomerName(customerName);
    if (n && normalizeCustomerName(rec.customerName) === n) return true;
    if (n) return false;
    var p = normalizePhone(phone);
    var l = normalizeLineId(lineId);
    if (p && normalizePhone(rec.phone) === p) return true;
    if (l && normalizeLineId(rec.lineId) === l) return true;
    return false;
  }

  function expireCustomerPoints(ledger, customerName, phone, lineId) {
    var today = todayStr();
    var changed = false;
    ledger.forEach(function (rec) {
      if (rec.type !== "發放") return;
      if (!recordMatchesCustomer(rec, customerName, phone, lineId)) return;
      var remaining = Number(rec.remaining);
      if (!remaining || remaining <= 0) return;
      var exp = rec.expireDate ? String(rec.expireDate).slice(0, 10) : "";
      if (!exp || exp >= today) return;
      ledger.push({
        id: newRecordId(),
        date: today,
        phone: rec.phone || "",
        lineId: rec.lineId || "",
        customerName: rec.customerName || "",
        type: "失效",
        points: -remaining,
        remaining: 0,
        expireDate: "",
        orderId: "",
        note: "到期自動失效（原發放 " + (rec.id || "") + "）",
        lotId: rec.id || "",
      });
      rec.remaining = 0;
      changed = true;
    });
    return changed ? ledger : ledger;
  }

  function getActiveLots(ledger, customerName, phone, lineId) {
    ledger = expireCustomerPoints(ledger.slice(), customerName, phone, lineId);
    var today = todayStr();
    return ledger
      .filter(function (rec) {
        if (rec.type !== "發放") return false;
        if (!recordMatchesCustomer(rec, customerName, phone, lineId)) return false;
        var remaining = Number(rec.remaining);
        if (!remaining || remaining <= 0) return false;
        var exp = rec.expireDate ? String(rec.expireDate).slice(0, 10) : "";
        return exp && exp >= today;
      })
      .sort(function (a, b) {
        return String(a.date || "").localeCompare(String(b.date || ""));
      });
  }

  function getBalance(customerName, phone, lineId) {
    var ledger = getLedger();
    return getActiveLots(ledger, customerName, phone, lineId).reduce(function (sum, lot) {
      return sum + (Number(lot.remaining) || 0);
    }, 0);
  }

  function merchandiseNet(order) {
    var sub = Number(order && order.subtotal) || 0;
    var disc = Number(order && order.discount) || 0;
    return Math.max(0, Math.ceil(sub - disc));
  }

  function calcMaxRedeemPoints(order, balance, cfg) {
    cfg = cfg || getConfig();
    var net = merchandiseNet(order);
    var minNet = Math.max(0, Number(cfg.minRedeemNet) || 0);
    if (minNet > 0 && net < minNet) return 0;
    return Math.max(0, Math.min(Number(balance) || 0, net));
  }

  function getMinRedeemNet(cfg) {
    cfg = cfg || getConfig();
    return Math.max(0, Number(cfg.minRedeemNet) || 0);
  }

  function meetsMinRedeemNet(order, cfg) {
    var minNet = getMinRedeemNet(cfg);
    if (minNet <= 0) return true;
    return merchandiseNet(order) >= minNet;
  }

  function calcEarnPoints(order, cfg) {
    cfg = cfg || getConfig();
    var used = Number(order && order.pointsUsed) || 0;
    var base = Math.max(0, merchandiseNet(order) - used);
    var spend = Number(cfg.spendPerPoint) || 100;
    if (spend <= 0) return 0;
    return Math.floor(base / spend);
  }

  function pointsDiscountAmount(pointsUsed, cfg) {
    cfg = cfg || getConfig();
    var val = Number(cfg.pointValue) || 1;
    return Math.max(0, Math.floor(Number(pointsUsed) || 0) * val);
  }

  function redeemPoints(ledger, order, pointsToUse) {
    var pts = Math.max(0, Math.floor(Number(pointsToUse) || 0));
    if (!pts) return ledger;
    var lots = getActiveLots(ledger, order.customerName, order.phone, order.lineId);
    var need = pts;
    lots.forEach(function (lot) {
      if (need <= 0) return;
      var src = ledger.find(function (r) { return r.id === lot.id; });
      if (!src) return;
      var rem = Number(src.remaining) || 0;
      if (rem <= 0) return;
      var take = Math.min(rem, need);
      src.remaining = rem - take;
      need -= take;
    });
    if (need > 0) {
      throw new Error("可用紅利不足，尚缺 " + need + " 點");
    }
    ledger.push({
      id: newRecordId(),
      date: todayStr(),
      phone: order.phone || "",
      lineId: order.lineId || "",
      customerName: order.customerName || "",
      type: "折抵",
      points: -pts,
      remaining: 0,
      expireDate: "",
      orderId: order.id || "",
      note: "訂單折抵",
      lotId: "",
    });
    return ledger;
  }

  function earnPoints(ledger, order, points) {
    var pts = Math.max(0, Math.floor(Number(points) || 0));
    if (!pts) return ledger;
    var cfg = getConfig();
    var exp = addDaysStr(todayStr(), Number(cfg.expireDays) || 365);
    ledger.push({
      id: newRecordId(),
      date: todayStr(),
      phone: order.phone || "",
      lineId: order.lineId || "",
      customerName: order.customerName || "",
      type: "發放",
      points: pts,
      remaining: pts,
      expireDate: exp,
      orderId: order.id || "",
      note: "消費滿 " + cfg.spendPerPoint + " 元集點",
      lotId: "",
    });
    return ledger;
  }

  function manualAdjust(ledger, payload) {
    var pts = Math.floor(Number(payload.points) || 0);
    if (!pts) throw new Error("請輸入點數");
    var customerName = (payload.customerName || "").trim();
    var phone = (payload.phone || "").trim();
    var lineId = (payload.lineId || "").trim();
    if (!normalizeCustomerName(customerName)) throw new Error("請填客戶姓名");
    if (pts > 0) {
      var cfg = getConfig();
      ledger.push({
        id: newRecordId(),
        date: todayStr(),
        phone: phone,
        lineId: lineId,
        customerName: customerName,
        type: "調整",
        points: pts,
        remaining: pts,
        expireDate: addDaysStr(todayStr(), Number(cfg.expireDays) || 365),
        orderId: "",
        note: (payload.note || "後台手動調整").trim(),
        lotId: "",
      });
    } else {
      ledger = redeemPoints(
        ledger,
        { customerName: customerName, phone: phone, lineId: lineId, id: "ADJ" },
        Math.abs(pts)
      );
      var last = ledger[ledger.length - 1];
      if (last) {
        last.type = "調整";
        last.note = (payload.note || "後台手動扣點").trim();
        last.orderId = "";
      }
    }
    return ledger;
  }

  function shouldProcessOrder(order, cfg) {
    cfg = cfg || getConfig();
    var status = (order && order.status) ? String(order.status).trim() : "";
    return cfg.earnStatuses.indexOf(status) >= 0;
  }

  function processOrderPoints(order, previousOrder) {
    if (!order) return { order: order, ledger: getLedger(), message: "" };
    if (order.pointsProcessed === "Y" || order.pointsProcessed === true) {
      return { order: order, ledger: getLedger(), message: "此訂單紅利已處理" };
    }
    if (!shouldProcessOrder(order)) {
      return { order: order, ledger: getLedger(), message: "" };
    }
    if (!normalizeCustomerName(order.customerName)) {
      return { order: order, ledger: getLedger(), message: "缺少客戶姓名，無法發放紅利" };
    }

    var cfg = getConfig();
    var ledger = getLedger();
    var requestedPts = Math.floor(Number(order.pointsUsed) || 0);
    var pointsUsed = requestedPts;
    var balance = getBalance(order.customerName, order.phone, order.lineId);
    var msg = [];

    if (pointsUsed > 0) {
      var maxUse = calcMaxRedeemPoints(order, balance, cfg);
      if (pointsUsed > maxUse) pointsUsed = maxUse;
      if (pointsUsed > 0) ledger = redeemPoints(ledger, order, pointsUsed);
      else if (requestedPts > 0) {
        var minNet = getMinRedeemNet(cfg);
        if (minNet > 0 && merchandiseNet(order) < minNet) {
          msg.push("商品淨額未滿 " + minNet + " 元，無法折抵紅利");
        }
      }
      order.pointsUsed = pointsUsed;
    }

    var earned = calcEarnPoints(order, cfg);
    if (earned > 0) {
      ledger = earnPoints(ledger, order, earned);
      order.pointsEarned = earned;
    }

    if (pointsUsed > 0 || earned > 0) {
      order.pointsProcessed = "Y";
      saveLedger(ledger);
    }

    if (pointsUsed > 0) msg.push("折抵 " + pointsUsed + " 點");
    if (earned > 0) msg.push("發放 " + earned + " 點");
    if (!pointsUsed && !earned && normalizeCustomerName(order.customerName)) {
      var net = Math.max(0, merchandiseNet(order) - pointsUsed);
      if (net < (Number(cfg.spendPerPoint) || 100)) {
        msg.push("消費淨額未滿 " + cfg.spendPerPoint + " 元，無法集點");
      }
    }
    return {
      order: order,
      ledger: ledger,
      message: msg.length ? msg.join("，") : "",
    };
  }

  function mergeLedgers(local, remote) {
    var byId = {};
    (remote || []).forEach(function (r) {
      var id = r && (r.id || r.紀錄ID);
      if (id) byId[String(id)] = r;
    });
    (local || []).forEach(function (r) {
      var id = r && (r.id || r.紀錄ID);
      if (id) byId[String(id)] = r;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function processPendingOrders(orders) {
    if (!Array.isArray(orders)) return { processed: 0, messages: [] };
    var count = 0;
    var messages = [];
    orders.forEach(function (ord) {
      if (!ord) return;
      if (ord.pointsProcessed === "Y" || ord.pointsProcessed === true) return;
      if (!shouldProcessOrder(ord)) return;
      var result = processOrderPoints(ord, null);
      if (result.order && (result.order.pointsProcessed === "Y" || result.order.pointsProcessed === true)) count++;
      if (result.message) messages.push((ord.id || "訂單") + "：" + result.message);
    });
    return { processed: count, messages: messages };
  }

  function runGlobalExpiry() {
    var ledger = getLedger();
    var keys = {};
    ledger.forEach(function (rec) {
      var k = customerKey(rec.customerName, rec.phone, rec.lineId);
      if (!k) return;
      keys[k] = {
        customerName: rec.customerName || "",
        phone: rec.phone || "",
        lineId: rec.lineId || "",
      };
    });
    Object.keys(keys).forEach(function (k) {
      var c = keys[k];
      ledger = expireCustomerPoints(ledger, c.customerName, c.phone, c.lineId);
    });
    saveLedger(ledger);
    return ledger;
  }

  function summarizeCustomers(ledger) {
    ledger = ledger || getLedger();
    var map = {};
    ledger.forEach(function (rec) {
      var k = customerKey(rec.customerName, rec.phone, rec.lineId);
      if (!k) return;
      if (!map[k]) {
        map[k] = {
          key: k,
          phone: rec.phone || "",
          lineId: rec.lineId || "",
          customerName: rec.customerName || "",
          balance: 0,
          totalEarned: 0,
          totalUsed: 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
        };
      }
      if (rec.customerName && !map[k].customerName) map[k].customerName = rec.customerName;
      if (rec.type === "發放" || rec.type === "調整") {
        if (Number(rec.points) > 0) map[k].totalEarned += Number(rec.points);
      }
      if (rec.type === "折抵" || rec.type === "失效") {
        map[k].totalUsed += Math.abs(Number(rec.points) || 0);
      }
    });
    Object.keys(map).forEach(function (k) {
      var c = map[k];
      var lots = getActiveLots(ledger, c.customerName, c.phone, c.lineId);
      c.balance = lots.reduce(function (s, lot) { return s + (Number(lot.remaining) || 0); }, 0);
      if (lots.length) {
        c.nextExpireDate = lots[0].expireDate || "";
        c.nextExpirePoints = Number(lots[0].remaining) || 0;
      }
    });
    return Object.keys(map)
      .map(function (k) { return map[k]; })
      .sort(function (a, b) {
        var na = normalizeCustomerName(a.customerName);
        var nb = normalizeCustomerName(b.customerName);
        if (na && nb && na !== nb) return na.localeCompare(nb, "zh-Hant");
        return (b.balance || 0) - (a.balance || 0);
      });
  }

  function normalizeLedgerFromApi(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r) {
      return {
        id: r.id || r.紀錄ID || newRecordId(),
        date: r.date || r.日期 || todayStr(),
        phone: r.phone || r.電話 || "",
        lineId: r.lineId || r["Line ID"] || "",
        customerName: r.customerName || r.姓名 || "",
        type: r.type || r.類型 || "",
        points: Number(r.points != null ? r.points : r.點數) || 0,
        remaining: Number(r.remaining != null ? r.remaining : r.剩餘) || 0,
        expireDate: r.expireDate || r.到期日 || "",
        orderId: r.orderId || r.訂單編號 || "",
        note: r.note || r.備註 || "",
        lotId: r.lotId || "",
      };
    });
  }

  global.MaaruLoyalty = {
    CONFIG_KEY: CONFIG_KEY,
    LEDGER_KEY: LEDGER_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    getConfig: getConfig,
    saveConfig: saveConfig,
    getLedger: getLedger,
    saveLedger: saveLedger,
    getBalance: getBalance,
    merchandiseNet: merchandiseNet,
    calcMaxRedeemPoints: calcMaxRedeemPoints,
    getMinRedeemNet: getMinRedeemNet,
    meetsMinRedeemNet: meetsMinRedeemNet,
    calcEarnPoints: calcEarnPoints,
    pointsDiscountAmount: pointsDiscountAmount,
    processOrderPoints: processOrderPoints,
    shouldProcessOrder: shouldProcessOrder,
    manualAdjust: manualAdjust,
    runGlobalExpiry: runGlobalExpiry,
    summarizeCustomers: summarizeCustomers,
    normalizeLedgerFromApi: normalizeLedgerFromApi,
    mergeLedgers: mergeLedgers,
    processPendingOrders: processPendingOrders,
    normalizeCustomerName: normalizeCustomerName,
    customerKey: customerKey,
    todayStr: todayStr,
  };
})(typeof window !== "undefined" ? window : this);

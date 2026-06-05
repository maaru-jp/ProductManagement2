/**
 * MAARU 紅利點數 — 消費滿 100 元集 1 點，1 點折 1 元，商品淨額滿 199 元才可折抵，1 年內有效
 * 會員以「13 碼會員卡號」識別；舊資料無卡號時仍可以姓名／電話／Line 對應
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

  function normalizeMemberCardNo(card) {
    return String(card || "").replace(/\D/g, "").slice(0, 13);
  }

  function isValidMemberCardNo(card) {
    return /^\d{13}$/.test(normalizeMemberCardNo(card));
  }

  function customerKey(memberCardNo, customerName, phone, lineId) {
    var card = normalizeMemberCardNo(memberCardNo);
    if (card.length === 13) return "C:" + card;
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
      if (!Array.isArray(list)) return [];
      return list.map(function (rec) { return repairLedgerRecord(Object.assign({}, rec)); });
    } catch (e) {
      return [];
    }
  }

  function saveLedger(list) {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  }

  function recordMatchesMember(rec, memberCardNo, customerName, phone, lineId) {
    var card = normalizeMemberCardNo(memberCardNo);
    if (card.length === 13) {
      var recCard = normalizeMemberCardNo(rec.memberCardNo);
      return recCard.length === 13 && recCard === card;
    }
    var n = normalizeCustomerName(customerName);
    if (n && normalizeCustomerName(rec.customerName) === n) return true;
    if (n) return false;
    var p = normalizePhone(phone);
    var l = normalizeLineId(lineId);
    if (p && normalizePhone(rec.phone) === p) return true;
    if (l && normalizeLineId(rec.lineId) === l) return true;
    return false;
  }

  function normalizeOrderIdToken_(id) {
    var s = String(id || "").trim().replace(/\s+/g, "").toUpperCase();
    if (!s) return "";
    var m = s.match(/^ORD(\d+)$/i);
    if (m) return "ORD" + ("00000" + parseInt(m[1], 10)).slice(-5);
    if (/^\d+$/.test(s)) return "ORD" + ("00000" + parseInt(s, 10)).slice(-5);
    return s;
  }

  /** 從訂單＋紅利紀錄建立姓名／電話／Line → 卡號對照，供合併舊資料 */
  function buildMemberIdentityIndex(ledger, orders) {
    var nameToCard = {};
    var phoneToCard = {};
    var lineToCard = {};
    var cardToNames = {};
    var orderIdToCard = {};

    (orders || []).forEach(function (ord) {
      if (!ord) return;
      var card = normalizeMemberCardNo(ord.memberCardNo);
      if (!isValidMemberCardNo(card)) return;
      var oid = normalizeOrderIdToken_(ord.id);
      if (oid) orderIdToCard[oid] = card;
    });

    function register(card, name, phone, lineId, forceName) {
      card = normalizeMemberCardNo(card);
      if (!isValidMemberCardNo(card)) return;
      var n = normalizeCustomerName(name);
      if (n) {
        if (forceName || !nameToCard[n]) nameToCard[n] = card;
        if (!cardToNames[card]) cardToNames[card] = {};
        cardToNames[card][n] = true;
      }
      var p = normalizePhone(phone);
      if (p && !phoneToCard[p]) phoneToCard[p] = card;
      var l = normalizeLineId(lineId);
      if (l && !lineToCard[l]) lineToCard[l] = card;
    }

    (orders || []).forEach(function (ord) {
      if (!ord) return;
      register(ord.memberCardNo, ord.customerName, ord.phone, ord.lineId, false);
    });
    (ledger || []).forEach(function (rec) {
      if (!rec) return;
      register(rec.memberCardNo, rec.customerName, rec.phone, rec.lineId, false);
    });

    function resolveCard(rec) {
      if (!rec) return "";
      var direct = normalizeMemberCardNo(rec.memberCardNo);
      if (isValidMemberCardNo(direct)) return direct;
      var oid = normalizeOrderIdToken_(rec.orderId);
      if (oid && orderIdToCard[oid]) return orderIdToCard[oid];
      var n = normalizeCustomerName(rec.customerName);
      if (n && nameToCard[n]) return nameToCard[n];
      var p = normalizePhone(rec.phone);
      if (p && phoneToCard[p]) return phoneToCard[p];
      var l = normalizeLineId(rec.lineId);
      if (l && lineToCard[l]) return lineToCard[l];
      if (global.MaaruMemberCard && MaaruMemberCard.findMemberCardForCustomer) {
        var found = MaaruMemberCard.findMemberCardForCustomer(
          orders,
          rec.customerName,
          rec.phone,
          rec.lineId,
          ""
        );
        if (isValidMemberCardNo(found)) return normalizeMemberCardNo(found);
      }
      return "";
    }

    (ledger || []).forEach(function (rec) {
      if (!rec) return;
      var card = resolveCard(rec);
      if (!isValidMemberCardNo(card)) return;
      register(card, rec.customerName, rec.phone, rec.lineId, true);
    });

    function linkedNamesForCard(card) {
      card = normalizeMemberCardNo(card);
      if (!isValidMemberCardNo(card)) return [];
      return Object.keys(cardToNames[card] || {});
    }

    return {
      resolveCard: resolveCard,
      linkedNamesForCard: linkedNamesForCard,
      nameToCard: nameToCard,
      orderIdToCard: orderIdToCard,
    };
  }

  /** 與 Code.gs 一致：有卡號時，舊紀錄（僅姓名）可併入同卡客戶 */
  function collectLinkedCustomerNamesForCard(orders, card, ledger) {
    var c = normalizeMemberCardNo(card);
    if (!isValidMemberCardNo(c)) return [];
    var idx = buildMemberIdentityIndex(ledger || getLedger(), orders);
    return idx.linkedNamesForCard(c);
  }

  function recordMatchesMemberExtended(rec, memberCardNo, customerName, phone, lineId, linkedNames, orders, ledger) {
    var card = normalizeMemberCardNo(memberCardNo);
    if (isValidMemberCardNo(card)) {
      var recCard = normalizeMemberCardNo(rec.memberCardNo);
      if (isValidMemberCardNo(recCard)) return recCard === card;
      if (recCard) return false;
      var idx = buildMemberIdentityIndex(ledger || getLedger(), orders || []);
      if (idx.resolveCard(rec) === card) return true;
      if (linkedNames && linkedNames.length) {
        var rn = normalizeCustomerName(rec.customerName);
        if (rn && linkedNames.indexOf(rn) >= 0) return true;
      }
      return false;
    }
    return recordMatchesMember(rec, memberCardNo, customerName, phone, lineId);
  }

  function resolveMemberCardForRecord(rec, orders, ledger) {
    var recCard = normalizeMemberCardNo(rec && rec.memberCardNo);
    if (isValidMemberCardNo(recCard)) return recCard;
    var idx = buildMemberIdentityIndex(ledger || getLedger(), orders);
    return idx.resolveCard(rec);
  }

  function canonicalCustomerKeyFromParts(memberCardNo, customerName, phone, lineId, orders, ledger) {
    var card = normalizeMemberCardNo(memberCardNo);
    if (isValidMemberCardNo(card)) return "C:" + card;
    var resolved = resolveMemberCardForRecord(
      { memberCardNo: "", customerName: customerName, phone: phone, lineId: lineId },
      orders,
      ledger
    );
    if (isValidMemberCardNo(resolved)) return "C:" + resolved;
    return customerKey(memberCardNo, customerName, phone, lineId);
  }

  function canonicalCustomerKey(rec, orders, ledger) {
    return canonicalCustomerKeyFromParts(rec.memberCardNo, rec.customerName, rec.phone, rec.lineId, orders, ledger);
  }

  function backfillLedgerMemberCards(ledger, orders, persist) {
    return consolidateLedgerMemberCards(ledger, orders, persist);
  }

  /** 多輪補齊＋合併 ledger 會員卡號，避免舊姓名紀錄與新卡號紀錄分裂 */
  function consolidateLedgerMemberCards(ledger, orders, persist) {
    ledger = (ledger || []).slice();
    orders = orders || [];
    var changed = false;
    var pass;
    for (pass = 0; pass < 5; pass++) {
      var idx = buildMemberIdentityIndex(ledger, orders);
      var passChanged = false;
      ledger = ledger.map(function (rec) {
        var resolved = idx.resolveCard(rec);
        if (!isValidMemberCardNo(resolved)) return rec;
        var current = normalizeMemberCardNo(rec.memberCardNo);
        if (current === resolved) return rec;
        passChanged = true;
        changed = true;
        return Object.assign({}, rec, { memberCardNo: resolved });
      });
      if (!passChanged) break;
    }
    if (changed && persist !== false) saveLedger(ledger);
    return { ledger: ledger, changed: changed };
  }

  function pickRicherLedgerRecord_(a, b) {
    if (!a) return b;
    if (!b) return a;
    function score(r) {
      var s = 0;
      if (isValidMemberCardNo(r.memberCardNo)) s += 8;
      if (normalizeCustomerName(r.customerName)) s += 2;
      if (normalizePhone(r.phone)) s += 1;
      if (normalizeLineId(r.lineId)) s += 1;
      if (Number(r.remaining) > 0) s += 3;
      if (r.orderId) s += 1;
      return s;
    }
    var sa = score(a);
    var sb = score(b);
    if (sa === sb && isValidMemberCardNo(b.memberCardNo) && !isValidMemberCardNo(a.memberCardNo)) return b;
    return sa >= sb ? a : b;
  }

  function expireCustomerPoints(ledger, memberCardNo, customerName, phone, lineId, orders) {
    var today = todayStr();
    var changed = false;
    var linkedNames = isValidMemberCardNo(memberCardNo)
      ? collectLinkedCustomerNamesForCard(orders, memberCardNo, ledger)
      : [];
    ledger.forEach(function (rec) {
      if (rec.type !== "發放") return;
      if (!recordMatchesMemberExtended(rec, memberCardNo, customerName, phone, lineId, linkedNames, orders, ledger)) return;
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
        memberCardNo: rec.memberCardNo || "",
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

  function getActiveLots(ledger, memberCardNo, customerName, phone, lineId, orders) {
    orders = orders || [];
    var linkedNames = isValidMemberCardNo(memberCardNo)
      ? collectLinkedCustomerNamesForCard(orders, memberCardNo, ledger)
      : [];
    ledger = expireCustomerPoints(ledger.slice(), memberCardNo, customerName, phone, lineId, orders);
    var today = todayStr();
    return ledger
      .filter(function (rec) {
        rec.type = normalizeLedgerType(rec.type);
        if (rec.type !== "發放" && rec.type !== "調整") return false;
        if (!recordMatchesMemberExtended(rec, memberCardNo, customerName, phone, lineId, linkedNames, orders, ledger)) {
          return false;
        }
        var remaining = effectiveRemaining(rec);
        if (!remaining || remaining <= 0) return false;
        var exp = rec.expireDate ? String(rec.expireDate).slice(0, 10) : "";
        return !exp || exp >= today;
      })
      .sort(function (a, b) {
        return String(a.date || "").localeCompare(String(b.date || ""));
      });
  }

  function getBalance(memberCardNo, customerName, phone, lineId, orders) {
    if (arguments.length === 3 && !isValidMemberCardNo(memberCardNo)) {
      lineId = phone;
      phone = customerName;
      customerName = memberCardNo;
      memberCardNo = "";
    }
    if (!Array.isArray(orders)) orders = [];
    var ledger = getLedger();
    return getActiveLots(ledger, memberCardNo, customerName, phone, lineId, orders).reduce(function (sum, lot) {
      return sum + (Number(lot.remaining) || 0);
    }, 0);
  }

  function merchandiseNet(order) {
    var sub = Number(order && order.subtotal) || 0;
    var disc = Number(order && order.discount) || 0;
    return Math.max(0, Math.ceil(sub - disc));
  }

  /** 集點金額：商品淨額 − 紅利折抵（不含運費、不含預購訂金，非待結清總金額） */
  function earnPointsBase(order) {
    var used = Number(order && order.pointsUsed) || 0;
    return Math.max(0, merchandiseNet(order) - used);
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
    var base = earnPointsBase(order);
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
    var lots = getActiveLots(ledger, order.memberCardNo, order.customerName, order.phone, order.lineId, [order]);
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
      memberCardNo: normalizeMemberCardNo(order.memberCardNo),
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
      memberCardNo: normalizeMemberCardNo(order.memberCardNo),
      type: "發放",
      points: pts,
      remaining: pts,
      expireDate: exp,
      orderId: order.id || "",
      note: "消費滿 " + cfg.spendPerPoint + " 元集點（不含運費）",
      lotId: "",
    });
    return ledger;
  }

  function manualAdjust(ledger, payload) {
    var pts = Math.floor(Number(payload.points) || 0);
    if (!pts) throw new Error("請輸入點數");
    var memberCardNo = normalizeMemberCardNo(payload.memberCardNo);
    var customerName = (payload.customerName || "").trim();
    var phone = (payload.phone || "").trim();
    var lineId = (payload.lineId || "").trim();
    if (!isValidMemberCardNo(memberCardNo)) throw new Error("請填 13 碼會員卡號");
    if (pts > 0) {
      var cfg = getConfig();
      ledger.push({
        id: newRecordId(),
        date: todayStr(),
        phone: phone,
        lineId: lineId,
        customerName: customerName,
        memberCardNo: memberCardNo,
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
        { memberCardNo: memberCardNo, customerName: customerName, phone: phone, lineId: lineId, id: "ADJ" },
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
    var card = normalizeMemberCardNo(order.memberCardNo);
    if (!isValidMemberCardNo(card)) {
      return { order: order, ledger: getLedger(), message: "缺少有效會員卡號，無法處理紅利" };
    }
    order.memberCardNo = card;

    var cfg = getConfig();
    var ledger = getLedger();
    var requestedPts = Math.floor(Number(order.pointsUsed) || 0);
    var pointsUsed = requestedPts;
    var balance = getBalance(card, order.customerName, order.phone, order.lineId, [order]);
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
    if (!pointsUsed && !earned && isValidMemberCardNo(card)) {
      var earnBase = earnPointsBase(order);
      if (earnBase < (Number(cfg.spendPerPoint) || 100)) {
        msg.push("集點金額未滿 " + cfg.spendPerPoint + " 元，無法集點");
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
      if (!id) return;
      var key = String(id);
      byId[key] = pickRicherLedgerRecord_(byId[key], r);
    });
    (local || []).forEach(function (r) {
      var id = r && (r.id || r.紀錄ID);
      if (!id) return;
      var key = String(id);
      byId[key] = pickRicherLedgerRecord_(byId[key], r);
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

  function runGlobalExpiry(orders) {
    orders = orders || [];
    var bf = consolidateLedgerMemberCards(getLedger(), orders, true);
    var ledger = bf.ledger;
    var keys = {};
    ledger.forEach(function (rec) {
      var k = canonicalCustomerKey(rec, orders, ledger);
      if (!k) return;
      if (!keys[k]) {
        keys[k] = {
          memberCardNo: rec.memberCardNo || "",
          customerName: rec.customerName || "",
          phone: rec.phone || "",
          lineId: rec.lineId || "",
        };
      }
      if (rec.memberCardNo && !keys[k].memberCardNo) keys[k].memberCardNo = rec.memberCardNo;
      if (rec.customerName && !keys[k].customerName) keys[k].customerName = rec.customerName;
    });
    Object.keys(keys).forEach(function (k) {
      var c = keys[k];
      if (k.indexOf("C:") === 0 && !isValidMemberCardNo(c.memberCardNo)) {
        c.memberCardNo = k.slice(2);
      }
      ledger = expireCustomerPoints(ledger, c.memberCardNo, c.customerName, c.phone, c.lineId, orders);
    });
    saveLedger(ledger);
    return ledger;
  }

  function buildOrderMemberIndex(orders) {
    var byCard = {};
    (orders || []).forEach(function (ord) {
      if (!ord) return;
      var card = normalizeMemberCardNo(ord.memberCardNo);
      if (!isValidMemberCardNo(card)) return;
      if (!byCard[card]) {
        byCard[card] = {
          memberCardNo: card,
          customerName: ord.customerName || "",
          phone: ord.phone || "",
          lineId: ord.lineId || "",
          orderDate: ord.date || "",
        };
        return;
      }
      var d = String(ord.date || "");
      if (d >= String(byCard[card].orderDate || "")) {
        if (ord.customerName) byCard[card].customerName = ord.customerName;
        if (ord.phone) byCard[card].phone = ord.phone;
        if (ord.lineId) byCard[card].lineId = ord.lineId;
        byCard[card].orderDate = d;
      } else {
        if (!byCard[card].customerName && ord.customerName) byCard[card].customerName = ord.customerName;
        if (!byCard[card].phone && ord.phone) byCard[card].phone = ord.phone;
        if (!byCard[card].lineId && ord.lineId) byCard[card].lineId = ord.lineId;
      }
    });
    return byCard;
  }

  function sortCustomerSummaries(list) {
    return (list || []).slice().sort(function (a, b) {
      var ca = normalizeMemberCardNo(a.memberCardNo);
      var cb = normalizeMemberCardNo(b.memberCardNo);
      if (ca && cb && ca !== cb) return ca.localeCompare(cb);
      var na = normalizeCustomerName(a.customerName);
      var nb = normalizeCustomerName(b.customerName);
      if (na && nb && na !== nb) return na.localeCompare(nb, "zh-Hant");
      return (b.balance || 0) - (a.balance || 0);
    });
  }

  function enrichCustomerProfile_(c, orders) {
    var card = normalizeMemberCardNo(c.memberCardNo);
    if (!isValidMemberCardNo(card) && c.key && c.key.indexOf("C:") === 0) {
      card = c.key.slice(2);
      c.memberCardNo = card;
    }
    var om = buildOrderMemberIndex(orders)[card];
    if (om) {
      if (!c.customerName && om.customerName) c.customerName = om.customerName;
      if (!c.phone && om.phone) c.phone = om.phone;
      if (!c.lineId && om.lineId) c.lineId = om.lineId;
    }
    return c;
  }

  function applyBalanceToCustomer_(c, ledger, orders) {
    var card = normalizeMemberCardNo(c.memberCardNo);
    if (!isValidMemberCardNo(card) && c.key && c.key.indexOf("C:") === 0) {
      card = c.key.slice(2);
      c.memberCardNo = card;
    }
    var lots = getActiveLots(ledger, card, c.customerName, c.phone, c.lineId, orders);
    c.balance = lots.reduce(function (s, lot) { return s + (Number(lot.remaining) || 0); }, 0);
    if (lots.length) {
      c.nextExpireDate = lots[0].expireDate || "";
      c.nextExpirePoints = Number(lots[0].remaining) || 0;
    } else {
      c.nextExpireDate = "";
      c.nextExpirePoints = 0;
    }
    return c;
  }

  function collapseCustomerMapByResolvedCard_(map, orders, ledger) {
    var idx = buildMemberIdentityIndex(ledger, orders);
    var next = {};
    Object.keys(map || {}).forEach(function (k) {
      var entry = map[k];
      if (!entry) return;
      var card = normalizeMemberCardNo(entry.memberCardNo);
      if (k.indexOf("C:") === 0 && !isValidMemberCardNo(card)) {
        card = normalizeMemberCardNo(k.slice(2));
      }
      if (!isValidMemberCardNo(card)) {
        card = idx.resolveCard({
          memberCardNo: entry.memberCardNo,
          customerName: entry.customerName,
          phone: entry.phone,
          lineId: entry.lineId,
        });
      }
      var targetKey = isValidMemberCardNo(card) ? ("C:" + card) : k;
      if (!next[targetKey]) {
        next[targetKey] = {
          key: targetKey,
          memberCardNo: isValidMemberCardNo(card) ? card : "",
          phone: entry.phone || "",
          lineId: entry.lineId || "",
          customerName: entry.customerName || "",
          balance: 0,
          totalEarned: entry.totalEarned || 0,
          totalUsed: entry.totalUsed || 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
        };
      } else {
        var tgt = next[targetKey];
        if (!tgt.customerName && entry.customerName) tgt.customerName = entry.customerName;
        if (!tgt.phone && entry.phone) tgt.phone = entry.phone;
        if (!tgt.lineId && entry.lineId) tgt.lineId = entry.lineId;
        if (!tgt.memberCardNo && isValidMemberCardNo(card)) tgt.memberCardNo = card;
        tgt.totalEarned = (tgt.totalEarned || 0) + (entry.totalEarned || 0);
        tgt.totalUsed = (tgt.totalUsed || 0) + (entry.totalUsed || 0);
      }
    });
    return next;
  }

  function mergeDuplicateCardCustomerKeys_(map) {
    var cardToKey = {};
    Object.keys(map).slice().forEach(function (k) {
      var entry = map[k];
      if (!entry) return;
      var card = normalizeMemberCardNo(entry.memberCardNo);
      if (k.indexOf("C:") === 0 && !isValidMemberCardNo(card)) card = k.slice(2);
      if (!isValidMemberCardNo(card)) return;
      var ck = "C:" + card;
      if (!cardToKey[card]) cardToKey[card] = ck;
      var targetKey = cardToKey[card];
      if (k === targetKey) {
        if (!entry.memberCardNo) entry.memberCardNo = card;
        return;
      }
      if (!map[targetKey]) {
        map[targetKey] = {
          key: targetKey,
          memberCardNo: card,
          phone: entry.phone || "",
          lineId: entry.lineId || "",
          customerName: entry.customerName || "",
          balance: 0,
          totalEarned: entry.totalEarned || 0,
          totalUsed: entry.totalUsed || 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
        };
      } else {
        var tgt = map[targetKey];
        if (!tgt.memberCardNo) tgt.memberCardNo = card;
        if (!tgt.customerName && entry.customerName) tgt.customerName = entry.customerName;
        if (!tgt.phone && entry.phone) tgt.phone = entry.phone;
        if (!tgt.lineId && entry.lineId) tgt.lineId = entry.lineId;
        tgt.totalEarned = (tgt.totalEarned || 0) + (entry.totalEarned || 0);
        tgt.totalUsed = (tgt.totalUsed || 0) + (entry.totalUsed || 0);
      }
      delete map[k];
    });
    return map;
  }

  function mergeOrphanCustomerKeys_(map, orders, ledger) {
    var idx = buildMemberIdentityIndex(ledger, orders);
    Object.keys(map).slice().forEach(function (k) {
      if (k.indexOf("C:") === 0) return;
      var entry = map[k];
      if (!entry) return;
      var card = idx.resolveCard({
        memberCardNo: entry.memberCardNo,
        customerName: entry.customerName,
        phone: entry.phone,
        lineId: entry.lineId,
      });
      if (!isValidMemberCardNo(card)) return;
      var ck = "C:" + card;
      if (ck === k) return;
      if (!map[ck]) {
        map[ck] = {
          key: ck,
          memberCardNo: card,
          phone: entry.phone || "",
          lineId: entry.lineId || "",
          customerName: entry.customerName || "",
          balance: 0,
          totalEarned: entry.totalEarned || 0,
          totalUsed: entry.totalUsed || 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
        };
      } else {
        var tgt = map[ck];
        if (!tgt.customerName && entry.customerName) tgt.customerName = entry.customerName;
        if (!tgt.phone && entry.phone) tgt.phone = entry.phone;
        if (!tgt.lineId && entry.lineId) tgt.lineId = entry.lineId;
        tgt.totalEarned = (tgt.totalEarned || 0) + (entry.totalEarned || 0);
        tgt.totalUsed = (tgt.totalUsed || 0) + (entry.totalUsed || 0);
      }
      delete map[k];
    });
    return map;
  }

  function summarizeCustomersWithOrders(ledger, orders) {
    orders = orders || [];
    var bf = consolidateLedgerMemberCards(ledger || getLedger(), orders, true);
    ledger = bf.ledger;
    var map = {};
    ledger.forEach(function (rec) {
      var k = canonicalCustomerKey(rec, orders, ledger);
      if (!k) return;
      if (!map[k]) {
        map[k] = {
          key: k,
          memberCardNo: "",
          phone: "",
          lineId: "",
          customerName: "",
          balance: 0,
          totalEarned: 0,
          totalUsed: 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
        };
      }
      if (rec.memberCardNo && !map[k].memberCardNo) {
        map[k].memberCardNo = normalizeMemberCardNo(rec.memberCardNo);
      }
      if (rec.customerName && !map[k].customerName) map[k].customerName = rec.customerName;
      if (rec.phone && !map[k].phone) map[k].phone = rec.phone;
      if (rec.lineId && !map[k].lineId) map[k].lineId = rec.lineId;
      if (rec.type === "發放" || rec.type === "調整") {
        if (Number(rec.points) > 0) map[k].totalEarned += Number(rec.points);
      }
      if (rec.type === "折抵" || rec.type === "失效") {
        map[k].totalUsed += Math.abs(Number(rec.points) || 0);
      }
    });
    var orderMembers = buildOrderMemberIndex(orders);
    Object.keys(orderMembers).forEach(function (card) {
      var k = "C:" + card;
      if (!map[k]) {
        map[k] = {
          key: k,
          memberCardNo: card,
          phone: orderMembers[card].phone || "",
          lineId: orderMembers[card].lineId || "",
          customerName: orderMembers[card].customerName || "",
          balance: 0,
          totalEarned: 0,
          totalUsed: 0,
          nextExpireDate: "",
          nextExpirePoints: 0,
          fromOrdersOnly: true,
        };
      }
    });
    map = mergeOrphanCustomerKeys_(map, orders, ledger);
    map = mergeDuplicateCardCustomerKeys_(map);
    map = collapseCustomerMapByResolvedCard_(map, orders, ledger);
    Object.keys(map).forEach(function (k) {
      map[k] = applyBalanceToCustomer_(enrichCustomerProfile_(map[k], orders), ledger, orders);
    });
    return sortCustomerSummaries(Object.keys(map).map(function (k) { return map[k]; }));
  }

  function summarizeCustomers(ledger) {
    return summarizeCustomersWithOrders(ledger, []);
  }

  function normalizeLedgerType(type) {
    var t = String(type || "").trim();
    if (t === "发放" || t.indexOf("發放") >= 0) return "發放";
    if (t === "折抵" || t === "扣除" || t === "使用") return "折抵";
    if (t === "失效" || t === "过期") return "失效";
    if (t === "调整" || t.indexOf("調整") >= 0) return "調整";
    return t;
  }

  function repairLedgerRecord(rec) {
    if (!rec) return rec;
    rec.type = normalizeLedgerType(rec.type);
    var pts = Number(rec.points) || 0;
    var unset = rec.remaining === "" || rec.remaining == null || rec.remaining === undefined;
    if ((rec.type === "發放" || rec.type === "調整") && pts > 0 && unset) {
      rec.remaining = pts;
    }
    if ((rec.type === "折抵" || rec.type === "失效") && unset) {
      rec.remaining = 0;
    }
    return rec;
  }

  function effectiveRemaining(rec) {
    if (!rec) return 0;
    if (rec.type !== "發放" && rec.type !== "調整") return 0;
    var unset = rec.remaining === "" || rec.remaining == null || rec.remaining === undefined;
    if (!unset) {
      var rem = Number(rec.remaining);
      if (!isNaN(rem) && rem >= 0) return rem;
    }
    var pts = Number(rec.points) || 0;
    return pts > 0 ? pts : 0;
  }

  function normalizeLedgerFromApi(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r) {
      return repairLedgerRecord({
        id: r.id || r.紀錄ID || newRecordId(),
        date: r.date || r.日期 || todayStr(),
        phone: r.phone || r.電話 || "",
        lineId: r.lineId || r["Line ID"] || "",
        customerName: r.customerName || r.姓名 || "",
        memberCardNo: normalizeMemberCardNo(r.memberCardNo || r["會員卡號"] || ""),
        type: r.type || r.類型 || "",
        points: Number(r.points != null ? r.points : r.點數) || 0,
        remaining: (r.remaining != null && r.remaining !== "") ? Number(r.remaining) : undefined,
        expireDate: r.expireDate || r.到期日 || "",
        orderId: r.orderId || r.訂單編號 || "",
        note: r.note || r.備註 || "",
        lotId: r.lotId || "",
      });
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
    earnPointsBase: earnPointsBase,
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
    summarizeCustomersWithOrders: summarizeCustomersWithOrders,
    normalizeLedgerFromApi: normalizeLedgerFromApi,
    mergeLedgers: mergeLedgers,
    backfillLedgerMemberCards: backfillLedgerMemberCards,
    consolidateLedgerMemberCards: consolidateLedgerMemberCards,
    collapseCustomerMapByResolvedCard_: collapseCustomerMapByResolvedCard_,
    buildMemberIdentityIndex: buildMemberIdentityIndex,
    collectLinkedCustomerNamesForCard: collectLinkedCustomerNamesForCard,
    canonicalCustomerKey: canonicalCustomerKey,
    processPendingOrders: processPendingOrders,
    normalizeCustomerName: normalizeCustomerName,
    normalizeMemberCardNo: normalizeMemberCardNo,
    isValidMemberCardNo: isValidMemberCardNo,
    customerKey: customerKey,
    todayStr: todayStr,
  };
})(typeof window !== "undefined" ? window : this);

/**
 * MAARU 會員卡號 — 13 碼純數字、全系統唯一
 */
(function (global) {
  var MEMBER_CARD_LENGTH = 13;

  function normalizeMemberCardNo(card) {
    return String(card || "").replace(/\D/g, "").slice(0, MEMBER_CARD_LENGTH);
  }

  function isValidMemberCardNo(card) {
    return /^\d{13}$/.test(normalizeMemberCardNo(card));
  }

  function collectUsedMemberCardsFromLedger(ledger) {
    var used = {};
    (ledger || []).forEach(function (rec) {
      var c = normalizeMemberCardNo(rec && rec.memberCardNo);
      if (isValidMemberCardNo(c)) used[c] = true;
    });
    return used;
  }

  function collectUsedMemberCardsFromOrders(orders) {
    var used = {};
    (orders || []).forEach(function (ord) {
      var c = normalizeMemberCardNo(ord && ord.memberCardNo);
      if (isValidMemberCardNo(c)) used[c] = true;
    });
    return used;
  }

  function mergeUsedSets() {
    var used = {};
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i] || {};
      Object.keys(src).forEach(function (k) {
        used[k] = true;
      });
    }
    return used;
  }

  function generateUniqueMemberCardNo(used) {
    used = used || {};
    for (var attempt = 0; attempt < 300; attempt++) {
      var digits = "";
      digits += String(1 + Math.floor(Math.random() * 9));
      for (var i = 1; i < MEMBER_CARD_LENGTH; i++) {
        digits += String(Math.floor(Math.random() * 10));
      }
      if (!used[digits]) return digits;
    }
    throw new Error("無法產生唯一會員卡號，請稍後再試");
  }

  function findMemberCardForCustomer(orders, customerName, phone, lineId, excludeOrderId) {
    var normalizeName = function (name) {
      return String(name || "").trim().replace(/\s+/g, "");
    };
    var normalizePhone = function (p) {
      return String(p || "").replace(/\D/g, "");
    };
    var n = normalizeName(customerName);
    var p = normalizePhone(phone);
    var exclude = String(excludeOrderId || "").trim().toUpperCase();
    for (var i = 0; i < (orders || []).length; i++) {
      var ord = orders[i];
      if (!ord) continue;
      if (exclude && String(ord.id || "").trim().toUpperCase() === exclude) continue;
      var card = normalizeMemberCardNo(ord.memberCardNo);
      if (!isValidMemberCardNo(card)) continue;
      if (n && normalizeName(ord.customerName) === n) return card;
      if (!n && p && normalizePhone(ord.phone) === p) return card;
    }
    return "";
  }

  function isMemberCardTaken(card, orders, ledger, excludeOrderId) {
    var c = normalizeMemberCardNo(card);
    if (!isValidMemberCardNo(c)) return false;
    var exclude = String(excludeOrderId || "").trim().toUpperCase();
    for (var i = 0; i < (orders || []).length; i++) {
      var ord = orders[i];
      if (!ord) continue;
      if (exclude && String(ord.id || "").trim().toUpperCase() === exclude) continue;
      if (normalizeMemberCardNo(ord.memberCardNo) === c) return true;
    }
    for (var j = 0; j < (ledger || []).length; j++) {
      var rec = ledger[j];
      if (!rec) continue;
      if (normalizeMemberCardNo(rec.memberCardNo) === c) return true;
    }
    return false;
  }

  function lookupMembersByQuery(orders, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    var qDigits = q.replace(/\D/g, "");
    var normalizeName = function (name) {
      return String(name || "").trim().replace(/\s+/g, "").toLowerCase();
    };
    var normalizePhone = function (p) {
      return String(p || "").replace(/\D/g, "");
    };
    var byKey = {};
    (orders || []).forEach(function (ord) {
      if (!ord) return;
      var card = normalizeMemberCardNo(ord.memberCardNo);
      var name = String(ord.customerName || "").trim();
      var nameNorm = normalizeName(name);
      var phone = normalizePhone(ord.phone);
      var lineId = String(ord.lineId || "").trim().toLowerCase();
      var match = false;
      if (name && name.toLowerCase().indexOf(q) >= 0) match = true;
      else if (nameNorm && nameNorm.indexOf(q.replace(/\s+/g, "")) >= 0) match = true;
      else if (qDigits.length >= 4 && isValidMemberCardNo(card) && card.indexOf(qDigits) >= 0) match = true;
      else if (qDigits.length >= 4 && phone && phone.indexOf(qDigits) >= 0) match = true;
      else if (lineId && lineId.indexOf(q) >= 0) match = true;
      if (!match) return;
      var dedupeKey = isValidMemberCardNo(card) ? "C:" + card : "N:" + nameNorm + "|" + phone;
      if (!byKey[dedupeKey]) {
        byKey[dedupeKey] = {
          memberCardNo: isValidMemberCardNo(card) ? card : "",
          customerName: name,
          phone: ord.phone || "",
          lineId: ord.lineId || "",
          orderCount: 0,
          lastOrderDate: ord.date || "",
        };
      }
      byKey[dedupeKey].orderCount += 1;
      if (isValidMemberCardNo(card) && !byKey[dedupeKey].memberCardNo) {
        byKey[dedupeKey].memberCardNo = card;
      }
      if (ord.date && String(ord.date) >= String(byKey[dedupeKey].lastOrderDate || "")) {
        byKey[dedupeKey].lastOrderDate = ord.date;
        if (name) byKey[dedupeKey].customerName = name;
        if (ord.phone) byKey[dedupeKey].phone = ord.phone;
        if (ord.lineId) byKey[dedupeKey].lineId = ord.lineId;
        if (isValidMemberCardNo(card)) byKey[dedupeKey].memberCardNo = card;
      }
    });
    return Object.keys(byKey)
      .map(function (k) {
        return byKey[k];
      })
      .sort(function (a, b) {
        var na = normalizeName(a.customerName);
        var nb = normalizeName(b.customerName);
        if (na && nb && na !== nb) return na.localeCompare(nb, "zh-Hant");
        return (b.orderCount || 0) - (a.orderCount || 0);
      });
  }

  function ensureOrderMemberCard(order, orders, ledger) {
    order = order || {};
    orders = orders || [];
    ledger = ledger || [];
    var editId = order.id || "";
    var card = normalizeMemberCardNo(order.memberCardNo);
    if (isValidMemberCardNo(card)) {
      if (isMemberCardTaken(card, orders, ledger, editId)) {
        throw new Error("會員卡號 " + card + " 已被其他顧客使用");
      }
      return card;
    }
    if (editId) {
      var editKey = String(editId).trim().toUpperCase();
      for (var oi = 0; oi < orders.length; oi++) {
        var editingOrd = orders[oi];
        if (!editingOrd) continue;
        if (String(editingOrd.id || "").trim().toUpperCase() !== editKey) continue;
        var savedCard = normalizeMemberCardNo(editingOrd.memberCardNo);
        if (isValidMemberCardNo(savedCard)) return savedCard;
        break;
      }
    }
    var existing = findMemberCardForCustomer(
      orders,
      order.customerName,
      order.phone,
      order.lineId,
      editId
    );
    if (isValidMemberCardNo(existing)) return existing;
    var used = mergeUsedSets(
      collectUsedMemberCardsFromOrders(orders),
      collectUsedMemberCardsFromLedger(ledger)
    );
    return generateUniqueMemberCardNo(used);
  }

  global.MaaruMemberCard = {
    MEMBER_CARD_LENGTH: MEMBER_CARD_LENGTH,
    normalizeMemberCardNo: normalizeMemberCardNo,
    isValidMemberCardNo: isValidMemberCardNo,
    generateUniqueMemberCardNo: generateUniqueMemberCardNo,
    collectUsedMemberCardsFromLedger: collectUsedMemberCardsFromLedger,
    collectUsedMemberCardsFromOrders: collectUsedMemberCardsFromOrders,
    findMemberCardForCustomer: findMemberCardForCustomer,
    lookupMembersByQuery: lookupMembersByQuery,
    isMemberCardTaken: isMemberCardTaken,
    ensureOrderMemberCard: ensureOrderMemberCard,
  };
})(typeof window !== "undefined" ? window : this);

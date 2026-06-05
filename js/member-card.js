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
    isMemberCardTaken: isMemberCardTaken,
    ensureOrderMemberCard: ensureOrderMemberCard,
  };
})(typeof window !== "undefined" ? window : this);

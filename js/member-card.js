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

  function normalizeCustomerName(name) {
    return String(name || "").trim().replace(/\s+/g, "");
  }

  function normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function isSameCustomerProfile(nameA, phoneA, nameB, phoneB) {
    var na = normalizeCustomerName(nameA);
    var nb = normalizeCustomerName(nameB);
    if (na && nb) return na === nb;
    if (na || nb) return false;
    var pa = normalizePhone(phoneA);
    var pb = normalizePhone(phoneB);
    return !!(pa && pb && pa === pb);
  }

  function findMemberCardForCustomer(orders, customerName, phone, lineId, excludeOrderId) {
    var normalizeName = normalizeCustomerName;
    var normalizePhoneLocal = function (p) {
      return String(p || "").replace(/\D/g, "");
    };
    var n = normalizeName(customerName);
    var p = normalizePhoneLocal(phone);
    var exclude = String(excludeOrderId || "").trim().toUpperCase();
    var cards = {};
    for (var i = 0; i < (orders || []).length; i++) {
      var ord = orders[i];
      if (!ord) continue;
      if (exclude && String(ord.id || "").trim().toUpperCase() === exclude) continue;
      var card = normalizeMemberCardNo(ord.memberCardNo);
      if (!isValidMemberCardNo(card)) continue;
      if (n && normalizeName(ord.customerName) === n) cards[card] = true;
      else if (!n && p && normalizePhoneLocal(ord.phone) === p) cards[card] = true;
    }
    var list = Object.keys(cards);
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    if (n && global.MaaruLoyalty && MaaruLoyalty.pickCanonicalMemberCardForCustomer_) {
      var ledger = MaaruLoyalty.getLedger ? MaaruLoyalty.getLedger() : [];
      var canonical = MaaruLoyalty.pickCanonicalMemberCardForCustomer_(n, orders, ledger);
      if (isValidMemberCardNo(canonical)) return canonical;
    }
    return list[0];
  }

  function validateMemberCardAssignment(card, orders, ledger, customerName, phone, excludeOrderId) {
    var c = normalizeMemberCardNo(card);
    if (!isValidMemberCardNo(c)) {
      return { ok: false, conflict: false, incomplete: true, sameCustomerReuse: false, message: "" };
    }
    var exclude = String(excludeOrderId || "").trim().toUpperCase();
    var usages = [];

    (orders || []).forEach(function (ord) {
      if (!ord) return;
      if (exclude && String(ord.id || "").trim().toUpperCase() === exclude) return;
      if (normalizeMemberCardNo(ord.memberCardNo) !== c) return;
      usages.push({
        source: "order",
        orderId: ord.id || "",
        customerName: ord.customerName || "",
        phone: ord.phone || "",
      });
    });

    var ledgerSeen = {};
    (ledger || []).forEach(function (rec) {
      if (!rec) return;
      if (normalizeMemberCardNo(rec.memberCardNo) !== c) return;
      var key = normalizeCustomerName(rec.customerName) + "|" + normalizePhone(rec.phone);
      if (ledgerSeen[key]) return;
      ledgerSeen[key] = true;
      var covered = usages.some(function (u) {
        return isSameCustomerProfile(u.customerName, u.phone, rec.customerName, rec.phone);
      });
      if (!covered) {
        usages.push({
          source: "ledger",
          orderId: rec.orderId || "",
          customerName: rec.customerName || "",
          phone: rec.phone || "",
        });
      }
    });

    if (!usages.length) {
      return { ok: true, conflict: false, incomplete: false, sameCustomerReuse: false, message: "" };
    }

    var allSame = usages.every(function (u) {
      return isSameCustomerProfile(customerName, phone, u.customerName, u.phone);
    });
    if (allSame) {
      return {
        ok: true,
        conflict: false,
        incomplete: false,
        sameCustomerReuse: true,
        message: "此卡號為同客戶既有卡號，可沿用。",
        usages: usages,
      };
    }

    var other = usages.find(function (u) {
      return !isSameCustomerProfile(customerName, phone, u.customerName, u.phone);
    }) || usages[0];
    var ownerLabel = (other.customerName || "（未填姓名）") + (other.phone ? "（" + other.phone + "）" : "");
    var sourceLabel = other.source === "order" && other.orderId
      ? "訂單 " + other.orderId
      : other.source === "ledger"
        ? "紅利點數"
        : "";
    return {
      ok: false,
      conflict: true,
      incomplete: false,
      sameCustomerReuse: false,
      message:
        "此卡號與其他顧客重複！已被「" +
        ownerLabel +
        "」" +
        (sourceLabel ? "（" + sourceLabel + "）" : "") +
        "使用。請勿與他人共用卡號，可改按「自動產生」取得正確卡號。",
      usages: usages,
    };
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

  function lookupMembersByQuery(orders, query, ledger) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    if (ledger === undefined && global.MaaruLoyalty && MaaruLoyalty.getLedger) {
      ledger = MaaruLoyalty.getLedger();
    }
    ledger = ledger || [];
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
    var list = Object.keys(byKey)
      .map(function (k) {
        return byKey[k];
      });
    return mergeLookupRowsByCustomerName_(list, orders, ledger);
  }

  function mergeLookupRowsByCustomerName_(list, orders, ledger) {
    var byName = {};
    var noName = [];
    list.forEach(function (row) {
      var n = normalizeCustomerName(row.customerName);
      if (!n) {
        noName.push(row);
        return;
      }
      if (!byName[n]) {
        byName[n] = Object.assign({}, row);
        return;
      }
      byName[n].orderCount = (byName[n].orderCount || 0) + (row.orderCount || 0);
      if (String(row.lastOrderDate || "") >= String(byName[n].lastOrderDate || "")) {
        if (row.customerName) byName[n].customerName = row.customerName;
        if (row.phone) byName[n].phone = row.phone;
        if (row.lineId) byName[n].lineId = row.lineId;
        if (isValidMemberCardNo(row.memberCardNo)) byName[n].memberCardNo = row.memberCardNo;
        byName[n].lastOrderDate = row.lastOrderDate;
      }
    });
    Object.keys(byName).forEach(function (n) {
      if (global.MaaruLoyalty && MaaruLoyalty.pickCanonicalMemberCardForCustomer_) {
        var canonical = MaaruLoyalty.pickCanonicalMemberCardForCustomer_(n, orders, ledger);
        if (isValidMemberCardNo(canonical)) byName[n].memberCardNo = canonical;
      }
    });
    return Object.keys(byName)
      .map(function (n) {
        return byName[n];
      })
      .concat(noName)
      .sort(function (a, b) {
        var na = String(a.customerName || "").trim().replace(/\s+/g, "").toLowerCase();
        var nb = String(b.customerName || "").trim().replace(/\s+/g, "").toLowerCase();
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
      var check = validateMemberCardAssignment(
        card,
        orders,
        ledger,
        order.customerName,
        order.phone,
        editId
      );
      if (!check.ok && check.conflict) throw new Error(check.message);
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
    mergeUsedSets: mergeUsedSets,
    findMemberCardForCustomer: findMemberCardForCustomer,
    lookupMembersByQuery: lookupMembersByQuery,
    isSameCustomerProfile: isSameCustomerProfile,
    validateMemberCardAssignment: validateMemberCardAssignment,
    isMemberCardTaken: isMemberCardTaken,
    ensureOrderMemberCard: ensureOrderMemberCard,
  };
})(typeof window !== "undefined" ? window : this);

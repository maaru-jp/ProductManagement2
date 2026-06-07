/**
 * MAARU — 紅利功能已停用（保留 stub 供後台相容，不再集點／折抵）
 */
(function (global) {
  function normalizeCustomerName(name) {
    return String(name || "").trim().replace(/\s+/g, "");
  }

  function normalizeMemberCardNo(card) {
    return String(card || "").replace(/\D/g, "").slice(0, 13);
  }

  function isValidMemberCardNo(card) {
    return /^\d{13}$/.test(normalizeMemberCardNo(card));
  }

  function noopZero() {
    return 0;
  }

  function getLedger() {
    return [];
  }

  function saveLedger() {}

  function passthroughLedger(ledger) {
    return ledger || [];
  }

  function passthroughOrder(ord) {
    return { order: ord, message: "" };
  }

  global.MaaruLoyalty = {
    normalizeCustomerName: normalizeCustomerName,
    normalizeMemberCardNo: normalizeMemberCardNo,
    isValidMemberCardNo: isValidMemberCardNo,
    getLedger: getLedger,
    saveLedger: saveLedger,
    getBalance: noopZero,
    pointsDiscountAmount: noopZero,
    calcMaxRedeemPoints: noopZero,
    calcEarnPoints: noopZero,
    earnPointsBase: noopZero,
    getMinRedeemNet: noopZero,
    merchandiseNet: function (o) {
      o = o || {};
      return Math.max(0, (Number(o.subtotal) || 0) - (Number(o.discount) || 0));
    },
    processOrderPoints: passthroughOrder,
    processPendingOrders: function () {
      return { processed: 0, messages: [] };
    },
    removeLedgerEntriesForOrderId: function (ledger) {
      return { ledger: ledger || [], removed: 0 };
    },
    normalizeLedgerFromApi: passthroughLedger,
    mergeLedgers: function (a, b) {
      return (a || []).concat(b || []);
    },
    normalizeLedgerForDisplay: passthroughLedger,
    consolidateLedgerMemberCards: function (ledger) {
      return { ledger: ledger || [], changed: false };
    },
    backfillLedgerMemberCards: function (ledger) {
      return { ledger: ledger || [], changed: false };
    },
    runGlobalExpiry: function () {},
    summarizeCustomersWithOrders: function () {
      return [];
    },
    manualAdjust: passthroughLedger,
    getConfig: function () {
      return {};
    },
  };
})(typeof window !== "undefined" ? window : this);

/**
 * MAARU 會員名單 — 試算表「會員名單」主檔管理
 */
(function (global) {
  var membersCache = [];

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCardDisplay(card) {
    var c = global.MaaruMemberCard
      ? MaaruMemberCard.normalizeMemberCardNo(card)
      : String(card || "").replace(/\D/g, "").slice(0, 13);
    if (c.length !== 13) return c;
    return c.slice(0, 4) + " " + c.slice(4, 8) + " " + c.slice(8);
  }

  function isValidCard(card) {
    return global.MaaruMemberCard
      ? MaaruMemberCard.isValidMemberCardNo(card)
      : /^\d{13}$/.test(String(card || "").replace(/\D/g, "").slice(0, 13));
  }

  function normalizeCard(card) {
    return global.MaaruMemberCard
      ? MaaruMemberCard.normalizeMemberCardNo(card)
      : String(card || "").replace(/\D/g, "").slice(0, 13);
  }

  function showMessage(text, isError) {
    var el = document.getElementById("membersMessage");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
    el.classList.toggle("text-rose-600", !!isError);
    el.classList.toggle("text-emerald-700", !isError);
  }

  function memberMatchesQuery(m, q) {
    if (!q) return true;
    var ql = q.toLowerCase();
    var qd = q.replace(/\D/g, "");
    var blob = [
      m.memberCardNo,
      m.customerName,
      m.phone,
      m.lineId,
      m.email,
      m.note
    ].join(" ").toLowerCase();
    if (blob.indexOf(ql) >= 0) return true;
    if (qd.length >= 4 && String(m.memberCardNo || "").indexOf(qd) >= 0) return true;
    if (qd.length >= 4 && String(m.phone || "").replace(/\D/g, "").indexOf(qd) >= 0) return true;
    return false;
  }

  function renderMembersTable(members, query) {
    var tbody = document.getElementById("membersTableBody");
    if (!tbody) return;
    var list = (members || []).filter(function (m) {
      return memberMatchesQuery(m, query);
    });
    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="py-10 text-center text-slate-400">' +
        (query ? "找不到符合的會員" : "尚無會員，請按「從訂單匯入」或「新增會員」") +
        "</td></tr>";
      return;
    }
    tbody.innerHTML = list
      .map(function (m) {
        var card = normalizeCard(m.memberCardNo);
        var status = String(m.status || "有效").trim();
        var statusCls =
          status === "停用"
            ? "bg-slate-100 text-slate-600"
            : "bg-emerald-50 text-emerald-700";
        return (
          "<tr class=\"border-t border-slate-100 hover:bg-slate-50/80\">" +
          '<td class="py-2.5 px-3 font-mono text-xs tracking-wide">' +
          escapeHtml(formatCardDisplay(card)) +
          "</td>" +
          '<td class="py-2.5 px-3">' +
          escapeHtml(m.customerName || "—") +
          "</td>" +
          '<td class="py-2.5 px-3 text-xs text-slate-600">' +
          escapeHtml(m.phone || "—") +
          "</td>" +
          '<td class="py-2.5 px-3 text-xs text-slate-600">' +
          escapeHtml(m.lineId || "—") +
          "</td>" +
          '<td class="py-2.5 px-3">' +
          '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] ' +
          statusCls +
          '">' +
          escapeHtml(status) +
          "</span></td>" +
          '<td class="py-2.5 px-3 text-right whitespace-nowrap">' +
          '<button type="button" class="text-sky-600 hover:underline text-xs mr-2" data-copy-card="' +
          escapeHtml(card) +
          '">複製卡號</button>' +
          '<button type="button" class="text-amber-700 hover:underline text-xs mr-2" data-edit-member="' +
          escapeHtml(card) +
          '">編輯</button>' +
          '<button type="button" class="text-rose-600 hover:underline text-xs" data-del-member="' +
          escapeHtml(card) +
          '">刪除</button>' +
          "</td></tr>"
        );
      })
      .join("");

    tbody.querySelectorAll("[data-copy-card]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = btn.getAttribute("data-copy-card") || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(c).then(function () {
            showMessage("已複製卡號 " + formatCardDisplay(c), false);
          });
        } else {
          prompt("複製卡號", c);
        }
      });
    });
    tbody.querySelectorAll("[data-edit-member]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openMemberForm(btn.getAttribute("data-edit-member"));
      });
    });
    tbody.querySelectorAll("[data-del-member]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteMember(btn.getAttribute("data-del-member"));
      });
    });
  }

  function renderConflicts(conflicts) {
    var box = document.getElementById("membersConflictBox");
    if (!box) return;
    if (!conflicts || !conflicts.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML =
      '<p class="text-sm font-semibold text-amber-900 mb-2">⚠ 發現同名多卡（請人工確認保留哪一張）</p><ul class="text-xs text-amber-800 space-y-1 list-disc pl-4">' +
      conflicts
        .map(function (c) {
          return (
            "<li><strong>" +
            escapeHtml(c.customerName) +
            "</strong>：" +
            (c.memberCardNos || [])
              .map(function (card) {
                return escapeHtml(formatCardDisplay(card));
              })
              .join("、") +
            "</li>"
          );
        })
        .join("") +
      "</ul>";
  }

  var membersMeta = { url: "", name: "" };

  function updateMembersStatLine(count, extra) {
    var stat = document.getElementById("membersStatLine");
    if (!stat) return;
    var text = "共 " + (count || 0) + " 位會員";
    if (extra) text += extra;
    if (membersMeta.url) {
      stat.innerHTML =
        escapeHtml(text) +
        ' · 資料在 <a href="' +
        escapeHtml(membersMeta.url) +
        '#gid=0" target="_blank" rel="noopener" class="text-sky-600 underline">Memberist 試算表</a>（第 2 列起）';
    } else {
      stat.textContent = text;
    }
  }
  function fetchMembersFromApi() {
    if (typeof fetchWrite !== "function") {
      return Promise.reject(new Error("API 未就緒"));
    }
    return fetchWrite({ action: "member_list" })
      .then(function (r) {
        return r.text().then(function (t) {
          try {
            return t ? JSON.parse(t) : {};
          } catch (e) {
            return { error: true, message: "回應非 JSON" };
          }
        });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(res.message || "載入失敗");
        membersCache = res.members || [];
        if (res.memberSpreadsheetUrl) membersMeta.url = res.memberSpreadsheetUrl;
        if (res.memberSpreadsheetName) membersMeta.name = res.memberSpreadsheetName;
        return membersCache;
      });
  }

  function openMemberForm(editCard) {
    var modal = document.getElementById("memberFormModal");
    if (!modal) return;
    var cardEl = document.getElementById("memberFormCard");
    var nameEl = document.getElementById("memberFormName");
    var phoneEl = document.getElementById("memberFormPhone");
    var lineEl = document.getElementById("memberFormLineId");
    var emailEl = document.getElementById("memberFormEmail");
    var statusEl = document.getElementById("memberFormStatus");
    var noteEl = document.getElementById("memberFormNote");
    var titleEl = document.getElementById("memberFormTitle");
    var card = normalizeCard(editCard || "");
    var existing = membersCache.find(function (m) {
      return normalizeCard(m.memberCardNo) === card;
    });
    if (titleEl) titleEl.textContent = existing ? "編輯會員" : "新增會員";
    if (cardEl) {
      cardEl.value = card;
      cardEl.readOnly = !!existing;
    }
    if (nameEl) nameEl.value = (existing && existing.customerName) || "";
    if (phoneEl) phoneEl.value = (existing && existing.phone) || "";
    if (lineEl) lineEl.value = (existing && existing.lineId) || "";
    if (emailEl) emailEl.value = (existing && existing.email) || "";
    if (statusEl) statusEl.value = (existing && existing.status) || "有效";
    if (noteEl) noteEl.value = (existing && existing.note) || "";
    modal.classList.remove("hidden");
  }

  function closeMemberForm() {
    var modal = document.getElementById("memberFormModal");
    if (modal) modal.classList.add("hidden");
  }

  function saveMemberForm(ev) {
    if (ev) ev.preventDefault();
    var card = normalizeCard(document.getElementById("memberFormCard").value);
    if (!isValidCard(card)) {
      showMessage("請輸入 13 碼會員卡號", true);
      return;
    }
    var member = {
      memberCardNo: card,
      customerName: document.getElementById("memberFormName").value.trim(),
      phone: document.getElementById("memberFormPhone").value.trim(),
      lineId: document.getElementById("memberFormLineId").value.trim(),
      email: document.getElementById("memberFormEmail").value.trim(),
      status: document.getElementById("memberFormStatus").value || "有效",
      note: document.getElementById("memberFormNote").value.trim()
    };
    fetchWrite({ action: "member_upsert", member: member })
      .then(function (r) {
        return r.text().then(function (t) {
          try {
            return t ? JSON.parse(t) : {};
          } catch (e) {
            return { error: true, message: "回應非 JSON" };
          }
        });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(res.message || "儲存失敗");
        closeMemberForm();
        showMessage(res.message || "已儲存", false);
        return loadMembersPanel(true);
      })
      .catch(function (err) {
        showMessage(err.message || "儲存失敗", true);
      });
  }

  function deleteMember(card) {
    card = normalizeCard(card);
    if (!isValidCard(card)) return;
    if (!confirm("確定刪除會員卡號 " + formatCardDisplay(card) + "？\n（不會刪除訂單或紅利紀錄）")) return;
    fetchWrite({ action: "member_delete", memberCardNo: card })
      .then(function (r) {
        return r.text().then(function (t) {
          try {
            return t ? JSON.parse(t) : {};
          } catch (e) {
            return { error: true };
          }
        });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(res.message || "刪除失敗");
        showMessage(res.message || "已刪除", false);
        return loadMembersPanel(true);
      })
      .catch(function (err) {
        showMessage(err.message || "刪除失敗", true);
      });
  }

  function syncMembersFromOrders() {
    var btn = document.getElementById("btnMemberSyncOrders");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "匯入中（約 1～2 分鐘）…";
    }
    showMessage("正在從歷史訂單匯入會員至 Memberist，請稍候勿關閉頁面…", false);
    fetchWrite({ action: "member_sync_from_orders" }, { timeoutMs: 180000 })
      .then(function (r) {
        return r.text().then(function (t) {
          try {
            return t ? JSON.parse(t) : {};
          } catch (e) {
            return { error: true, message: "回應非 JSON（可能逾時或未部署最新 Code.gs）" };
          }
        });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(res.message || "匯入失敗");
        membersCache = res.members || [];
        renderConflicts(res.conflicts || []);
        var q = document.getElementById("membersSearchInput");
        renderMembersTable(membersCache, q ? q.value.trim() : "");
        if (res.memberSpreadsheetUrl) membersMeta.url = res.memberSpreadsheetUrl;
        updateMembersStatLine(
          membersCache.length,
          "（新增 " + (res.added || 0) + "、更新 " + (res.updated || 0) + "）"
        );
        var msg = res.message || "匯入完成";
        if ((res.added || 0) + (res.updated || 0) === 0 && (res.eligible || 0) > 0) {
          msg += "。請將 Memberist 試算表共用「編輯者」給部署 GAS 的 Google 帳號後再試";
        }
        if (res.failed && res.failed.length) {
          msg += "；衝突 " + res.failed.length + " 筆";
        }
        showMessage(msg, (res.added || 0) + (res.updated || 0) === 0 && (res.eligible || 0) > 0);
      })
      .catch(function (err) {
        var msg = err && err.message ? String(err.message) : "匯入失敗";
        if (/abort|timeout|逾時/i.test(msg)) {
          msg = "匯入逾時（資料較多需 1～2 分鐘）。請重新部署 Code.gs 後再按一次「從訂單匯入」";
        }
        showMessage(msg, true);
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "從訂單匯入";
        }
      });
  }

  function generateMemberCard() {
    if (!global.MaaruMemberCard) {
      showMessage("會員卡模組未載入", true);
      return;
    }
    var orderList = [];
    try {
      if (typeof loadAdminOrdersForLoyalty_ === "function") {
        orderList = loadAdminOrdersForLoyalty_();
      } else if (global.adminOrders && Array.isArray(global.adminOrders)) {
        orderList = global.adminOrders;
      }
    } catch (e) { /* ignore */ }
    var used = MaaruMemberCard.mergeUsedSets(
      MaaruMemberCard.collectUsedMemberCardsFromOrders(orderList),
      MaaruMemberCard.collectUsedMemberCardsFromLedger(
        global.MaaruLoyalty ? MaaruLoyalty.getLedger() : []
      )
    );
    membersCache.forEach(function (m) {
      var c = normalizeCard(m.memberCardNo);
      if (isValidCard(c)) used[c] = true;
    });
    try {
      var card = MaaruMemberCard.generateUniqueMemberCardNo(used);
      var cardEl = document.getElementById("memberFormCard");
      if (cardEl) {
        cardEl.value = card;
        cardEl.readOnly = false;
      }
    } catch (err) {
      showMessage(err.message || "無法產生卡號", true);
    }
  }

  function loadMembersPanel(silent) {
    if (!silent) showMessage("載入會員名單…", false);
    return fetchMembersFromApi()
      .then(function (list) {
        var q = document.getElementById("membersSearchInput");
        renderMembersTable(list, q ? q.value.trim() : "");
        updateMembersStatLine(list.length, "");
        if (!silent) showMessage("已載入 " + list.length + " 位會員", false);
      })
      .catch(function (err) {
        var msg = err.message || "載入失敗";
        if (/member_list|postRoutes/i.test(msg)) {
          msg = "API 尚未部署會員名單功能，請貼最新 Code.gs 並重新部署";
        }
        showMessage(msg, true);
        renderMembersTable([], "");
      });
  }

  function bindMembersPanel() {
    var search = document.getElementById("membersSearchInput");
    if (search) {
      search.addEventListener("input", function () {
        renderMembersTable(membersCache, search.value.trim());
      });
    }
    var btnAdd = document.getElementById("btnMemberAdd");
    if (btnAdd) btnAdd.addEventListener("click", function () {
      openMemberForm("");
    });
    var btnSync = document.getElementById("btnMemberSyncOrders");
    if (btnSync) btnSync.addEventListener("click", syncMembersFromOrders);
    var btnReload = document.getElementById("btnMemberReload");
    if (btnReload) btnReload.addEventListener("click", function () {
      loadMembersPanel(false);
    });
    var form = document.getElementById("memberForm");
    if (form) form.addEventListener("submit", saveMemberForm);
    var btnClose = document.getElementById("btnMemberFormClose");
    if (btnClose) btnClose.addEventListener("click", closeMemberForm);
    var btnGen = document.getElementById("btnMemberGenCard");
    if (btnGen) btnGen.addEventListener("click", generateMemberCard);
    var modal = document.getElementById("memberFormModal");
    if (modal) {
      modal.addEventListener("click", function (ev) {
        if (ev.target === modal) closeMemberForm();
      });
    }
  }

  global.MaaruMembers = {
    loadPanel: loadMembersPanel,
    getCache: function () {
      return membersCache.slice();
    },
    lookupCard: function (customerName, phone, lineId) {
      var n = String(customerName || "").trim().replace(/\s+/g, "").toLowerCase();
      var p = String(phone || "").replace(/\D/g, "");
      for (var i = 0; i < membersCache.length; i++) {
        var m = membersCache[i];
        if (String(m.status || "") === "停用") continue;
        var mn = String(m.customerName || "").trim().replace(/\s+/g, "").toLowerCase();
        if (n && mn === n) return normalizeCard(m.memberCardNo);
        var mp = String(m.phone || "").replace(/\D/g, "");
        if (!n && p && mp === p) return normalizeCard(m.memberCardNo);
      }
      return "";
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindMembersPanel);
  } else {
    bindMembersPanel();
  }
})(typeof window !== "undefined" ? window : this);

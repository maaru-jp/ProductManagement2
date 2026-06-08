/**
 * 後台出貨管理：7-ELEVEN 賣貨便快速結帳 Console 建單腳本
 * https://myship.7-11.com.tw/easy/add
 */
(function (global) {
  "use strict";

  var MYSHIP_EASY_ADD_URL = "https://myship.7-11.com.tw/easy/add";

  function escapeJsString_(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  function isMyshipShippingMethod_(value) {
    var v = String(value || "").trim();
    return /賣貨便|7-11|7 eleven|myship/i.test(v);
  }

  function getItemShipStatus_(it) {
    var st = it && it.shipStatus != null ? String(it.shipStatus).trim() : "";
    return st || "待出貨";
  }

  function normalizeOrderItemsForShip_(items) {
    if (!items || !Array.isArray(items)) return [];
    return items.map(function (it) {
      var qty = (it.qty != null && it.qty !== "" && !isNaN(Number(it.qty))) ? Math.max(0, parseInt(it.qty, 10)) : 0;
      var price = (it.price == null || it.price === "" || isNaN(Number(it.price))) ? null : Number(it.price);
      if (price != null && !isFinite(price)) price = null;
      return {
        lineName: (it.lineName != null ? String(it.lineName) : "").trim(),
        qty: qty,
        price: price,
        shipStatus: getItemShipStatus_(it)
      };
    }).filter(function (it) { return it.lineName && it.qty > 0 && it.price != null && it.price >= 0; });
  }

  function getPendingShipItems_(ord) {
    return normalizeOrderItemsForShip_(ord && ord.items).filter(function (it) {
      return getItemShipStatus_(it) === "待出貨";
    });
  }

  function getEffectiveShippingFee_(ord) {
    if (!ord) return 38;
    if (ord.shippingStatus && String(ord.shippingStatus).trim() !== "") return 0;
    var fee = ord.shippingFee != null && ord.shippingFee !== "" ? Number(ord.shippingFee) : 38;
    return isFinite(fee) && fee >= 0 ? Math.floor(fee) : 38;
  }

  function buildMyshipScriptItems_(ord, options) {
    options = options || {};
    var pending = getPendingShipItems_(ord);
    var prefix = options.namePrefix != null ? String(options.namePrefix) : ("[" + (ord.id || "訂單") + "] ");
    var includeShipping = !!options.includeShippingItem;
    var shipFee = getEffectiveShippingFee_(ord);
    var rows = pending.map(function (it) {
      return {
        name: prefix + it.lineName,
        price: Math.round(it.price),
        qty: it.qty
      };
    });
    if (includeShipping && shipFee > 0) {
      rows.push({
        name: prefix + "運費",
        price: shipFee,
        qty: 1
      });
    }
    return rows;
  }

  function buildMyshipConsoleScript_(ord, options) {
    options = options || {};
    var mode = options.mode === "single" ? "single" : "perItem";
    var items = buildMyshipScriptItems_(ord, options);
    if (!items.length) return "";

    var customer = (ord.customerName || ord.name || "").trim();
    var shipFee = getEffectiveShippingFee_(ord);
    var storeName = options.storeName || ((ord.id || "") + (customer ? " " + customer : ""));
    var lines = [];
    var i;

    lines.push("// MAARU 賣貨便批次建單 — " + (ord.id || "") + (customer ? " " + customer : ""));
    lines.push("// 待出貨品項 " + items.length + " 筆 · 建議運費 NT$" + shipFee + (ord.shippingStatus ? "（本單已折抵）" : ""));
    lines.push("//");
    lines.push("// 使用方式：");
    lines.push("// 1. 登入 7-ELEVEN 賣貨便");
    lines.push("// 2. 進入「快速結帳賣場」新增頁並等待載入完成");
    lines.push("//    " + MYSHIP_EASY_ADD_URL);
    lines.push("// 3. 按 F12 → Console，貼上本腳本後 Enter");
    lines.push("");
    lines.push("const sleep = (ms) => new Promise((r) => setTimeout(r, ms));");
    lines.push("");
    lines.push("function setInput(el, val) {");
    lines.push("  if (!el) return false;");
    lines.push("  el.focus();");
    lines.push("  el.value = String(val);");
    lines.push("  el.dispatchEvent(new Event('input', { bubbles: true }));");
    lines.push("  el.dispatchEvent(new Event('change', { bubbles: true }));");
    lines.push("  return true;");
    lines.push("}");
    lines.push("");
    lines.push("function findInputByLabel(text) {");
    lines.push("  const nodes = Array.from(document.querySelectorAll('label, span, div, th, p'));");
    lines.push("  for (const node of nodes) {");
    lines.push("    const t = (node.textContent || '').replace(/\\s+/g, '');");
    lines.push("    if (!t || t.indexOf(text) < 0) continue;");
    lines.push("    const box = node.closest('tr, li, .form-group, .row, [class*=\"item\"], [class*=\"product\"]') || node.parentElement;");
    lines.push("    if (!box) continue;");
    lines.push("    const inp = box.querySelector('input:not([type=\"hidden\"]):not([type=\"checkbox\"]):not([type=\"radio\"])');");
    lines.push("    if (inp) return inp;");
    lines.push("  }");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
    lines.push("function getProductRows() {");
    lines.push("  const byClass = Array.from(document.querySelectorAll('[class*=\"product\"], [class*=\"item\"], tr'));");
    lines.push("  const rows = byClass.filter((row) => row.querySelector('input') && /商品|品名|名稱/.test(row.textContent || ''));");
    lines.push("  if (rows.length) return rows;");
    lines.push("  return [document];");
    lines.push("}");
    lines.push("");
    lines.push("function fillProductInRow(row, item) {");
    lines.push("  const scope = row || document;");
    lines.push("  const nameEl = scope.querySelector('input[name*=\"Name\" i], input[placeholder*=\"商品\"], input[placeholder*=\"名稱\"]')");
    lines.push("    || findInputByLabel('商品名稱') || findInputByLabel('品名');");
    lines.push("  const priceEl = scope.querySelector('input[name*=\"Price\" i], input[name*=\"price\"], input[placeholder*=\"價\"], input[placeholder*=\"金額\"]')");
    lines.push("    || findInputByLabel('售價') || findInputByLabel('價格') || findInputByLabel('金額');");
    lines.push("  const qtyEl = scope.querySelector('input[name*=\"Qty\" i], input[name*=\"qty\"], input[name*=\"Count\" i], input[placeholder*=\"數量\"]')");
    lines.push("    || findInputByLabel('數量');");
    lines.push("  const okName = setInput(nameEl, item.name);");
    lines.push("  const okPrice = setInput(priceEl, item.price);");
    lines.push("  const okQty = setInput(qtyEl, item.qty);");
    lines.push("  if (!okName || !okPrice || !okQty) {");
    lines.push("    console.warn('部分欄位未找到，請確認目前在「快速結帳」商品上架區：', item);");
    lines.push("  }");
    lines.push("  return okName && okPrice && okQty;");
    lines.push("}");
    lines.push("");
    lines.push("function clickAddProduct() {");
    lines.push("  const btn = Array.from(document.querySelectorAll('button, a, span, div'))");
    lines.push("    .find((el) => /繼續新增商品|新增商品|再加一筆/.test((el.textContent || '').trim()));");
    lines.push("  if (btn) { btn.click(); return true; }");
    lines.push("  return false;");
    lines.push("}");
    lines.push("");
    lines.push("function clickSubmit() {");
    lines.push("  const btn = Array.from(document.querySelectorAll('button, a, input[type=\"button\"], input[type=\"submit\"]'))");
    lines.push("    .find((el) => /上架完成|確認上架|建立賣場|^上架$|完成/.test((el.textContent || el.value || '').trim()));");
    lines.push("  if (btn) { btn.click(); return true; }");
    lines.push("  console.warn('找不到上架按鈕，請手動點「上架」');");
    lines.push("  return false;");
    lines.push("}");
    lines.push("");
    lines.push("async function fillForm(item) {");
    lines.push("  const rows = getProductRows();");
    lines.push("  const row = rows[rows.length - 1] || document;");
    lines.push("  fillProductInRow(row, item);");
    lines.push("  const storeName = \"" + escapeJsString_(storeName) + "\";");
    lines.push("  const storeInput = findInputByLabel('賣場名稱') || document.querySelector('input[name*=\"Store\" i], input[placeholder*=\"賣場\"]');");
    lines.push("  if (storeInput && storeName) setInput(storeInput, storeName);");
    lines.push("  await sleep(300);");
    lines.push("}");
    lines.push("");
    lines.push("async function submit() {");
    lines.push("  clickSubmit();");
    lines.push("  await sleep(2500);");
    lines.push("}");
    lines.push("");
    lines.push("const items = [");
    for (i = 0; i < items.length; i++) {
      var row = items[i];
      lines.push("  { name: \"" + escapeJsString_(row.name) + "\", price: " + row.price + ", qty: " + row.qty + " }" + (i < items.length - 1 ? "," : ""));
    }
    lines.push("];");
    lines.push("");
    lines.push("(async () => {");
    if (mode === "single") {
      lines.push("  console.log('開始建立單一賣場（合併 " + items.length + " 品項）…');");
      lines.push("  for (let i = 0; i < items.length; i++) {");
      lines.push("    if (i > 0) { clickAddProduct(); await sleep(600); }");
      lines.push("    await fillForm(items[i]);");
      lines.push("  }");
      lines.push("  await submit();");
      lines.push("  console.log('✓ 已提交 1 個賣場（含 ' + items.length + ' 品項）');");
    } else {
      lines.push("  console.log('開始批次建立賣場（每品項一賣場）…');");
      lines.push("  for (const item of items) {");
      lines.push("    await fillForm(item);");
      lines.push("    await submit();");
      lines.push("    await sleep(1500);");
      lines.push("  }");
      lines.push("  console.log('✓ 已建立 ' + items.length + ' 個賣場');");
    }
    lines.push("})();");
    return lines.join("\n");
  }

  function openMyshipEasyAdd_() {
    global.open(MYSHIP_EASY_ADD_URL, "_blank", "noopener,noreferrer");
  }

  function copyText_(text) {
    if (!text) return Promise.reject(new Error("empty"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function initShippingSection(options) {
    options = options || {};
    var getOrders = typeof options.getOrders === "function"
      ? options.getOrders
      : function () {
          try {
            var saved = localStorage.getItem("adminOrders");
            var list = saved ? JSON.parse(saved) : [];
            return Array.isArray(list) ? list : [];
          } catch (e) {
            return [];
          }
        };
    var notify = typeof options.notify === "function" ? options.notify : function () {};
    var escapeHtml = typeof options.escapeHtml === "function"
      ? options.escapeHtml
      : function (s) {
          var d = document.createElement("div");
          d.textContent = s == null ? "" : String(s);
          return d.innerHTML;
        };
    var orderAmountDue = typeof options.orderAmountDue === "function" ? options.orderAmountDue : function () { return 0; };

    var tableBody = document.getElementById("shippingTableBody");
    var searchInput = document.getElementById("shippingSearchInput");
    var onlyPendingCheck = document.getElementById("shippingOnlyPending");
    var onlyMyshipCheck = document.getElementById("shippingOnlyMyship");
    var btnRefresh = document.getElementById("btnShippingRefresh");
    var btnOpenMyship = document.getElementById("btnOpenMyshipEasyAdd");
    var scriptModal = document.getElementById("myshipScriptModal");
    var scriptModalBackdrop = document.getElementById("myshipScriptModalBackdrop");
    var scriptModalClose = document.getElementById("myshipScriptModalClose");
    var scriptModalCancel = document.getElementById("myshipScriptModalCancel");
    var scriptCodeEl = document.getElementById("myshipScriptCode");
    var scriptMetaEl = document.getElementById("myshipScriptMeta");
    var scriptModeEl = document.getElementById("myshipScriptMode");
    var scriptIncludeShipEl = document.getElementById("myshipScriptIncludeShipping");
    var btnCopyScript = document.getElementById("btnCopyMyshipScript");
    var btnRegenScript = document.getElementById("btnRegenMyshipScript");

    var currentScriptOrderId = null;

    function getFilteredOrders_() {
      var list = getOrders().filter(function (ord) {
        if (!ord || ord.status === "已取消") return false;
        var pending = getPendingShipItems_(ord);
        if (onlyPendingCheck && onlyPendingCheck.checked && !pending.length) return false;
        if (onlyMyshipCheck && onlyMyshipCheck.checked && !isMyshipShippingMethod_(ord.shippingMethod)) return false;
        var q = searchInput ? String(searchInput.value || "").trim().toLowerCase() : "";
        if (q) {
          var text = (ord.id || "") + (ord.customerName || ord.name || "") + (ord.phone || "");
          if (text.toLowerCase().indexOf(q) < 0) return false;
        }
        return true;
      });
      list.sort(function (a, b) {
        var ma = String((a && a.id) || "").match(/^ORD(\d+)$/i);
        var mb = String((b && b.id) || "").match(/^ORD(\d+)$/i);
        var na = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER;
        var nb = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER;
        return na - nb;
      });
      return list;
    }

    function renderShippingTable_() {
      if (!tableBody) return;
      var list = getFilteredOrders_();
      if (!list.length) {
        tableBody.innerHTML = "<tr><td colspan=\"7\" class=\"py-12 text-center text-slate-500\">沒有符合條件的訂單。請確認品項已設為「待出貨」並儲存訂單。</td></tr>";
        return;
      }
      tableBody.innerHTML = list.map(function (ord) {
        var pending = getPendingShipItems_(ord);
        var pendingNames = pending.map(function (it) { return it.lineName; }).join("、");
        var preview = pendingNames.length > 42 ? pendingNames.slice(0, 42) + "…" : pendingNames;
        var customer = (ord.customerName || ord.name || "—").trim() || "—";
        return "<tr class=\"border-b border-slate-100 hover:bg-slate-50\" data-order-id=\"" + escapeHtml(ord.id) + "\">" +
          "<td class=\"py-3 px-4 font-mono font-medium text-slate-800\">" + escapeHtml(ord.id) + "</td>" +
          "<td class=\"py-3 px-4 text-slate-700\">" + escapeHtml(customer) + "</td>" +
          "<td class=\"py-3 px-4\"><span class=\"inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700\">" + escapeHtml(ord.status || "—") + "</span></td>" +
          "<td class=\"py-3 px-4 text-slate-600\">" + escapeHtml(ord.shippingMethod || "—") + "</td>" +
          "<td class=\"py-3 px-4 text-slate-700\" title=\"" + escapeHtml(pendingNames) + "\">" + pending.length + " 項" + (preview ? (" · " + escapeHtml(preview)) : "") + "</td>" +
          "<td class=\"py-3 px-4 font-medium text-slate-800\">NT$ " + escapeHtml(String(orderAmountDue(ord))) + "</td>" +
          "<td class=\"py-3 px-4 whitespace-nowrap\">" +
            "<button type=\"button\" class=\"shipping-script-btn px-2.5 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700 mr-1\" data-order-id=\"" + escapeHtml(ord.id) + "\"" + (pending.length ? "" : " disabled title=\"沒有待出貨品項\"") + ">產生腳本</button>" +
            "<button type=\"button\" class=\"shipping-open-order-btn px-2 py-1 rounded border border-slate-300 text-slate-700 text-xs hover:bg-slate-50\" data-order-id=\"" + escapeHtml(ord.id) + "\">訂單</button>" +
          "</td>" +
        "</tr>";
      }).join("");

      tableBody.querySelectorAll(".shipping-script-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-order-id");
          if (id) openScriptModal_(id);
        });
      });
      tableBody.querySelectorAll(".shipping-open-order-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-order-id");
          if (!id) return;
          if (typeof options.openOrder === "function") options.openOrder(id);
          else if (typeof global.showSection === "function") global.showSection("sectionOrders");
        });
      });
    }

    function getScriptOptions_() {
      return {
        mode: scriptModeEl && scriptModeEl.value === "single" ? "single" : "perItem",
        includeShippingItem: !!(scriptIncludeShipEl && scriptIncludeShipEl.checked)
      };
    }

    function updateScriptPreview_(ord) {
      if (!ord || !scriptCodeEl) return;
      var script = buildMyshipConsoleScript_(ord, getScriptOptions_());
      scriptCodeEl.textContent = script || "// 此訂單沒有「待出貨」品項";
      if (scriptMetaEl) {
        var pending = getPendingShipItems_(ord);
        scriptMetaEl.textContent = (ord.id || "") + " · " + (ord.customerName || ord.name || "") + " · 待出貨 " + pending.length + " 項 · 建議運費 NT$" + getEffectiveShippingFee_(ord);
      }
    }

    function openScriptModal_(orderId) {
      var ord = getOrders().find(function (o) { return String(o.id || "").trim() === String(orderId || "").trim(); });
      if (!ord) {
        notify("找不到訂單 " + orderId, true);
        return;
      }
      if (!getPendingShipItems_(ord).length) {
        notify("此訂單沒有「待出貨」品項", true);
        return;
      }
      currentScriptOrderId = orderId;
      updateScriptPreview_(ord);
      if (scriptModal) scriptModal.classList.remove("hidden");
    }

    function closeScriptModal_() {
      currentScriptOrderId = null;
      if (scriptModal) scriptModal.classList.add("hidden");
    }

    if (btnRefresh) btnRefresh.addEventListener("click", renderShippingTable_);
    if (searchInput) searchInput.addEventListener("input", renderShippingTable_);
    if (onlyPendingCheck) onlyPendingCheck.addEventListener("change", renderShippingTable_);
    if (onlyMyshipCheck) onlyMyshipCheck.addEventListener("change", renderShippingTable_);
    if (btnOpenMyship) btnOpenMyship.addEventListener("click", openMyshipEasyAdd_);
    if (scriptModalClose) scriptModalClose.addEventListener("click", closeScriptModal_);
    if (scriptModalCancel) scriptModalCancel.addEventListener("click", closeScriptModal_);
    if (scriptModalBackdrop) scriptModalBackdrop.addEventListener("click", closeScriptModal_);
    if (scriptModeEl) scriptModeEl.addEventListener("change", function () {
      if (!currentScriptOrderId) return;
      var ord = getOrders().find(function (o) { return String(o.id) === String(currentScriptOrderId); });
      updateScriptPreview_(ord);
    });
    if (scriptIncludeShipEl) scriptIncludeShipEl.addEventListener("change", function () {
      if (!currentScriptOrderId) return;
      var ord = getOrders().find(function (o) { return String(o.id) === String(currentScriptOrderId); });
      updateScriptPreview_(ord);
    });
    if (btnRegenScript) btnRegenScript.addEventListener("click", function () {
      if (!currentScriptOrderId) return;
      var ord = getOrders().find(function (o) { return String(o.id) === String(currentScriptOrderId); });
      updateScriptPreview_(ord);
      notify("已更新腳本預覽");
    });
    if (btnCopyScript) {
      btnCopyScript.addEventListener("click", function () {
        var text = scriptCodeEl ? scriptCodeEl.textContent : "";
        copyText_(text).then(function () {
          notify("腳本已複製，請到賣貨便快速結帳頁的 Console 貼上執行");
        }).catch(function () {
          notify("複製失敗，請手動選取腳本內容複製", true);
        });
      });
    }

    return {
      render: renderShippingTable_,
      openScriptModal: openScriptModal_,
      buildScript: buildMyshipConsoleScript_,
      openMyship: openMyshipEasyAdd_
    };
  }

  global.MaaruMyship = {
    MYSHIP_EASY_ADD_URL: MYSHIP_EASY_ADD_URL,
    isMyshipShippingMethod_: isMyshipShippingMethod_,
    getPendingShipItems_: getPendingShipItems_,
    buildMyshipConsoleScript_: buildMyshipConsoleScript_,
    openMyshipEasyAdd_: openMyshipEasyAdd_,
    initShippingSection: initShippingSection
  };
})(window);

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

  var MYSHIP_RUNTIME_HELPERS = [
    "const MYSHIP_ADD_URL = \"" + MYSHIP_EASY_ADD_URL + "\";",
    "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
    "const norm = (s) => String(s || \"\").replace(/\\s+/g, \"\");",
    "",
    "function setNativeInput(el, val) {",
    "  if (!el) return false;",
    "  const str = String(val);",
    "  try {",
    "    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;",
    "    const setter = Object.getOwnPropertyDescriptor(proto, \"value\").set;",
    "    setter.call(el, str);",
    "  } catch (e) { el.value = str; }",
    "  el.dispatchEvent(new Event(\"input\", { bubbles: true }));",
    "  el.dispatchEvent(new Event(\"change\", { bubbles: true }));",
    "  el.dispatchEvent(new Event(\"blur\", { bubbles: true }));",
    "  return true;",
    "}",
    "",
    "function isVisible(el) {",
    "  if (!el || el.disabled || el.readOnly) return false;",
    "  const st = window.getComputedStyle(el);",
    "  if (st.display === \"none\" || st.visibility === \"hidden\") return false;",
    "  return el.offsetParent !== null || st.position === \"fixed\";",
    "}",
    "",
    "function getEditableFields(root) {",
    "  const scope = root || document;",
    "  return Array.from(scope.querySelectorAll(\"input, textarea\")).filter((el) => {",
    "    const type = (el.getAttribute(\"type\") || \"\").toLowerCase();",
    "    return isVisible(el) && type !== \"hidden\" && type !== \"checkbox\" && type !== \"radio\" && type !== \"file\";",
    "  });",
    "}",
    "",
    "function fieldBag(el) {",
    "  const parts = [el.name, el.id, el.placeholder, el.getAttribute(\"aria-label\"), el.getAttribute(\"title\")];",
    "  const label = el.id ? document.querySelector('label[for=\"' + el.id.replace(/\"/g, \"\") + '\"]') : null;",
    "  if (label) parts.push(label.textContent);",
    "  let p = el.parentElement;",
    "  for (let i = 0; i < 4 && p; i++) { parts.push(p.textContent); p = p.parentElement; }",
    "  return norm(parts.join(\" \"));",
    "}",
    "",
    "function findFieldIn(scope, keywordsList) {",
    "  const fields = getEditableFields(scope);",
    "  for (const keys of keywordsList) {",
    "    const hit = fields.find((el) => keys.every((k) => fieldBag(el).includes(norm(k))));",
    "    if (hit) return hit;",
    "  }",
    "  return null;",
    "}",
    "",
    "function findClickable(patterns) {",
    "  const nodes = Array.from(document.querySelectorAll(\"button, a, input[type=button], input[type=submit], span, div\"));",
    "  for (const re of patterns) {",
    "    const hit = nodes.find((el) => {",
    "      const t = norm(el.textContent || el.value || \"\");",
    "      return re.test(t) && isVisible(el);",
    "    });",
    "    if (hit) return hit;",
    "  }",
    "  return null;",
    "}",
    "",
    "function findProductBlocks() {",
    "  const nodes = Array.from(document.querySelectorAll(\"tr, .card, .row, fieldset, form, section, div\"));",
    "  const blocks = nodes.filter((el) => {",
    "    const t = norm(el.textContent);",
    "    return (t.includes(\"商品名稱\") || t.includes(\"品名\") || t.includes(\"商品描述\")) && getEditableFields(el).length >= 2;",
    "  });",
    "  if (blocks.length) return blocks;",
    "  return [document.body];",
    "}",
    "",
    "async function waitFor(fn, timeout, label) {",
    "  const start = Date.now();",
    "  while (Date.now() - start < timeout) {",
    "    try { const v = fn(); if (v) return v; } catch (e) {}",
    "    await sleep(250);",
    "  }",
    "  throw new Error(\"等待逾時：\" + (label || \"欄位\"));",
    "}",
    "",
    "function assertMyshipPage() {",
    "  const path = (location.pathname || \"\").toLowerCase();",
    "  const body = norm(document.body ? document.body.innerText : \"\");",
    "  if (body.includes(\"請先登入\") || body.includes(\"uniopen會員\") && !body.includes(\"商品\")) {",
    "    throw new Error(\"請先登入賣貨便，並開啟「快速結帳賣場」新增頁：\" + MYSHIP_ADD_URL);",
    "  }",
    "  if (!path.includes(\"/easy/\") && !body.includes(\"商品上架\") && !body.includes(\"快速結帳\")) {",
    "    console.warn(\"[MAARU] 目前網址可能不是快速結帳新增頁，仍嘗試填表…\", location.href);",
    "  }",
    "}",
    "",
    "async function ensureProductTab() {",
    "  const tab = findClickable([/商品上架/, /商品設定/]);",
    "  if (tab) { tab.click(); await sleep(500); }",
    "}",
    "",
    "async function fillStoreName(name) {",
    "  if (!name) return;",
    "  const storeEl = await waitFor(() => findFieldIn(document, [[\"賣場名稱\"], [\"賣場\", \"名稱\"]]), 8000, \"賣場名稱\");",
    "  setNativeInput(storeEl, name);",
    "}",
    "",
    "function fillProductInBlock(block, item) {",
    "  const nameEl = findFieldIn(block, [[\"商品名稱\"], [\"品名\"], [\"商品\", \"名稱\"]]);",
    "  const descEl = findFieldIn(block, [[\"商品描述\"], [\"描述\"], [\"介紹\"]]);",
    "  const priceEl = findFieldIn(block, [[\"售價\"], [\"價格\"], [\"金額\"], [\"單價\"]]);",
    "  const qtyEl = findFieldIn(block, [[\"數量\"], [\"庫存\"]]);",
    "  const okName = setNativeInput(nameEl, item.name);",
    "  const okDesc = descEl ? setNativeInput(descEl, item.desc || item.name) : true;",
    "  const okPrice = setNativeInput(priceEl, item.price);",
    "  const okQty = setNativeInput(qtyEl, item.qty);",
    "  console.log(\"[MAARU] 填寫\", item.name, { okName, okDesc, okPrice, okQty });",
    "  if (!okName || !okPrice || !okQty) throw new Error(\"找不到商品欄位，請切到「商品上架」分頁後再執行。品項：\" + item.name);",
    "  return true;",
    "}",
    "",
    "async function clickAddProduct() {",
    "  const btn = findClickable([/繼續新增商品/, /新增商品/, /再加一筆/]);",
    "  if (!btn) return false;",
    "  btn.click();",
    "  await sleep(700);",
    "  return true;",
    "}",
    "",
    "async function clickSubmit() {",
    "  const btn = findClickable([/上架完成/, /確認上架/, /^上架$/]);",
    "  if (!btn) throw new Error(\"找不到「上架／上架完成」按鈕\");",
    "  btn.click();",
    "  await sleep(1200);",
    "  const okBtn = findClickable([/^確定$/, /^確認$/, /^是$/, /確定上架/]);",
    "  if (okBtn) { okBtn.click(); await sleep(800); }",
    "}",
    "",
    "async function prepareNextStore() {",
    "  await sleep(2000);",
    "  if ((location.pathname || \"\").toLowerCase().indexOf(\"/easy/add\") < 0) {",
    "    location.assign(MYSHIP_ADD_URL);",
    "    await waitFor(() => norm(document.body.innerText).includes(\"商品\") || getEditableFields().length > 3, 20000, \"下一個賣場頁面\");",
    "  }",
    "  await ensureProductTab();",
    "}",
    "",
    "async function fillForm(item, blockIndex) {",
    "  await ensureProductTab();",
    "  const blocks = findProductBlocks();",
    "  const idx = blockIndex != null ? blockIndex : (blocks.length - 1);",
    "  fillProductInBlock(blocks[idx] || document.body, item);",
    "  await sleep(300);",
    "}",
    "",
    "async function submit() {",
    "  await clickSubmit();",
    "  await sleep(2500);",
    "}",
    "",
    "window.__maaruMyshipProbe = function () {",
    "  console.log(\"[MAARU] 頁面\", location.href);",
    "  getEditableFields().forEach((el, i) => console.log(i, fieldBag(el), el));",
    "  console.log(\"[MAARU] 商品區塊數\", findProductBlocks().length);",
    "};"
  ].join("\n");

  function buildMyshipProbeScript_() {
    return [
      "// MAARU 賣貨便欄位偵測（請在快速結帳新增頁 Console 執行）",
      MYSHIP_RUNTIME_HELPERS,
      "__maaruMyshipProbe();"
    ].join("\n");
  }

  function buildMyshipConsoleScript_(ord, options) {
    options = options || {};
    var mode = options.mode === "perItem" ? "perItem" : "single";
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
    lines.push("// ⚠ 執行前請確認：");
    lines.push("// 1. 已登入賣貨便");
    lines.push("// 2. 網址為快速結帳「新增賣場」頁 → " + MYSHIP_EASY_ADD_URL);
    lines.push("// 3. 建議先切到「商品上架」分頁，或讓腳本自動點擊");
    lines.push("// 4. 若失敗，在 Console 執行 __maaruMyshipProbe() 查看欄位");
    lines.push("");
    lines.push(MYSHIP_RUNTIME_HELPERS);
    lines.push("");
    lines.push("const STORE_NAME = \"" + escapeJsString_(storeName) + "\";");
    lines.push("const items = [");
    for (i = 0; i < items.length; i++) {
      var row = items[i];
      lines.push("  { name: \"" + escapeJsString_(row.name) + "\", desc: \"" + escapeJsString_(row.name) + "\", price: " + row.price + ", qty: " + row.qty + " }" + (i < items.length - 1 ? "," : ""));
    }
    lines.push("];");
    lines.push("");
    lines.push("(async () => {");
    lines.push("  try {");
    lines.push("    assertMyshipPage();");
    lines.push("    await fillStoreName(STORE_NAME);");
    if (mode === "single") {
      lines.push("    console.log(\"[MAARU] 單一賣場模式，共 \" + items.length + \" 品項\");");
      lines.push("    for (let i = 0; i < items.length; i++) {");
      lines.push("      if (i > 0) await clickAddProduct();");
      lines.push("      await fillForm(items[i], i);");
      lines.push("    }");
      lines.push("    await submit();");
      lines.push("    console.log(\"✓ 已提交 1 個賣場（\" + items.length + \" 品項）\");");
    } else {
      lines.push("    console.log(\"[MAARU] 每品項一賣場模式\");");
      lines.push("    for (let i = 0; i < items.length; i++) {");
      lines.push("      if (i > 0) await prepareNextStore();");
      lines.push("      await fillStoreName(STORE_NAME);");
      lines.push("      await fillForm(items[i], 0);");
      lines.push("      await submit();");
      lines.push("      console.log(\"✓ 已建立第 \" + (i + 1) + \" 個賣場：\" + items[i].name);");
      lines.push("    }");
      lines.push("    console.log(\"✓ 全部完成，共 \" + items.length + \" 個賣場\");");
    }
    lines.push("  } catch (err) {");
    lines.push("    console.error(\"[MAARU] 腳本失敗\", err);");
    lines.push("    alert(\"賣貨便腳本失敗：\" + (err && err.message ? err.message : err));");
    lines.push("  }");
    lines.push("})();");
    return lines.join("\n");
  }

  function openMyshipEasyAdd_() {
    global.open(MYSHIP_EASY_ADD_URL, "_blank", "noopener,noreferrer");
  }

  function execCommandCopy_(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.width = "2em";
        ta.style.height = "2em";
        ta.style.padding = "0";
        ta.style.border = "none";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function copyFromElement_(el) {
    return new Promise(function (resolve, reject) {
      if (!el) {
        reject(new Error("no element"));
        return;
      }
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = global.getSelection();
        if (!sel) {
          reject(new Error("no selection"));
          return;
        }
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = document.execCommand("copy");
        sel.removeAllRanges();
        if (ok) resolve();
        else reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function copyText_(text, sourceEl) {
    if (!text || !String(text).trim()) return Promise.reject(new Error("empty"));
    text = String(text);
    if (sourceEl) {
      return copyFromElement_(sourceEl).catch(function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).catch(function () {
            return execCommandCopy_(text);
          });
        }
        return execCommandCopy_(text);
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return execCommandCopy_(text);
      });
    }
    return execCommandCopy_(text);
  }

  function showMyshipToast_(text, isError) {
    var toaster = document.getElementById("notificationToaster");
    if (!toaster) return;
    var toast = document.createElement("div");
    toast.className = "toast-item " + (isError ? "toast-error text-red-800" : "text-slate-700");
    toast.setAttribute("role", "alert");
    toast.textContent = text;
    toaster.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("toast-leaving");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 4000);
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
    var btnCopyProbe = document.getElementById("btnCopyMyshipProbe");
    var btnRegenScript = document.getElementById("btnRegenMyshipScript");
    var copyStatusEl = document.getElementById("myshipScriptCopyStatus");

    var currentScriptOrderId = null;
    var copyBtnDefaultLabel = btnCopyScript ? (btnCopyScript.textContent || "複製腳本") : "複製腳本";

    function setCopyStatus_(text, isError) {
      if (copyStatusEl) {
        copyStatusEl.textContent = text || "";
        copyStatusEl.className = "text-xs mr-auto " + (isError ? "text-red-600" : "text-emerald-700");
      }
      if (text) showMyshipToast_(text, !!isError);
    }

    function flashCopyButton_(ok) {
      if (!btnCopyScript) return;
      btnCopyScript.textContent = ok ? "已複製 ✓" : "複製失敗";
      btnCopyScript.classList.toggle("bg-emerald-600", ok);
      btnCopyScript.classList.toggle("hover:bg-emerald-700", ok);
      btnCopyScript.classList.toggle("bg-red-600", !ok);
      btnCopyScript.classList.toggle("hover:bg-red-700", !ok);
      setTimeout(function () {
        btnCopyScript.textContent = copyBtnDefaultLabel;
        btnCopyScript.classList.remove("bg-red-600", "hover:bg-red-700");
        btnCopyScript.classList.add("bg-emerald-600", "hover:bg-emerald-700");
      }, 2200);
    }

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
      if (copyStatusEl) {
        copyStatusEl.textContent = "";
        copyStatusEl.className = "text-xs mr-auto text-slate-500";
      }
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
    if (btnCopyProbe) {
      btnCopyProbe.addEventListener("click", function () {
        var probe = buildMyshipProbeScript_();
        copyText_(probe).then(function () {
          setCopyStatus_("偵測腳本已複製。請在賣貨便快速結帳頁 Console 貼上執行，會列出所有可填欄位。", false);
          flashCopyButton_(true);
        }).catch(function () {
          setCopyStatus_("複製偵測腳本失敗，請手動選取複製", true);
          flashCopyButton_(false);
        });
      });
    }
    if (btnCopyScript) {
      btnCopyScript.addEventListener("click", function () {
        var text = scriptCodeEl ? (scriptCodeEl.textContent || scriptCodeEl.innerText || "") : "";
        if (!String(text).trim() || String(text).indexOf("// 此訂單沒有") === 0) {
          setCopyStatus_("沒有可複製的腳本內容", true);
          flashCopyButton_(false);
          return;
        }
        if (copyStatusEl) copyStatusEl.textContent = "複製中…";
        copyText_(text, scriptCodeEl).then(function () {
          var msg = "腳本已複製，請到賣貨便快速結帳頁的 Console 貼上執行";
          setCopyStatus_(msg, false);
          flashCopyButton_(true);
          notify(msg);
        }).catch(function () {
          var msg = "自動複製失敗，請手動選取上方黑底腳本後 Ctrl+C";
          setCopyStatus_(msg, true);
          flashCopyButton_(false);
          notify(msg, true);
          if (scriptCodeEl) {
            try {
              var range = document.createRange();
              range.selectNodeContents(scriptCodeEl);
              var sel = global.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
            } catch (e) {}
          }
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
    buildMyshipProbeScript_: buildMyshipProbeScript_,
    openMyshipEasyAdd_: openMyshipEasyAdd_,
    initShippingSection: initShippingSection
  };
})(window);

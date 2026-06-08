/**
 * 後台出貨管理：7-ELEVEN 賣貨便快速結帳 Console 建單腳本
 * POST https://myship.7-11.com.tw/fast/add（與 ToyChain 相同方式）
 */
(function (global) {
  "use strict";

  var MYSHIP_FAST_ADD_URL = "https://myship.7-11.com.tw/fast/add";
  var MYSHIP_CONFIRM_BASE = "https://myship.7-11.com.tw/cart/confirm/";
  var MYSHIP_EASY_ADD_URL = MYSHIP_FAST_ADD_URL;

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

  function buildMyshipStoreName_(ord) {
    var customer = (ord && (ord.customerName || ord.name) || "").trim();
    var id = (ord && ord.id) ? String(ord.id).trim() : "";
    if (customer) return customer + "預購";
    if (id) return id + "預購";
    return "MAARU預購";
  }

  function buildMyshipStoresFromOrder_(ord, options) {
    options = options || {};
    var mode = options.mode === "perItem" ? "perItem" : "single";
    var items = buildMyshipScriptItems_(ord, options).map(function (it) {
      return { name: it.name, desc: it.name, price: it.price, qty: it.qty };
    });
    if (!items.length) return [];
    var baseName = buildMyshipStoreName_(ord);
    if (mode === "perItem") {
      return items.map(function (it) {
        return { name: baseName, items: [it] };
      });
    }
    return [{ name: baseName, items: items }];
  }

  var MYSHIP_RUNTIME_HELPERS = [
    "const MYSHIP_FAST_URL = \"" + MYSHIP_FAST_ADD_URL + "\";",
    "const MYSHIP_CONFIRM_BASE = \"" + MYSHIP_CONFIRM_BASE + "\";",
    "const norm = (s) => String(s || \"\").replace(/\\s+/g, \"\");",
    "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
    "",
    "function getMainForm() {",
    "  const forms = Array.from(document.querySelectorAll(\"form\"));",
    "  if (!forms.length) return null;",
    "  const scored = forms.map((form) => {",
    "    let score = 0;",
    "    const action = String(form.getAttribute(\"action\") || \"\");",
    "    const names = Array.from(form.querySelectorAll(\"[name]\")).map((el) => el.name).join(\" \");",
    "    if (/login|externallogin|socialnetwork/i.test(action)) score -= 200;",
    "    if (/\\[0\\]/.test(names)) score += 80;",
    "    if (/product|goods|detail|item|品|賣場|store|case/i.test(names)) score += 40;",
    "    if (/fast/i.test(action)) score += 30;",
    "    score += form.querySelectorAll(\"input, textarea, select\").length;",
    "    return { form, score };",
    "  });",
    "  scored.sort((a, b) => b.score - a.score);",
    "  return scored[0] && scored[0].score > 0 ? scored[0].form : forms[0];",
    "}",
    "",
    "function getFieldRoot() {",
    "  return getMainForm() || document.querySelector(\"#app, main, [class*='fast'], [class*='Fast']\") || document.body;",
    "}",
    "",
    "function getAllNamedFields(root) {",
    "  const scope = root || getFieldRoot();",
    "  return Array.from(scope.querySelectorAll(\"input[name], textarea[name], select[name]\"));",
    "}",
    "",
    "function isIndexedField(name) {",
    "  return name && /\\[\\d+\\]/.test(name);",
    "}",
    "",
    "function classifyField(name) {",
    "  const n = String(name || \"\").toLowerCase();",
    "  if (/name|品名|productname|goodsname|casename|title|品項名/.test(n) && !/store|shop|username|filename|storename|caseno/.test(n)) return \"name\";",
    "  if (/desc|description|介紹|描述|remark|memo|content|intro/.test(n)) return \"desc\";",
    "  if (/price|amount|售價|金額|單價|saleprice|goodsamt|amt/.test(n) && !/ship|運|fee|total/.test(n)) return \"price\";",
    "  if (/qty|quantity|數量|count|buy|goodsqty/.test(n)) return \"qty\";",
    "  if (/stock|庫存|inventory|goodsstock/.test(n)) return \"stock\";",
    "  return null;",
    "}",
    "",
    "function getIndexedSampleFields(root) {",
    "  const names = getAllNamedFields(root).map((el) => el.name).filter(Boolean);",
    "  let samples = names.filter((n) => /\\[0\\](\\.|$)/.test(n));",
    "  if (samples.length) return samples;",
    "  const groups = {};",
    "  names.forEach((n) => {",
    "    const m = n.match(/^(.+?)\\[0\\](.*)$/);",
    "    if (!m) return;",
    "    const key = m[1];",
    "    if (!groups[key]) groups[key] = [];",
    "    groups[key].push(n);",
    "  });",
    "  const best = Object.values(groups).sort((a, b) => b.length - a.length)[0];",
    "  return best || [];",
    "}",
    "",
    "function discoverFlatProductFields(root) {",
    "  const flat = {};",
    "  getAllNamedFields(root).forEach((el) => {",
    "    if (isIndexedField(el.name)) return;",
    "    const kind = classifyField(el.name);",
    "    if (kind && !flat[kind]) flat[kind] = el.name;",
    "  });",
    "  return flat;",
    "}",
    "",
    "function inferIndexedFromFlat(flatName, index) {",
    "  if (/\\[0\\]/.test(flatName)) return flatName.replace(/\\[0\\]/g, \"[\" + index + \"]\");",
    "  if (flatName.includes(\".\")) {",
    "    const parts = flatName.split(\".\");",
    "    return parts[0] + \"[\" + index + \"].\" + parts.slice(1).join(\".\");",
    "  }",
    "  return \"DetailList[\" + index + \"].\" + flatName;",
    "}",
    "",
    "const MYSHIP_KNOWN_TEMPLATES = [",
    "  { listKey: \"DetailList\", storeKeys: [\"StoreName\", \"CaseName\"], fields: { name: \"GoodsName\", desc: \"GoodsIntro\", price: \"GoodsAmt\", qty: \"GoodsQty\", stock: \"GoodsStockQty\" } },",
    "  { listKey: \"FastCaseDetailDtoList\", storeKeys: [\"CaseName\", \"StoreName\"], fields: { name: \"CaseGoodsName\", desc: \"CaseGoodsDesc\", price: \"CaseGoodsAmt\", qty: \"CaseGoodsQty\", stock: \"CaseGoodsStock\" } },",
    "  { listKey: \"Products\", storeKeys: [\"StoreName\"], fields: { name: \"Name\", desc: \"Description\", price: \"Price\", qty: \"Quantity\", stock: \"Stock\" } }",
    "];",
    "",
    "function matchKnownTemplate(allNames) {",
    "  for (const tpl of MYSHIP_KNOWN_TEMPLATES) {",
    "    if (allNames.some((n) => n.indexOf(tpl.listKey) >= 0)) {",
    "      const samples = Object.values(tpl.fields).map((f) => tpl.listKey + \"[0].\" + f);",
    "      return { tpl, samples };",
    "    }",
    "  }",
    "  return null;",
    "}",
    "",
    "function discoverProductPlan(root) {",
    "  const allNames = getAllNamedFields(root).map((el) => el.name).filter(Boolean);",
    "  const samples = getIndexedSampleFields(root);",
    "  if (samples.length) return { mode: \"indexed\", samples, allNames };",
    "  const flat = discoverFlatProductFields(root);",
    "  if (flat.name && flat.price) return { mode: \"flat\", flat, allNames };",
    "  const known = matchKnownTemplate(allNames);",
    "  if (known) return { mode: \"indexed\", samples: known.samples, tpl: known.tpl, allNames };",
    "  return { mode: \"fallback\", tpl: MYSHIP_KNOWN_TEMPLATES[0], allNames };",
    "}",
    "",
    "function appendStoreItems(fd, plan, store, root) {",
    "  const scope = root || getFieldRoot();",
    "  if (plan.mode === \"indexed\") {",
    "    const samples = plan.samples || [];",
    "    if (!samples.length) throw new Error(\"找不到商品欄位範本\");",
    "    store.items.forEach((item, i) => {",
    "      const used = new Set();",
    "      samples.forEach((sample) => {",
    "        const field = sample.replace(/\\[0\\]/g, \"[\" + i + \"]\");",
    "        if (used.has(field)) return;",
    "        const kind = classifyField(field);",
    "        if (kind === \"name\") fd.append(field, item.name);",
    "        else if (kind === \"desc\") fd.append(field, item.desc || item.name);",
    "        else if (kind === \"price\") fd.append(field, String(item.price));",
    "        else if (kind === \"qty\") fd.append(field, String(item.qty));",
    "        else if (kind === \"stock\") fd.append(field, String(Math.max(item.qty, 99)));",
    "        else if (i === 0) {",
    "          const el = getAllNamedFields(scope).find((node) => node.name === sample);",
    "          if (el && el.type !== \"file\") fd.append(field, el.value);",
    "        }",
    "        used.add(field);",
    "      });",
    "    });",
    "    return;",
    "  }",
    "  if (plan.mode === \"flat\") {",
    "    const flat = plan.flat;",
    "    store.items.forEach((item, i) => {",
    "      const nameKey = i === 0 ? flat.name : inferIndexedFromFlat(flat.name, i);",
    "      fd.append(nameKey, item.name);",
    "      if (flat.desc) fd.append(i === 0 ? flat.desc : inferIndexedFromFlat(flat.desc, i), item.desc || item.name);",
    "      fd.append(i === 0 ? flat.price : inferIndexedFromFlat(flat.price, i), String(item.price));",
    "      if (flat.qty) fd.append(i === 0 ? flat.qty : inferIndexedFromFlat(flat.qty, i), String(item.qty));",
    "      if (flat.stock) fd.append(i === 0 ? flat.stock : inferIndexedFromFlat(flat.stock, i), String(Math.max(item.qty, 99)));",
    "    });",
    "    return;",
    "  }",
    "  const tpl = plan.tpl || MYSHIP_KNOWN_TEMPLATES[0];",
    "  store.items.forEach((item, i) => {",
    "    fd.append(tpl.listKey + \"[\" + i + \"].\" + tpl.fields.name, item.name);",
    "    fd.append(tpl.listKey + \"[\" + i + \"].\" + tpl.fields.desc, item.desc || item.name);",
    "    fd.append(tpl.listKey + \"[\" + i + \"].\" + tpl.fields.price, String(item.price));",
    "    fd.append(tpl.listKey + \"[\" + i + \"].\" + tpl.fields.qty, String(item.qty));",
    "    fd.append(tpl.listKey + \"[\" + i + \"].\" + tpl.fields.stock, String(Math.max(item.qty, 99)));",
    "  });",
    "}",
    "",
    "async function ensureProductRowVisible() {",
    "  const root = getFieldRoot();",
    "  if (getIndexedSampleFields(root).length >= 2) return;",
    "  const flat = discoverFlatProductFields(root);",
    "  if (flat.name && flat.price) return;",
    "  const clickables = Array.from(document.querySelectorAll(\"button, a, [role='button'], .btn, input[type='button'], span\"));",
    "  const addBtn = clickables.find((el) => /新增商品|繼續新增|加入商品|新增品項/.test(norm(el.textContent || el.value || el.getAttribute(\"aria-label\") || \"\")));",
    "  if (addBtn) {",
    "    addBtn.click();",
    "    await sleep(900);",
    "  }",
    "}",
    "",
    "let __maaruLastToken = \"\";",
    "",
    "function extractTokenFromHtml(html) {",
    "  const m = String(html || \"\").match(/name=[\"']__RequestVerificationToken[\"'][^>]*value=[\"']([^\"']+)[\"']/i);",
    "  return m ? m[1] : \"\";",
    "}",
    "",
    "function syncTokenFromDom() {",
    "  const el = document.querySelector('input[name=\"__RequestVerificationToken\"]');",
    "  if (el && el.value) __maaruLastToken = el.value;",
    "}",
    "",
    "function setStoreName(fd, store, root) {",
    "  const scope = root || getFieldRoot();",
    "  const storeKeys = [\"StoreName\", \"storeName\", \"ShopName\", \"MarketName\", \"Title\", \"CaseName\"];",
    "  let storeSet = false;",
    "  storeKeys.forEach((key) => {",
    "    if (scope.querySelector('[name=\"' + key + '\"]')) {",
    "      fd.set(key, store.name);",
    "      storeSet = true;",
    "    }",
    "  });",
    "  if (!storeSet) {",
    "    const storeEl = Array.from(scope.querySelectorAll(\"input, textarea\")).find((el) => {",
    "      const bag = norm(el.name + el.id + (el.placeholder || \"\"));",
    "      return bag.includes(\"賣場\") && bag.includes(\"名稱\");",
    "    });",
    "    if (storeEl && storeEl.name) fd.set(storeEl.name, store.name);",
    "    else fd.set(\"StoreName\", store.name);",
    "  }",
    "}",
    "",
    "function buildFD(store) {",
    "  const root = getFieldRoot();",
    "  if (!root) throw new Error(\"找不到表單。請在 \" + MYSHIP_FAST_URL + \" 頁面執行（須已登入）\");",
    "  syncTokenFromDom();",
    "  const fd = new FormData();",
    "  getAllNamedFields(root).forEach((el) => {",
    "    if (el.name === \"__RequestVerificationToken\") return;",
    "    if (!el.name) return;",
    "    if (isIndexedField(el.name)) return;",
    "    const type = (el.type || \"\").toLowerCase();",
    "    if (type === \"file\") return;",
    "    if (type === \"checkbox\" || type === \"radio\") {",
    "      if (el.checked) fd.append(el.name, el.value);",
    "      return;",
    "    }",
    "    fd.append(el.name, el.value);",
    "  });",
    "  if (__maaruLastToken) fd.set(\"__RequestVerificationToken\", __maaruLastToken);",
    "  setStoreName(fd, store, root);",
    "  const plan = discoverProductPlan(root);",
    "  if (plan.mode === \"fallback\") {",
    "    console.warn(\"[MAARU] 無法從頁面讀取商品欄位，改用 DetailList 範本。若失敗請先點「新增商品」後執行 __maaruMyshipProbe()\");",
    "  }",
    "  if (plan.mode !== \"indexed\" && plan.mode !== \"flat\" && plan.mode !== \"fallback\") {",
    "    const hint = (plan.allNames || []).slice(0, 12).join(\", \");",
    "    throw new Error(\"找不到商品欄位範本。請先點「新增商品」、確認在快速結帳新增頁，或執行 __maaruMyshipProbe()。目前欄位：\" + (hint || \"（無 name 欄位）\"));",
    "  }",
    "  appendStoreItems(fd, plan, store, root);",
    "  return fd;",
    "}",
    "",
    "function assertMyshipPage() {",
    "  const body = norm(document.body ? document.body.innerText : \"\");",
    "  if (body.includes(\"請先登入\") || body.includes(\"Facebook\") && body.includes(\"LINE\") && !body.includes(\"商品\") && !body.includes(\"上架\")) {",
    "    throw new Error(\"請先登入賣貨便，並開啟：\" + MYSHIP_FAST_URL);",
    "  }",
    "  if ((location.pathname || \"\").toLowerCase().indexOf(\"/fast/\") < 0) {",
    "    console.warn(\"[MAARU] 建議在 /fast/add 頁面執行。目前：\", location.href);",
    "  }",
    "}",
    "",
    "window.__maaruMyshipProbe = function () {",
    "  const root = getFieldRoot();",
    "  console.log(\"[MAARU] 頁面\", location.href);",
    "  console.log(\"[MAARU] form\", getMainForm());",
    "  getAllNamedFields(root).forEach((el, i) => {",
    "    console.log(i, el.name, el.type, el.value);",
    "  });",
    "  const plan = discoverProductPlan(root);",
    "  console.log(\"[MAARU] 商品欄位計畫\", plan);",
    "  console.log(\"[MAARU] [0] 範本\", getIndexedSampleFields(root));",
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
    var stores = buildMyshipStoresFromOrder_(ord, options);
    if (!stores.length) return "";

    var customer = (ord.customerName || ord.name || "").trim();
    var shipFee = getEffectiveShippingFee_(ord);
    var itemCount = stores.reduce(function (n, s) { return n + (s.items ? s.items.length : 0); }, 0);
    var lines = [];
    var i;
    var j;
    var store;
    var it;

    lines.push("// MAARU 賣貨便批次建單 — " + (ord.id || "") + (customer ? " " + customer : ""));
    lines.push("// 待出貨品項 " + itemCount + " 筆 · 賣場 " + stores.length + " 個 · 建議運費 NT$" + shipFee);
    lines.push("//");
    lines.push("// 使用方式（與 ToyChain 相同）：");
    lines.push("// 1. 登入賣貨便");
    lines.push("// 2. 開啟快速結帳新增頁 → " + MYSHIP_FAST_ADD_URL);
    lines.push("// 3. 先設定好運費／日期等（腳本會沿用目前表單預設）");
    lines.push("// 4. F12 → Console 貼上執行");
    lines.push("");
    lines.push(MYSHIP_RUNTIME_HELPERS);
    lines.push("");
    lines.push("const stores = [");
    for (i = 0; i < stores.length; i++) {
      store = stores[i];
      lines.push("  {");
      lines.push("    name: \"" + escapeJsString_(store.name) + "\",");
      lines.push("    items: [");
      for (j = 0; j < store.items.length; j++) {
        it = store.items[j];
        lines.push("      { name: \"" + escapeJsString_(it.name) + "\", desc: \"" + escapeJsString_(it.desc || it.name) + "\", price: " + it.price + ", qty: " + it.qty + " }" + (j < store.items.length - 1 ? "," : ""));
      }
      lines.push("    ]");
      lines.push("  }" + (i < stores.length - 1 ? "," : ""));
    }
    lines.push("];");
    lines.push("");
    lines.push("const t0 = Date.now();");
    lines.push("window._loopResults = null;");
    lines.push("");
    lines.push("(async () => {");
    lines.push("  try {");
    lines.push("    assertMyshipPage();");
    lines.push("    await ensureProductRowVisible();");
    lines.push("    const results = [];");
    lines.push("    for (const store of stores) {");
    lines.push("      const resp = await fetch(MYSHIP_FAST_URL, {");
    lines.push("        method: \"POST\",");
    lines.push("        body: buildFD(store),");
    lines.push("        redirect: \"follow\",");
    lines.push("        credentials: \"include\"");
    lines.push("      });");
    lines.push("      const text = await resp.text();");
    lines.push("      const nextToken = extractTokenFromHtml(text);");
    lines.push("      if (nextToken) __maaruLastToken = nextToken;");
    lines.push("      const id = text.match(/GM[A-Za-z0-9]+/)?.[0] || \"check-list\";");
    lines.push("      results.push({ store: store.name, id, ms: Date.now() - t0, url: resp.url });");
    lines.push("    }");
    lines.push("    window._loopResults = { results, total: Date.now() - t0 };");
    lines.push("    console.log(\"\\n\" + results.map((r) =>");
    lines.push("      r.store + \"\\n\" + MYSHIP_CONFIRM_BASE + r.id");
    lines.push("    ).join(\"\\n\\n\") + \"\\n\\n共 \" + results.length + \" 筆，耗時 \" + ((Date.now() - t0) / 1000).toFixed(1) + \"s\");");
    lines.push("  } catch (err) {");
    lines.push("    console.error(\"[MAARU] 腳本失敗\", err);");
    lines.push("    alert(\"賣貨便腳本失敗：\" + (err && err.message ? err.message : err));");
    lines.push("  }");
    lines.push("})();");
    return lines.join("\n");
  }

  function openMyshipEasyAdd_() {
    global.open(MYSHIP_FAST_ADD_URL, "_blank", "noopener,noreferrer");
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
    MYSHIP_FAST_ADD_URL: MYSHIP_FAST_ADD_URL,
    MYSHIP_CONFIRM_BASE: MYSHIP_CONFIRM_BASE,
    MYSHIP_EASY_ADD_URL: MYSHIP_FAST_ADD_URL,
    isMyshipShippingMethod_: isMyshipShippingMethod_,
    getPendingShipItems_: getPendingShipItems_,
    buildMyshipConsoleScript_: buildMyshipConsoleScript_,
    buildMyshipProbeScript_: buildMyshipProbeScript_,
    openMyshipEasyAdd_: openMyshipEasyAdd_,
    initShippingSection: initShippingSection
  };
})(window);

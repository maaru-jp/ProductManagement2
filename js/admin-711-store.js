/**
 * 後台訂單：7-ELEVEN 門市選擇（縣市／區域查詢 + 官方電子地圖）
 * 需透過 start.bat（server.py）開啟，/api/711 代理 emap.pcsc.com.tw
 */
(function (global) {
  "use strict";

  var TW_711_CITIES = [
    { id: "01", name: "台北市" },
    { id: "02", name: "基隆市" },
    { id: "03", name: "新北市" },
    { id: "04", name: "宜蘭縣" },
    { id: "05", name: "新竹市" },
    { id: "06", name: "新竹縣" },
    { id: "07", name: "桃園市" },
    { id: "08", name: "苗栗縣" },
    { id: "09", name: "台中市" },
    { id: "10", name: "彰化縣" },
    { id: "11", name: "南投縣" },
    { id: "12", name: "雲林縣" },
    { id: "13", name: "嘉義市" },
    { id: "14", name: "嘉義縣" },
    { id: "15", name: "台南市" },
    { id: "16", name: "高雄市" },
    { id: "17", name: "澎湖縣" },
    { id: "18", name: "屏東縣" },
    { id: "19", name: "台東縣" },
    { id: "20", name: "花蓮縣" },
    { id: "21", name: "金門縣" },
    { id: "22", name: "連江縣" }
  ];

  function onLocalDevServer_() {
    var h = global.location && global.location.hostname;
    return h === "localhost" || h === "127.0.0.1";
  }

  function is711ShippingMethod_(value) {
    var v = String(value || "").trim();
    return v.indexOf("7-11") >= 0 || v.indexOf("7-11") >= 0 || v.indexOf("711") >= 0 || v.indexOf("超商") >= 0;
  }

  function format711StoreName_(raw) {
    var n = String(raw || "").trim();
    if (!n) return "";
    if (n.indexOf("門市") >= 0) return n;
    return n + "門市";
  }

  function apply711StoreToForm_(store, els) {
    if (!store || !els) return;
    if (els.storeNameEl) els.storeNameEl.value = format711StoreName_(store.name);
    if (els.storeIdEl) els.storeIdEl.value = String(store.id || "").trim();
    if (els.addressEl) els.addressEl.value = String(store.address || "").trim();
    if (els.shippingMethodEl && !els.shippingMethodEl.value) {
      els.shippingMethodEl.value = "7-11超商取貨";
    }
  }

  function fetch711Json_(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || (data && data.error)) {
          throw new Error((data && data.message) || ("HTTP " + res.status));
        }
        return data;
      });
    });
  }

  function init711StorePicker(options) {
    options = options || {};
    var els = {
      shippingMethodEl: options.shippingMethodEl || document.getElementById("orderShippingMethod"),
      storeNameEl: options.storeNameEl || document.getElementById("orderStoreName"),
      storeIdEl: options.storeIdEl || document.getElementById("orderStoreId"),
      addressEl: options.addressEl || document.getElementById("orderAddress")
    };
    var notify = typeof options.notify === "function" ? options.notify : function () {};
    var wrap = document.getElementById("order711StorePickerWrap");
    var btnOpen = document.getElementById("btnOpen711StorePicker");
    var btnEmap = document.getElementById("btnOpen711Emap");
    var modal = document.getElementById("sevenElevenStoreModal");
    var backdrop = document.getElementById("sevenElevenStoreBackdrop");
    var btnClose = document.getElementById("sevenElevenStoreClose");
    var citySel = document.getElementById("711CitySelect");
    var townSel = document.getElementById("711TownSelect");
    var searchInput = document.getElementById("711StoreSearch");
    var listEl = document.getElementById("711StoreList");
    var statusEl = document.getElementById("711StoreStatus");
    var storesCache = [];

    function setStatus_(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.className = "text-xs mt-2 " + (isError ? "text-red-600" : "text-slate-500");
    }

    function refresh711PickerVisibility_() {
      if (!wrap || !els.shippingMethodEl) return;
      var show = is711ShippingMethod_(els.shippingMethodEl.value);
      wrap.classList.toggle("hidden", !show);
    }

    function fill711Cities_() {
      if (!citySel) return;
      citySel.innerHTML = TW_711_CITIES.map(function (c) {
        return "<option value=\"" + c.id + "\">" + c.name + "</option>";
      }).join("");
    }

    function load711Towns_() {
      if (!citySel || !townSel) return Promise.resolve();
      var cityId = citySel.value;
      townSel.innerHTML = "<option value=\"\">載入中…</option>";
      townSel.disabled = true;
      return fetch711Json_("/api/711/towns?city_id=" + encodeURIComponent(cityId))
        .then(function (data) {
          var towns = data.towns || [];
          if (!towns.length) {
            townSel.innerHTML = "<option value=\"\">（無資料）</option>";
            return;
          }
          townSel.innerHTML = towns.map(function (t) {
            return "<option value=\"" + String(t).replace(/"/g, "&quot;") + "\">" + t + "</option>";
          }).join("");
          townSel.disabled = false;
        })
        .catch(function (err) {
          townSel.innerHTML = "<option value=\"\">載入失敗</option>";
          setStatus_(err.message || "無法載入區域", true);
        });
    }

    function render711StoreList_(items) {
      if (!listEl) return;
      if (!items.length) {
        listEl.innerHTML = "<li class=\"py-6 text-center text-slate-500 text-sm\">找不到門市，請換區域或關鍵字</li>";
        return;
      }
      listEl.innerHTML = items.map(function (s, idx) {
        return "<li><button type=\"button\" class=\"711-store-pick w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/60 transition\" data-idx=\"" + idx + "\">" +
          "<div class=\"font-medium text-slate-800\">" + escapeHtml711_(format711StoreName_(s.name)) + " <span class=\"font-mono text-xs text-slate-500\">" + escapeHtml711_(s.id) + "</span></div>" +
          "<div class=\"text-xs text-slate-500 mt-0.5\">" + escapeHtml711_(s.address || "") + "</div>" +
          "</button></li>";
      }).join("");
      listEl.querySelectorAll(".711-store-pick").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var idx = parseInt(btn.getAttribute("data-idx"), 10);
          var picked = storesCache[idx];
          if (!picked) return;
          apply711StoreToForm_(picked, els);
          close711Modal_();
          notify("已帶入 7-11 門市：" + format711StoreName_(picked.name) + "（" + picked.id + "）", false);
        });
      });
    }

    function escapeHtml711_(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function load711Stores_() {
      if (!citySel || !townSel) return Promise.resolve();
      if (!onLocalDevServer_()) {
        setStatus_("請用 start.bat 開啟 http://localhost:3000/admin.html 才能查詢門市", true);
        return Promise.resolve();
      }
      var cityId = citySel.value;
      var town = townSel.value;
      if (!cityId || !town) {
        setStatus_("請先選擇縣市與鄉鎮區", true);
        return Promise.resolve();
      }
      setStatus_("載入門市清單中…", false);
      if (listEl) listEl.innerHTML = "";
      var q = searchInput && searchInput.value ? searchInput.value.trim() : "";
      var url = "/api/711/stores?city_id=" + encodeURIComponent(cityId) + "&town=" + encodeURIComponent(town);
      if (q) url += "&q=" + encodeURIComponent(q);
      return fetch711Json_(url)
        .then(function (data) {
          storesCache = data.stores || [];
          render711StoreList_(storesCache);
          setStatus_("共 " + storesCache.length + " 間門市", false);
        })
        .catch(function (err) {
          storesCache = [];
          render711StoreList_([]);
          setStatus_("載入失敗：" + (err.message || ""), true);
        });
    }

    function open711Modal_() {
      if (!modal) return;
      if (!onLocalDevServer_()) {
        notify("7-11 門市查詢需執行 start.bat，用 http://localhost:3000/admin.html 開啟後台", true);
        return;
      }
      fill711Cities_();
      modal.classList.remove("hidden");
      load711Towns_().then(function () { return load711Stores_(); });
    }

    function close711Modal_() {
      if (modal) modal.classList.add("hidden");
    }

    function open711Emap_() {
      if (!onLocalDevServer_()) {
        notify("電子地圖需用 start.bat 本機伺服器開啟後台", true);
        return;
      }
      var callback = global.location.origin + "/cvs711-callback";
      var form = document.createElement("form");
      form.method = "POST";
      form.action = "https://emap.presco.com.tw/c2cemap.ashx";
      form.target = "maaru711Emap";
      form.style.display = "none";
      [
        ["eshopid", "870"],
        ["servicetype", "1"],
        ["url", callback]
      ].forEach(function (pair) {
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = pair[0];
        input.value = pair[1];
        form.appendChild(input);
      });
      document.body.appendChild(form);
      global.open("", "maaru711Emap", "width=920,height=720,scrollbars=yes");
      form.submit();
      document.body.removeChild(form);
    }

    global.addEventListener("message", function (ev) {
      if (!ev.data || ev.data.type !== "maaru:cvs711") return;
      if (ev.origin !== global.location.origin) return;
      var s = ev.data.store || {};
      apply711StoreToForm_({
        id: s.storeid || s.id,
        name: s.storename || s.name,
        address: s.storeaddress || s.address
      }, els);
      notify("已從電子地圖帶入 7-11 門市", false);
    });

    if (btnOpen) btnOpen.addEventListener("click", open711Modal_);
    if (btnEmap) btnEmap.addEventListener("click", open711Emap_);
    if (btnClose) btnClose.addEventListener("click", close711Modal_);
    if (backdrop) backdrop.addEventListener("click", close711Modal_);
    if (citySel) citySel.addEventListener("change", function () {
      load711Towns_().then(function () { return load711Stores_(); });
    });
    if (townSel) townSel.addEventListener("change", load711Stores_);
    if (searchInput) {
      var searchTimer = null;
      searchInput.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(load711Stores_, 350);
      });
    }
    if (els.shippingMethodEl) {
      els.shippingMethodEl.addEventListener("change", refresh711PickerVisibility_);
      refresh711PickerVisibility_();
    }
  }

  global.init711StorePicker = init711StorePicker;
  global.is711ShippingMethod_ = is711ShippingMethod_;
})(window);

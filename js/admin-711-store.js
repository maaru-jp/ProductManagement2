/**
 * 後台訂單：7-ELEVEN 門市選擇
 * - 內建縣市查詢（/api/711 代理 emap.pcsc.com.tw）→ 自動帶入
 * - ibon 門市查詢（參考用，需手動填寫）：https://www.ibon.com.tw/mobile/retail_inquiry.aspx
 */
(function (global) {
  "use strict";

  var IBON_RETAIL_INQUIRY_URL = "https://www.ibon.com.tw/mobile/retail_inquiry.aspx";

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
    return v.indexOf("7-11") >= 0 || v.indexOf("711") >= 0 || v.indexOf("超商") >= 0;
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

  function fetch711Json_(url, timeoutMs) {
    timeoutMs = timeoutMs || 25000;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetch(url, {
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        if (timer) clearTimeout(timer);
        var data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          if (res.status === 404) {
            throw new Error("711 API 不存在。請關閉舊的命令視窗，重新雙擊 start.bat");
          }
          throw new Error("API 回應異常（請重新執行 start.bat）");
        }
        if (!res.ok || (data && data.error)) {
          throw new Error((data && data.message) || ("HTTP " + res.status));
        }
        return data;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === "AbortError") {
        throw new Error("連線逾時。若門市很多請稍候再試，或換較小的區域");
      }
      throw err;
    });
  }

  function openIbonRetailInquiry_(notify) {
    var win = global.open(IBON_RETAIL_INQUIRY_URL, "maaruIbonRetailInquiry", "width=420,height=720,scrollbars=yes,resizable=yes");
    if (!win) {
      global.location.href = IBON_RETAIL_INQUIRY_URL;
      return;
    }
    if (typeof notify === "function") {
      notify("已開啟 ibon 門市查詢。查到的店名、店號、地址請手動填入下方欄位", false);
    }
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
    var btnIbon = document.getElementById("btnOpenIbonRetailInquiry");
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
      if (!citySel || !townSel) return Promise.resolve(false);
      var cityId = citySel.value;
      townSel.innerHTML = "<option value=\"\">載入中…</option>";
      townSel.disabled = true;
      if (listEl) listEl.innerHTML = "<li class=\"py-6 text-center text-slate-500 text-sm\">載入區域中…</li>";
      return fetch711Json_("/api/711/towns?city_id=" + encodeURIComponent(cityId), 15000)
        .then(function (data) {
          var towns = data.towns || [];
          if (!towns.length) {
            townSel.innerHTML = "<option value=\"\">（無資料）</option>";
            townSel.disabled = true;
            setStatus_("此縣市查無區域資料", true);
            return false;
          }
          townSel.innerHTML = towns.map(function (t) {
            return "<option value=\"" + String(t).replace(/"/g, "&quot;") + "\">" + t + "</option>";
          }).join("");
          townSel.disabled = false;
          return true;
        })
        .catch(function (err) {
          townSel.innerHTML = "<option value=\"\">載入失敗</option>";
          townSel.disabled = true;
          if (listEl) listEl.innerHTML = "<li class=\"py-6 text-center text-red-500 text-sm\">" + escapeHtml711_(err.message || "無法載入") + "</li>";
          setStatus_(err.message || "無法載入區域", true);
          return false;
        });
    }

    function render711StoreList_(items) {
      if (!listEl) return;
      if (!items.length) {
        listEl.innerHTML = "<li class=\"py-6 text-center text-slate-500 text-sm\">找不到門市，請換區域或關鍵字，或改用 ibon 門市查詢</li>";
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
        setStatus_("請用 start.bat 開啟 http://localhost:3000/admin.html，或改用 ibon 門市查詢", true);
        return Promise.resolve();
      }
      var cityId = citySel.value;
      var town = townSel.value;
      if (!cityId || !town || town === "載入中…" || town === "載入失敗" || town.indexOf("無資料") >= 0) {
        setStatus_("請先選擇有效的鄉鎮區", false);
        return Promise.resolve();
      }
      setStatus_("載入門市清單中…", false);
      if (listEl) listEl.innerHTML = "<li class=\"py-6 text-center text-slate-500 text-sm\">載入門市中，請稍候…</li>";
      var q = searchInput && searchInput.value ? searchInput.value.trim() : "";
      var url = "/api/711/stores?city_id=" + encodeURIComponent(cityId) + "&town=" + encodeURIComponent(town);
      if (q) url += "&q=" + encodeURIComponent(q);
      return fetch711Json_(url, 45000)
        .then(function (data) {
          storesCache = data.stores || [];
          render711StoreList_(storesCache);
          setStatus_("共 " + storesCache.length + " 間門市", false);
        })
        .catch(function (err) {
          storesCache = [];
          render711StoreList_([]);
          setStatus_("載入失敗：" + (err.message || "") + "（可改用 ibon 門市查詢）", true);
        });
    }

    function open711Modal_() {
      if (!modal) return;
      if (!onLocalDevServer_()) {
        notify("自動選店需執行 start.bat；您也可直接按「ibon 門市查詢」", true);
        openIbonRetailInquiry_(notify);
        return;
      }
      fill711Cities_();
      if (searchInput) searchInput.value = "";
      setStatus_("正在載入…", false);
      modal.classList.remove("hidden");
      load711Towns_().then(function (ok) {
        if (ok) return load711Stores_();
      });
    }

    function close711Modal_() {
      if (modal) modal.classList.add("hidden");
    }

    if (btnOpen) btnOpen.addEventListener("click", open711Modal_);
    if (btnIbon) btnIbon.addEventListener("click", function () {
      openIbonRetailInquiry_(notify);
    });
    if (btnClose) btnClose.addEventListener("click", close711Modal_);
    if (backdrop) backdrop.addEventListener("click", close711Modal_);
    if (citySel) citySel.addEventListener("change", function () {
      load711Towns_().then(function (ok) {
        if (ok) return load711Stores_();
      });
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
  global.openIbonRetailInquiry_ = openIbonRetailInquiry_;
  global.IBON_RETAIL_INQUIRY_URL = IBON_RETAIL_INQUIRY_URL;
})(window);

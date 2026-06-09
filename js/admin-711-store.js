/**
 * 後台訂單：7-ELEVEN 門市查詢（ibon 門市查詢頁）
 * https://www.ibon.com.tw/mobile/retail_inquiry.aspx
 */
(function (global) {
  "use strict";

  var IBON_RETAIL_INQUIRY_URL = "https://www.ibon.com.tw/mobile/retail_inquiry.aspx#gsc.tab=0";

  function is711ShippingMethod_(value) {
    var v = String(value || "").trim();
    return v.indexOf("7-11") >= 0 || v.indexOf("711") >= 0 || v.indexOf("超商") >= 0;
  }

  function openIbonRetailInquiry_(notify) {
    var win = global.open(IBON_RETAIL_INQUIRY_URL, "maaruIbonRetailInquiry", "width=420,height=720,scrollbars=yes,resizable=yes");
    if (!win) {
      global.open(IBON_RETAIL_INQUIRY_URL, "_blank", "noopener,noreferrer");
    }
    if (typeof notify === "function") {
      notify("已開啟 ibon 門市查詢。請將查到的店名、店號、地址手動填入下方欄位", false);
    }
  }

  function init711StorePicker(options) {
    options = options || {};
    var els = {
      shippingMethodEl: options.shippingMethodEl || document.getElementById("orderShippingMethod")
    };
    var notify = typeof options.notify === "function" ? options.notify : function () {};
    var wrap = document.getElementById("order711StorePickerWrap");
    var btnIbon = document.getElementById("btnOpenIbonRetailInquiry");

    function refresh711PickerVisibility_() {
      if (!wrap || !els.shippingMethodEl) return;
      var show = is711ShippingMethod_(els.shippingMethodEl.value);
      wrap.classList.toggle("hidden", !show);
    }

    if (btnIbon) {
      btnIbon.addEventListener("click", function () {
        openIbonRetailInquiry_(notify);
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

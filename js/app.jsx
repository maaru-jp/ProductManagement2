function getHashPath() {
  const raw = window.location.hash || "#/";
  const hash = raw.startsWith("#") ? raw.slice(1) : raw;
  return hash.startsWith("/") ? hash : "/" + hash;
}

function useHashPath() {
  const [path, setPath] = React.useState(getHashPath());

  React.useEffect(() => {
    const onChange = () => setPath(getHashPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return path;
}

function navigateTo(path) {
  const normalized = path.startsWith("/") ? path : "/" + path;
  window.location.hash = normalized;
}

function Link({ to, className, children }) {
  const href = "#" + (to.startsWith("/") ? to : "/" + to);
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        // keep default behavior for new tab / modifiers
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigateTo(to);
      }}
    >
      {children}
    </a>
  );
}

function getRoute(path) {
  // path may include query: "/?category=xxx"
  const [pathname, searchPart] = path.includes("?") ? path.split("?", 2) : [path, ""];
  const search = searchPart ? "?" + searchPart : "";

  // routes:
  // - "/" => home
  // - "/product/:name" => detail (name is URI encoded)
  if (pathname === "/" || pathname === "") return { name: "home", search };
  if (pathname.startsWith("/product/")) {
    const encodedName = pathname.slice("/product/".length);
    return { name: "product", encodedName, search };
  }
  return { name: "notfound", search };
}

function toNumberOrNull(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 從商品或 raw 取得單一庫存數字（含 0），沒資料回傳 null；供顧客頁穩定顯示庫存用 */
function getProductStockNumber(p) {
  if (!p || typeof p !== "object") return null;
  const tryVal = (val) => {
    if (val === undefined || val === null || val === "") return null;
    const n = typeof val === "number" ? val : parseInt(String(val).trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  const direct =
    tryVal(p.stock) ?? tryVal(p.庫存) ?? tryVal(p["庫存"]) ?? tryVal(p["庫存數量"]) ?? tryVal(p.Stock) ??
    tryVal(p.raw?.stock) ?? tryVal(p.raw?.庫存) ?? tryVal(p.raw?.["庫存"]) ?? tryVal(p.raw?.["庫存數量"]) ?? tryVal(p.raw?.Stock);
  if (direct != null) return direct;
  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      if (/^stock$/i.test(k) || (typeof k === "string" && k.includes("庫存") && !k.includes("規格"))) {
        const n = tryVal(obj[k]);
        if (n != null) return n;
      }
    }
    return null;
  };
  return scan(p) ?? scan(p?.raw) ?? null;
}

function toBoolFlag(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "t";
}

function parseDateOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isWithinLastDays(dateValue, days) {
  const d = parseDateOrNull(dateValue);
  if (!d) return false;
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 0) return true; // future date: treat as new
  return ms <= days * 24 * 60 * 60 * 1000;
}

/** 上架日期是否為「今天」（以當地日期比對） */
function isPublishedToday(dateValue) {
  const d = parseDateOrNull(dateValue);
  if (!d) return false;
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
}

function formatJPY(n) {
  const num = toNumberOrNull(n);
  if (num == null) return null;
  return "¥ " + Math.round(num).toLocaleString("ja-JP");
}

function formatTWDFromJPY(jpy, rate) {
  const j = toNumberOrNull(jpy);
  const r = toNumberOrNull(rate);
  if (j == null || r == null) return null;
  return "NT$" + Math.round(j * r).toLocaleString("zh-TW");
}

// 顧客頁顯示價：優先「顧客顯示售價」（後台選建議售價時），否則台幣售價，再否則日幣×匯率
function getDisplayPrice(product, rate) {
  const customerPrice = toNumberOrNull(product?.customerDisplayPrice);
  if (customerPrice != null && Number.isFinite(customerPrice)) {
    return "NT$" + Math.round(customerPrice).toLocaleString("zh-TW");
  }
  const twd = toNumberOrNull(product?.sellingPrice);
  if (twd != null && Number.isFinite(twd)) {
    return "NT$" + Math.round(twd).toLocaleString("zh-TW");
  }
  return formatTWDFromJPY(product?.price, rate);
}

// 每單位台幣金額（用於購物車小計／總計）：與顧客頁顯示一致，優先顧客顯示售價
function getUnitTWD(product, rate) {
  const customerPrice = toNumberOrNull(product?.customerDisplayPrice);
  if (customerPrice != null && Number.isFinite(customerPrice)) return customerPrice;
  const twd = toNumberOrNull(product?.sellingPrice);
  if (twd != null && Number.isFinite(twd)) return twd;
  const j = toNumberOrNull(product?.price);
  const r = toNumberOrNull(rate);
  if (j != null && r != null) return j * r;
  return null;
}

// ※ 顧客頁商品來源：請換成「您自己的」Google 試算表網頁應用程式 URL（與後台 admin 使用同一個部署 URL）。
const API_URL =
  "https://script.google.com/macros/s/AKfycbyyFnwQVNVamiWRD23U4TOIKnR_iHqfO3ObFmFl_lfqepR8tvFgvWvm5YBqxuFWZiaBfw/exec";

// 本機開發時用同源的 /api，由 server.py 代為請求 Google，避免 CORS
const isLocalDev =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const API_URL_LOCAL = "/api";

// 在 GitHub Pages 等跨站環境下，Google 試算表 API 常因 CORS 被擋，失敗時改經由此 proxy 重試
const CORS_PROXY_PREFIX = "https://corsproxy.io/?";

function normalizeItem(row, index) {
  if (!row || typeof row !== "object") return null;

  const id = row.id ?? row.ID ?? row.序號 ?? row.編號 ?? String(index + 1);
  const name = row.name ?? row.商品名稱 ?? row.title ?? row.品名 ?? "";
  const rawPrice =
    row.price ??
    row.價格 ??
    row.priceTWD ??
    row.Price ??
    row["日幣價格"] ??
    null;
  const price = toNumberOrNull(rawPrice);
  const rawSelling =
    row.sellingPrice ?? row.售價 ?? row.台幣售價 ?? row["台幣售價"] ?? null;
  const sellingPrice = toNumberOrNull(rawSelling);
  const rawCustomerDisplay =
    row.customerDisplayPrice ?? row.顧客顯示售價 ?? row["顧客顯示售價"] ?? null;
  const customerDisplayPrice = toNumberOrNull(rawCustomerDisplay);
  // 顧客頁商品卡主圖：優先使用試算表「商品主圖」／「圖片URL」欄位，有填則不顯示 No Image
  const image = (
    row["商品主圖"] ??
    row["圖片URL"] ??
    row.imageUrl ??
    row.image ??
    row.圖片 ??
    row["主圖"] ??
    row.Image ??
    ""
  ).toString().trim();
  const rawVariantStock = row.variantStock ?? row.規格庫存 ?? row["規格庫存"] ?? "";
  let variantStock = Array.isArray(rawVariantStock)
    ? rawVariantStock.map((x) => Math.max(0, toNumberOrNull(x) ?? 0))
    : typeof rawVariantStock === "string"
      ? rawVariantStock.split(/[,，、\s]+/).map((s) => Math.max(0, toNumberOrNull(s.trim()) ?? 0))
      : [];
  let mainStockNum = toNumberOrNull(row.stock ?? row.庫存 ?? row["庫存"] ?? row["庫存數量"] ?? row.Stock);
  if (mainStockNum == null && row && typeof row === "object") {
    for (const k of Object.keys(row)) {
      if ((/^stock$/i.test(k) || (k.includes("庫存") && !k.includes("規格"))) && row[k] !== "" && row[k] != null) {
        const n = toNumberOrNull(row[k]);
        if (n != null) { mainStockNum = n; break; }
      }
    }
  }
  // 後台只填「庫存」、未填「規格庫存」時，用主庫存作為唯一數量（含 0），顧客頁才能顯示
  if (variantStock.length === 0 && mainStockNum !== null && mainStockNum !== undefined) {
    variantStock = [Math.max(0, mainStockNum)];
  }
  const stock = variantStock.length > 0 ? variantStock[0] : mainStockNum;
  const rawVariantImages =
    row.variantImages ?? row.規格圖片 ?? row["規格圖片"] ?? "";
  const variantImages = Array.isArray(rawVariantImages)
    ? rawVariantImages.filter((u) => u && String(u).trim())
    : typeof rawVariantImages === "string"
      ? rawVariantImages.split(/[,，、\n;；]+/).map((s) => s.trim()).filter(Boolean)
      : [];
  const description =
    row.description ?? row.描述 ?? row.說明 ?? row.content ?? "";
  const introduction =
    row.introduction ??
    row.商品介紹 ??
    row.介紹 ??
    row.intro ??
    "";
  let rawVariant = row.variant ?? row.規格 ?? row.顏色 ?? row.option ?? "";
  if (rawVariant == null || String(rawVariant).trim() === "") {
    const parts = [
      row.規格1 ?? row.variant1,
      row.規格2 ?? row.variant2,
      row.規格3 ?? row.variant3,
      row.規格4 ?? row.variant4,
    ].filter((x) => x != null && String(x).trim() !== "");
    rawVariant = parts.length ? parts.map((x) => String(x).trim()).join(", ") : "";
  }
  const variant = Array.isArray(rawVariant)
    ? rawVariant.map((v) => String(v).trim()).filter(Boolean).join(",")
    : (rawVariant != null && rawVariant !== "" ? String(rawVariant).trim() : "");
  const category = row.category ?? row.分類 ?? "";
  const subcategory = row.subcategory ?? row.子分類 ?? "";
  const character = row.character ?? row.角色 ?? row.角色名稱 ?? "";
  const stockType = (row.stockType ?? row.貨況 ?? row["貨況"] ?? row.現貨預購 ?? row["現貨預購"] ?? row["現貨/預購"] ?? "").toString().trim();
  const status = (row.status ?? row.狀態 ?? "上架").toString().trim() || "上架";
  const isHot = toBoolFlag(row.hot ?? row.熱銷);
  const isRecommended = toBoolFlag(row.recommended ?? row.推薦);
  const publishedAt = row.publishedAt ?? row.上架日期 ?? row.上架時間 ?? null;
  const isNewByFlag = toBoolFlag(row.isNew ?? row.新品);
  const isNewListing = toBoolFlag(row.isNewListing ?? row.新上架);
  const isNewByDate = isWithinLastDays(publishedAt, 7);
  const isNew = isNewByFlag || isNewListing || isNewByDate;

  const sku = [name, variant, price ?? ""].join("||");

  return {
    raw: row,
    id,
    sku,
    name,
    price,
    sellingPrice,
    customerDisplayPrice: customerDisplayPrice != null && Number.isFinite(customerDisplayPrice) ? customerDisplayPrice : null,
    image,
    variantImages,
    variantStock,
    stock,
    description,
    introduction,
    variant,
    category,
    subcategory,
    character,
    stockType,
    status,
    isHot,
    isRecommended,
    isNew,
    isNewListing,
    publishedAt,
  };
}

function useProducts() {
  const [products, setProducts] = React.useState([]);
  const [rate, setRate] = React.useState(null);
  const [characterImages, setCharacterImages] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const fetchDataRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchData(silent = false) {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      let lastError = null;
      const t = Date.now();
      const sep = API_URL.indexOf("?") >= 0 ? "&" : "?";
      const apiUrlWithBust = API_URL + sep + "_t=" + t;
      const urlsToTry = isLocalDev
        ? [API_URL_LOCAL + (API_URL_LOCAL.indexOf("?") >= 0 ? "&" : "?") + "_t=" + t, apiUrlWithBust, CORS_PROXY_PREFIX + encodeURIComponent(apiUrlWithBust)]
        : [apiUrlWithBust, CORS_PROXY_PREFIX + encodeURIComponent(apiUrlWithBust)];
      for (const url of urlsToTry) {
        if (cancelled) break;
        try {
          // 不要加自訂 header，否則會觸發 CORS preflight；URL 已帶 _t 讓 Google／proxy 不回傳快取
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
          if (
            text.trimStart().startsWith("<") ||
            contentType.includes("text/html")
          ) {
            throw new Error(
              "API 回傳了 HTML 而非 JSON，請確認：1) 試算表已部署為「網頁應用程式」且「誰可以存取」選「任何人」；2) 前端的 API_URL 是否為正確的「網頁應用程式 URL」；3) 首次開啟部署連結時是否已在瀏覽器授權。"
            );
          }
          let data;
          try {
            data = JSON.parse(text);
          } catch (parseErr) {
            throw new Error("API 回傳的內容不是有效的 JSON：" + (text.slice(0, 80) + (text.length > 80 ? "…" : "")));
          }
          if (!cancelled) {
            console.log("Raw API data:", data);
            const apiRate = toNumberOrNull(data?.rate);
            setRate(apiRate);
            setCharacterImages(data?.characterImages && typeof data.characterImages === "object" ? data.characterImages : {});
            const rows = Array.isArray(data)
              ? data
              : Array.isArray(data?.products)
              ? data.products
              : Array.isArray(data?.data)
              ? data.data
              : [];
            const normalized = rows
              .map((row, idx) => normalizeItem(row, idx))
              .filter((x) => x && x.name);
            const onlyListed = normalized.filter(
              (x) => (x.status || "").trim() === "" || (x.status || "").trim().toLowerCase() === "上架"
            );
            try {
              const hiddenRaw = localStorage.getItem("maaru_admin_hidden_product_names");
              const hiddenNames = hiddenRaw ? JSON.parse(hiddenRaw) : [];
              const hiddenSet = new Set(Array.isArray(hiddenNames) ? hiddenNames.map((n) => String(n).trim()).filter(Boolean) : []);
              if (hiddenSet.size > 0) {
                setProducts(onlyListed.filter((x) => !hiddenSet.has((x.name || "").trim())));
              } else {
                setProducts(onlyListed);
              }
            } catch {
              setProducts(onlyListed);
            }
          }
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.warn("Fetch attempt failed:", url === API_URL_LOCAL ? "local /api" : url === API_URL ? "direct" : "via proxy", err);
        }
      }
      if (!cancelled) {
        if (lastError) {
          const msg =
            lastError?.message || "無法載入商品資料";
          const hint =
            window.location.hostname.includes("github.io") ||
            window.location.hostname === "localhost"
              ? " 若在 GitHub 上仍無法載入，請在 Google 試算表「擴充功能」→「Apps Script」的 doGet 回傳時加上 CORS 標頭（見專案說明）。"
              : "";
          setError(msg + hint);
        }
        setLoading(false);
      }
    }

    fetchDataRef.current = fetchData;
    fetchData();

    // 切回分頁時重新取得，顧客頁馬上依試算表新狀態顯示
    const onVisible = () => {
      if (document.visibilityState === "visible" && fetchDataRef.current) fetchDataRef.current(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    // 後台在同站另一分頁變更時，localStorage 會觸發此事件：隱藏名單、商品/庫存更新後顧客頁立即重抓
    const onStorage = (e) => {
      if (!fetchDataRef.current) return;
      if (e.key === "maaru_admin_hidden_product_names" || e.key === "maaru_products_updated") fetchDataRef.current(true);
    };
    window.addEventListener("storage", onStorage);

    // 每 5 秒輪詢一次（帶快取破壞參數），後台編輯庫存/上架下架後顧客頁會較快顯示最新
    const interval = setInterval(() => {
      if (fetchDataRef.current) fetchDataRef.current(true);
    }, 5000);

    return () => {
      cancelled = true;
      fetchDataRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);

  const refetch = React.useCallback(function refetchProducts() {
    if (fetchDataRef.current) fetchDataRef.current(true);
  }, []);

  return { products, rate, characterImages, loading, error, refetch };
}

function getUniqueProductsByName(products) {
  const seen = new Set();
  const result = [];
  for (const p of products) {
    if (!p?.name) continue;
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    result.push(p);
  }
  return result;
}

// 分類選單結構：主分類 + 子分類（與試算表 分類／子分類 對應，可展開/收合）
const CATEGORY_MENU = [
  {
    label: "絨毛玩偶",
    value: "絨毛玩偶",
    children: [
      { label: "玩偶公仔", value: "玩偶公仔" },
      { label: "吊飾娃", value: "吊飾娃" },
    ],
  },
  {
    label: "公仔玩具",
    value: "公仔玩具",
    children: [
      { label: "食玩盲盒", value: "食玩盲盒" },
      { label: "公仔吊飾", value: "公仔吊飾" },
    ],
  },
  {
    label: "包包時尚小物",
    value: "包包時尚小物",
    children: [
      { label: "托特包", value: "托特包" },
      { label: "肩包", value: "肩包" },
      { label: "後背包", value: "後背包" },
      { label: "購物環保袋", value: "購物環保袋" },
      { label: "皮夾", value: "皮夾" },
      { label: "零錢包", value: "零錢包" },
      { label: "票卡收納夾", value: "票卡收納夾" },
      { label: "化妝包", value: "化妝包" },
      { label: "多功能收納包", value: "多功能收納包" },
      { label: "束口袋", value: "束口袋" },
    ],
  },
  {
    label: "美妝用品",
    value: "美妝用品",
    children: [
      { label: "身體乳", value: "身體乳" },
      { label: "護手霜", value: "護手霜" },
      { label: "護唇膏", value: "護唇膏" },
      { label: "鏡子", value: "鏡子" },
      { label: "梳子", value: "梳子" },
      { label: "個人衛生用品", value: "個人衛生用品" },
      { label: "其他美妝用品", value: "其他美妝用品" },
    ],
  },
  {
    label: "飾品配件",
    value: "飾品配件",
    children: [
      { label: "飾品", value: "飾品" },
      { label: "髮飾", value: "髮飾" },
      { label: "眼鏡盒", value: "眼鏡盒" },
      { label: "手錶", value: "手錶" },
      { label: "其他時尚用品", value: "其他時尚用品" },
    ],
  },
  {
    label: "服飾專區",
    value: "服飾專區",
    children: [
      { label: "上衣", value: "上衣" },
      { label: "褲子", value: "褲子" },
      { label: "襪子", value: "襪子" },
    ],
  },
  {
    label: "文具用品",
    value: "文具用品",
    children: [
      { label: "年曆", value: "年曆" },
      { label: "手帳本", value: "手帳本" },
      { label: "原子筆", value: "原子筆" },
      { label: "鉛筆盒", value: "鉛筆盒" },
      { label: "筆袋", value: "筆袋" },
      { label: "筆記本", value: "筆記本" },
      { label: "活頁紙", value: "活頁紙" },
      { label: "貼紙", value: "貼紙" },
      { label: "紙膠帶", value: "紙膠帶" },
      { label: "文具收納相關", value: "文具收納相關" },
      { label: "辦公事務用品", value: "辦公事務用品" },
      { label: "明信片", value: "明信片" },
      { label: "其他文具用品", value: "其他文具用品" },
    ],
  },
  {
    label: "3C用品",
    value: "3C用品",
    children: [
      { label: "手機殼", value: "手機殼" },
      { label: "充電線", value: "充電線" },
      { label: "行動電源", value: "行動電源" },
      { label: "其他3C周邊用品", value: "其他3C周邊用品" },
    ],
  },
  {
    label: "居家生活",
    value: "居家生活",
    children: [
      { label: "抱枕", value: "抱枕" },
      { label: "靠枕", value: "靠枕" },
      { label: "毛毯", value: "毛毯" },
      { label: "室內鞋", value: "室內鞋" },
      { label: "居家清潔用品", value: "居家清潔用品" },
      { label: "收納用品", value: "收納用品" },
      { label: "擺飾小物", value: "擺飾小物" },
    ],
  },
  {
    label: "兒童專區",
    value: "兒童專區",
    children: [
      { label: "便當盒", value: "便當盒" },
      { label: "水壺", value: "水壺" },
      { label: "手帕", value: "手帕" },
      { label: "小方巾", value: "小方巾" },
      { label: "襪子", value: "襪子" },
      { label: "兒童小包", value: "兒童小包" },
    ],
  },
  {
    label: "廚房用品",
    value: "廚房用品",
    children: [
      { label: "環保餐具", value: "環保餐具" },
      { label: "便當盒", value: "便當盒" },
      { label: "水壺", value: "水壺" },
      { label: "馬克杯", value: "馬克杯" },
      { label: "餐具收納", value: "餐具收納" },
      { label: "料理用具", value: "料理用具" },
      { label: "廚房收納", value: "廚房收納" },
      { label: "其他廚房用品", value: "其他廚房用品" },
    ],
  },
  {
    label: "浴室用品",
    value: "浴室用品",
    children: [
      { label: "浴巾", value: "浴巾" },
      { label: "毛巾", value: "毛巾" },
      { label: "小方巾", value: "小方巾" },
      { label: "衛浴用品", value: "衛浴用品" },
      { label: "衛浴收納", value: "衛浴收納" },
      { label: "洗衣袋", value: "洗衣袋" },
      { label: "其他浴室用品", value: "其他浴室用品" },
    ],
  },
  {
    label: "旅行用品",
    value: "旅行用品",
    children: [
      { label: "行李吊牌", value: "行李吊牌" },
      { label: "行李箱束帶", value: "行李箱束帶" },
      { label: "護照套", value: "護照套" },
      { label: "旅行收納", value: "旅行收納" },
    ],
  },
  {
    label: "戶外用品",
    value: "戶外用品",
    children: [
      { label: "雨傘", value: "雨傘" },
      { label: "雨具", value: "雨具" },
      { label: "其他戶外用品", value: "其他戶外用品" },
    ],
  },
];

// 商品款式角色（點擊後列出該角色所有商品）
const CHARACTER_LIST = [
  { value: "", label: "全部" },
  { value: "凱蒂貓", label: "凱蒂貓" },
  { value: "美樂蒂", label: "美樂蒂" },
  { value: "酷洛米", label: "酷洛米" },
  { value: "大耳狗", label: "大耳狗" },
  { value: "布丁狗", label: "布丁狗" },
  { value: "帕恰狗", label: "帕恰狗" },
  { value: "雙子星", label: "雙子星" },
  { value: "山姆企鵝", label: "山姆企鵝" },
  { value: "人魚漢頓", label: "人魚漢頓" },
  { value: "貝克鴨", label: "貝克鴨" },
  { value: "可樂鈴", label: "可樂鈴" },
  { value: "小麥粉", label: "小麥粉" },
  { value: "兔媽媽", label: "兔媽媽" },
  { value: "蛋黃哥", label: "蛋黃哥" },
  { value: "花丸幽靈", label: "花丸幽靈" },
  { value: "丹尼爾", label: "丹尼爾" },
];

// 店舗內分類：與 CATEGORY_MENU／試算表 分類・子分類 對應（字串為單一項目，{ label, children } 為有子選單的項目）
const STORE_CATEGORIES = [
  "全商品一覧",
  "新上架商品",
  "HOT預購商品",
  { label: "絨毛玩偶", children: ["玩偶公仔", "吊飾娃"] },
  { label: "公仔玩具", children: ["食玩盲盒", "公仔吊飾"] },
  { label: "包包時尚小物", children: ["托特包", "肩包", "後背包", "購物環保袋", "皮夾", "零錢包", "票卡收納夾", "化妝包", "多功能收納包", "束口袋"] },
  { label: "美妝用品", children: ["身體乳", "護手霜", "護唇膏", "鏡子", "梳子", "個人衛生用品", "其他美妝用品"] },
  { label: "飾品配件", children: ["飾品", "髮飾", "眼鏡盒", "手錶", "其他時尚用品"] },
  { label: "服飾專區", children: ["上衣", "褲子", "襪子"] },
  { label: "文具用品", children: ["年曆", "手帳本", "原子筆", "鉛筆盒", "筆袋", "筆記本", "活頁紙", "貼紙", "紙膠帶", "文具收納相關", "辦公事務用品", "明信片", "其他文具用品"] },
  { label: "3C用品", children: ["手機殼", "充電線", "行動電源", "其他3C周邊用品"] },
  { label: "居家生活", children: ["抱枕", "靠枕", "毛毯", "室內鞋", "居家清潔用品", "收納用品", "擺飾小物"] },
  { label: "兒童專區", children: ["便當盒", "水壺", "手帕", "小方巾", "襪子", "兒童小包"] },
  { label: "廚房用品", children: ["環保餐具", "便當盒", "水壺", "馬克杯", "餐具收納", "料理用具", "廚房收納", "其他廚房用品"] },
  { label: "浴室用品", children: ["浴巾", "毛巾", "小方巾", "衛浴用品", "衛浴收納", "洗衣袋", "其他浴室用品"] },
  { label: "旅行用品", children: ["行李吊牌", "行李箱束帶", "護照套", "旅行收納"] },
  { label: "戶外用品", children: ["雨傘", "雨具", "其他戶外用品"] },
  "使用者指南",
];

function CategorySidebar({ open, onClose, searchKeyword, onSearchChange, onNavigate, selectedCharacter = "", characterImages = {} }) {
  const searchRef = React.useRef(null);
  const characterCarouselRef = React.useRef(null);
  const [expandedStoreKey, setExpandedStoreKey] = React.useState(null);

  React.useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  function scrollCharacterCarousel(direction) {
    if (!characterCarouselRef.current) return;
    const step = 80;
    characterCarouselRef.current.scrollBy({ left: direction === "left" ? -step : step, behavior: "smooth" });
  }

  const storeCategoryClass =
    "flex items-center justify-between w-full py-3.5 px-4 text-left text-sm text-slate-900 hover:bg-slate-50 transition-colors border-b border-slate-100";

  return (
    <>
      {/* 遮罩：點擊任意處可關閉（手機友善：加大可點擊、避免誤觸滑動） */}
      <div
        className={[
          "fixed inset-0 z-30 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div
          className="absolute inset-0 bg-slate-900/20 min-w-full min-h-full cursor-pointer"
          onClick={onClose}
          aria-label="點擊關閉選單"
        />
      </div>
      <aside
        className={[
          "fixed left-0 top-0 z-40 h-full w-[300px] max-w-[90vw] bg-white shadow-xl border-r border-slate-200",
          "flex flex-col transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        aria-label="商品分類選單"
      >
        {/* Header：右側品牌名（關閉請點擊遮罩或底部「關閉選單」） */}
        <div className="flex items-center justify-end p-4 border-b border-slate-200 shrink-0">
          <span className="text-sm font-semibold text-slate-900 tracking-wide uppercase">MENU</span>
        </div>

        <div className="flex-1 overflow-auto">
          {/* 搜尋欄：放大鏡在輸入關鍵字框左邊 */}
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white focus-within:ring-1 focus-within:ring-slate-300 focus-within:border-slate-300">
              <button
                type="button"
                onClick={() => searchRef.current && searchRef.current.focus()}
                className="shrink-0 w-9 h-9 flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-l-md transition-colors"
                aria-label="搜尋"
              >
                🔍
              </button>
              <input
                ref={searchRef}
                type="text"
                value={searchKeyword}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="輸入關鍵字"
                className="flex-1 min-w-0 py-2.5 pr-3 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none border-0"
              />
            </div>
          </div>

          {/* 所有角色：圓形可左右滑動，點擊列出該角色所有商品 */}
          <div className="px-4 pt-2 pb-4">
            <p className="text-xs font-semibold text-slate-500 tracking-wider mb-3 text-center">
              所有角色
            </p>
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => scrollCharacterCarousel("left")}
                className="shrink-0 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 absolute left-0 z-10 shadow-sm"
                aria-label="往左"
              >
                ‹
              </button>
              <div
                ref={characterCarouselRef}
                className="flex gap-3 overflow-x-auto scroll-smooth scrollbar-hide py-2 px-10"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {CHARACTER_LIST.map((char) => {
                  const isSelected = (char.value || "").trim() === (selectedCharacter || "").trim();
                  const imageUrl = (characterImages[char.value] || (char.label && characterImages[char.label])) || null;
                  return (
                    <button
                      key={char.value || "all"}
                      type="button"
                      onClick={() => {
                        if ((char.value || "").trim())
                          onNavigate("/?character=" + encodeURIComponent(char.value));
                        else
                          onNavigate("/");
                        onClose();
                      }}
                      className={[
                        "shrink-0 flex flex-col items-center gap-1.5 transition-colors",
                        isSelected ? "opacity-100" : "opacity-90 hover:opacity-100",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "w-12 h-12 rounded-full flex items-center justify-center text-slate-700 text-sm font-medium border-2 transition-colors overflow-hidden bg-slate-100",
                          isSelected
                            ? "bg-slate-200 border-slate-400 ring-2 ring-slate-300"
                            : "border-slate-200 group-hover:bg-slate-200",
                        ].join(" ")}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={char.label}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          char.label.slice(0, 1)
                        )}
                      </span>
                      <span className="text-[10px] text-slate-600 text-center max-w-[48px] leading-tight">
                        {char.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => scrollCharacterCarousel("right")}
                className="shrink-0 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 absolute right-0 z-10 shadow-sm"
                aria-label="往右"
              >
                ›
              </button>
            </div>
          </div>

          {/* 分類：依序主分類 + 子分類（對應試算表 分類／子分類） */}
          <div className="border-t border-slate-200 pt-2">
            <p className="px-4 text-xs font-semibold text-slate-500 tracking-wider mb-1">
              商品分類
            </p>
            <nav className="py-1">
              <div className="border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => { onNavigate("/"); onClose(); }}
                  className={storeCategoryClass}
                  title="顯示所有上架商品"
                >
                  <span>全部</span>
                  <span className="text-slate-400">›</span>
                </button>
              </div>
              <div className="border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => { onNavigate("/?newToday=1"); onClose(); }}
                  className={storeCategoryClass}
                  title="顯示今天上架的商品"
                >
                  <span>今日上架</span>
                  <span className="text-slate-400">›</span>
                </button>
              </div>
              {CATEGORY_MENU.map((item) => {
                const label = item.label;
                const value = item.value;
                const children = item.children || [];
                const isExpanded = expandedStoreKey === value;

                if (children.length > 0) {
                  return (
                    <div key={value} className="border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => setExpandedStoreKey(isExpanded ? null : value)}
                        className={storeCategoryClass}
                      >
                        <span>{label}</span>
                        <span className={["text-slate-400 transition-transform duration-200", isExpanded ? "rotate-90" : ""].join(" ")}>›</span>
                      </button>
                      {isExpanded ? (
                        <div className="py-2 px-3 bg-slate-50/60 border-l-2 border-rose-200 ml-2 mr-2 mb-2 rounded-r-lg space-y-0.5">
                          {children.map((sub) => (
                            <button
                              key={sub.value}
                              type="button"
                              onClick={() => {
                                onNavigate("/?category=" + encodeURIComponent(value) + "&subcategory=" + encodeURIComponent(sub.value));
                                onClose();
                              }}
                              className="flex items-center gap-2 w-full py-2 px-3 rounded-md text-sm text-slate-600 hover:text-rose-700 hover:bg-white hover:shadow-sm transition-all duration-150 text-left"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-300 shrink-0" aria-hidden />
                              <span className="flex-1">{sub.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div key={value} className="border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("/?category=" + encodeURIComponent(value));
                        onClose();
                      }}
                      className={storeCategoryClass}
                    >
                      <span>{label}</span>
                      <span className="text-slate-400">›</span>
                    </button>
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
        {/* 底部關閉鈕：手機較好點，拇指可及 */}
        <div className="shrink-0 border-t border-slate-200 p-4 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] py-3 rounded-xl bg-slate-100 text-slate-700 font-medium text-sm active:bg-slate-200 transition-colors"
            aria-label="關閉選單"
          >
            關閉選單
          </button>
        </div>
      </aside>
    </>
  );
}

function Navbar({ cartCount, onOpenCart, onOpenMenu, onLogoClick }) {
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex justify-start items-center gap-2">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-slate-200 bg-white hover:border-slate-900 transition-colors focus:outline-none focus:ring-0"
            aria-label="開啟分類選單"
          >
            <span className="text-lg leading-none">☰</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onLogoClick}
          className="flex items-center space-x-2 sm:space-x-3 justify-center rounded-2xl px-2 py-1.5 sm:px-3 sm:py-2 transition-all duration-300 focus:outline-none focus:ring-0 hover:bg-white/60 hover:backdrop-blur-md hover:shadow-lg hover:shadow-slate-300/40 hover:border hover:border-white/70 active:scale-[0.98]"
          aria-label="回首頁並重新整理"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-slate-900 flex items-center justify-center shrink-0 ring-2 ring-transparent hover:ring-white/50 transition-shadow duration-300">
            <img
              src="./品牌logo_tondiv.jpg"
              alt="Maaru 品牌 Logo"
              className="w-full h-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex flex-col leading-tight text-left">
            <span className="text-sm sm:text-base font-semibold tracking-[0.2em] uppercase text-slate-900">
              Maaru
            </span>
            <span className="text-xs sm:text-sm text-slate-500 tracking-[0.15em] uppercase">
              Select Shop
            </span>
          </div>
        </button>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onOpenCart}
            className="relative inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-slate-200 bg-white hover:border-slate-900 transition-colors focus:outline-none focus:ring-0"
            aria-label="開啟購物車"
          >
            <span className="text-base sm:text-lg">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-slate-900 text-white text-[10px] leading-5 text-center flex items-center justify-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function StockTag({ value, size = "sm" }) {
  if (!value || !String(value).trim()) return null;
  const v = String(value).trim();
  const isPreorder = v === "預購";
  const isStock = v === "現貨";
  const base = size === "md" ? "text-xs px-2.5 py-1" : "text-[11px] px-2 py-0.5";
  const styles = isPreorder
    ? "bg-violet-100 text-violet-800 border border-violet-200"
    : isStock
      ? "bg-amber-100 text-amber-800 border border-amber-200"
      : "bg-slate-100 text-slate-700 border border-slate-200";
  return (
    <span className={"inline-block rounded-md font-medium " + base + " " + styles}>
      {v}
    </span>
  );
}

function ProductCard({ product, rate }) {
  const twd = getDisplayPrice(product, rate);

  const encodedName = encodeURIComponent(product.name);

  return (
    <Link
      to={`/product/${encodedName}`}
      className="product-card group block bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-slate-900 transition-colors duration-200"
    >
      <div className="scan-target relative aspect-square bg-slate-100 overflow-hidden">
        {(product.image || (product.variantImages && product.variantImages[0])) ? (
          <img
            src={product.image || (product.variantImages && product.variantImages[0]) || ""}
            alt={product.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            No Image
          </div>
        )}

        {(product.isHot || product.isRecommended || product.isNew || product.isNewListing || product.character) ? (
          <div className="absolute top-3 left-3 flex flex-wrap gap-1">
            {product.isHot ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-rose-600 text-white shadow-sm">
                熱銷
              </span>
            ) : null}
            {product.isRecommended ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-600 text-white shadow-sm">
                推薦
              </span>
            ) : null}
            {product.isNewListing ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500 text-white shadow-sm">
                新上架
              </span>
            ) : null}
            {product.isNew ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-600 text-white shadow-sm">
                新品
              </span>
            ) : null}
            {product.character ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-slate-600 text-white shadow-sm">
                {product.character}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="p-4 space-y-1">
        <h2 className="text-sm font-medium text-slate-900 line-clamp-2">
          {product.name}
        </h2>
        {(product.stockType || product.raw?.貨況 || product.raw?.stockType || product.raw?.現貨預購) ? (
          <p className="pt-0.5">
            <StockTag value={String(product.stockType || product.raw?.貨況 || product.raw?.stockType || product.raw?.現貨預購 || "").trim()} size="sm" />
          </p>
        ) : null}
        <div className="pt-1">
          {twd ? (
            <p className="text-sm text-slate-900">{twd}</p>
          ) : (
            <p className="text-sm text-slate-500">價格請洽詢</p>
          )}
        </div>
      </div>
    </Link>
  );
}

function parseSearchParams(searchString) {
  if (!searchString || !searchString.startsWith("?")) return {};
  try {
    return Object.fromEntries(new URLSearchParams(searchString));
  } catch {
    return {};
  }
}

function HomePage({ products, rate, loading, error, search: routeSearch, searchKeyword = "", onSearchChange, onNavigateHome }) {
  const CATEGORY_KEY = "maarushop_home_category_v1";
  const SORT_KEY = "maarushop_home_sort_v1";
  const params = React.useMemo(() => parseSearchParams(routeSearch || ""), [routeSearch]);
  const categoryFromUrl = params.category ?? null;
  const subcategoryFromUrl = params.subcategory ?? null;
  const characterFromUrl = params.character ?? null;
  const newTodayFromUrl = params.newToday === "1" || params.newToday === "true";

  const [selectedCategory, setSelectedCategory] = React.useState(() => {
    if (categoryFromUrl) return categoryFromUrl;
    try {
      return localStorage.getItem(CATEGORY_KEY) || "ALL";
    } catch {
      return "ALL";
    }
  });

  const [selectedSubcategory, setSelectedSubcategory] = React.useState(subcategoryFromUrl || "");

  // 當網址列上的 category / subcategory 改變時，同步到 state（點「全部」時網址無 category，故選分類還原為全部）
  React.useEffect(() => {
    if (newTodayFromUrl) {
      setSelectedCategory("ALL");
      return;
    }
    if (categoryFromUrl != null && categoryFromUrl !== "") {
      setSelectedCategory(categoryFromUrl);
    } else {
      setSelectedCategory("ALL");
    }
  }, [categoryFromUrl, newTodayFromUrl]);
  React.useEffect(() => {
    setSelectedSubcategory(subcategoryFromUrl || "");
  }, [subcategoryFromUrl]);

  const [sortMode, setSortMode] = React.useState(() => {
    try {
      return localStorage.getItem(SORT_KEY) || "none";
    } catch {
      return "none";
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(CATEGORY_KEY, selectedCategory);
    } catch {
      // ignore
    }
  }, [selectedCategory]);

  React.useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sortMode);
    } catch {
      // ignore
    }
  }, [sortMode]);

  const categories = React.useMemo(() => {
    const set = new Set();
    for (const p of products) {
      const c = (p?.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [products]);

  // If category disappears after data refresh, reset to ALL
  React.useEffect(() => {
    if (selectedCategory === "ALL") return;
    if (categories.includes(selectedCategory)) return;
    setSelectedCategory("ALL");
  }, [categories, selectedCategory]);

  // 商品規格（規格）是否包含指定角色名稱（用於左側角色篩選）
  const productVariantMatchesCharacter = React.useCallback((p, characterName) => {
    const raw = (p?.variant ?? p?.規格 ?? p?.raw?.規格 ?? p?.raw?.variant ?? "").toString().trim();
    if (!raw || !characterName) return false;
    const parts = raw.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    return parts.some((part) => part === characterName);
  }, []);

  const filteredProducts = React.useMemo(() => {
    const q = (searchKeyword || "").trim().toLowerCase();
    // products 已僅含「上架」商品；點「全部」時無 category/subcategory/character，顯示全部
    let result = products;

    // 左側欄「今日上架」：只顯示上架日期為今天的商品
    if (newTodayFromUrl) {
      result = result.filter((p) =>
        isPublishedToday(p?.publishedAt ?? p?.上架日期 ?? p?.上架時間 ?? p?.raw?.上架日期 ?? p?.raw?.publishedAt)
      );
      return result;
    }

    // 左側欄放大鏡搜尋：依「商品名稱」或「規格」篩選，顯示所有分類中符合的商品
    if (q) {
      result = result.filter((p) => {
        const name = (p?.name ?? p?.商品名稱 ?? p?.raw?.商品名稱 ?? "").toString().toLowerCase();
        const variant = (p?.variant ?? p?.規格 ?? p?.raw?.規格 ?? p?.raw?.variant ?? "").toString().toLowerCase();
        return name.includes(q) || variant.includes(q);
      });
      if (characterFromUrl) {
        const charFilter = (characterFromUrl || "").trim();
        result = result.filter((p) => productVariantMatchesCharacter(p, charFilter));
      }
      return result;
    }

    // 左側欄選子分類：依商品卡的「分類」＋「子分類」顯示
    if (selectedCategory !== "ALL") {
      result = result.filter(
        (p) => (p?.category ?? p?.分類 ?? "").toString().trim() === selectedCategory
      );
    }
    if (subcategoryFromUrl) {
      result = result.filter(
        (p) => (p?.subcategory ?? p?.子分類 ?? "").toString().trim() === subcategoryFromUrl
      );
    }

    // 左側欄選角色：依商品卡的「規格」顯示（規格包含該角色名稱即符合）
    if (characterFromUrl) {
      const charFilter = (characterFromUrl || "").trim();
      result = result.filter((p) => productVariantMatchesCharacter(p, charFilter));
    }
    return result;
  }, [products, selectedCategory, subcategoryFromUrl, characterFromUrl, searchKeyword, newTodayFromUrl, productVariantMatchesCharacter]);

  // 取得用於排序的數字價格（與顧客頁顯示一致：優先台幣售價，否則日幣）
  const getSortPrice = React.useCallback((p) => {
    const twd = toNumberOrNull(p?.sellingPrice ?? p?.售價 ?? p?.台幣售價);
    if (twd != null) return twd;
    return toNumberOrNull(p?.price ?? p?.日幣價格 ?? p?.價格 ?? p?.售價JPY);
  }, []);

  const uniqueProducts = React.useMemo(() => {
    const base = getUniqueProductsByName(filteredProducts);
    if (sortMode === "none") return base;

    const arr = base.slice();
    arr.sort((a, b) => {
      const pa = getSortPrice(a);
      const pb = getSortPrice(b);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return sortMode === "price_asc" ? pa - pb : pb - pa;
    });
    return arr;
  }, [filteredProducts, sortMode, getSortPrice]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {!loading && !error && (
        <div className="mb-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
            <div className="sm:text-right">
              <label className="block mb-1 text-xs font-semibold text-slate-800 tracking-[0.25em] uppercase">
                Sort
              </label>
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSortMode("none")}
                  className={[
                    "px-3 py-1 rounded-full",
                    sortMode === "none"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  預設
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("price_asc")}
                  className={[
                    "px-3 py-1 rounded-full",
                    sortMode === "price_asc"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  價格 低→高
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("price_desc")}
                  className={[
                    "px-3 py-1 rounded-full",
                    sortMode === "price_desc"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                >
                  價格 高→低
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="flex flex-col items-center space-y-3 text-slate-500 text-sm">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            <span>載入商品中...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          <p className="font-medium mb-1">載入失敗</p>
          <p className="mb-1">{error}</p>
          <p className="text-xs text-red-500">
            請稍後重試，並在瀏覽器主控台查看錯誤訊息。
          </p>
        </div>
      )}

      {!loading && !error && newTodayFromUrl && uniqueProducts.length > 0 && (
        <p className="mb-4 text-sm font-medium text-slate-700">
          今日上架商品
        </p>
      )}

      {!loading && !error && uniqueProducts.length === 0 && (
        <div className="text-center text-sm text-slate-500 space-y-1">
          <p>目前沒有可顯示的商品。</p>
          {newTodayFromUrl ? (
            <p className="text-xs">今日尚無上架商品，請試算表「上架日期」填寫今天日期（YYYY-MM-DD）並儲存。</p>
          ) : characterFromUrl ? (
            <p className="text-xs">
              篩選角色「{characterFromUrl}」：依商品「規格」顯示，試算表「規格」欄需包含該名稱（如 酷洛米,大耳狗 即含酷洛米）。
            </p>
          ) : null}
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
        {uniqueProducts.map((p) => (
          <ProductCard key={p.id || p.name} product={p} rate={rate} />
        ))}
      </section>
    </main>
  );
}

// 試算表「規格」欄：多個規格用逗號分隔（單欄「凱蒂貓,美樂,布丁狗」或分欄 規格1/2/3）→ 顧客頁會顯示為多個選項
function splitVariantString(variantStr) {
  if (variantStr == null || variantStr === "") return [];
  const s = String(variantStr).trim();
  if (!s) return [];
  // 依「逗號、頓號、分號、空白、換行」任一或多個拆分，支援單欄「凱蒂貓, 美樂, 布丁狗」與分欄合併後的字串
  const sep = /[,，、;；\s\n\r\uFF0C\u3000\u00A0]+/;
  let parts = s.split(sep).map((part) => part.trim()).filter(Boolean);
  // 若只得到一筆但內容裡還有分隔符，再拆一次
  if (parts.length === 1 && sep.test(parts[0])) {
    parts = parts[0].split(sep).map((p) => p.trim()).filter(Boolean);
  }
  return parts;
}

function ProductDetailPage({ products, rate, encodedName, onAddToCart }) {
  const decodedName = decodeURIComponent(encodedName || "");

  const baseGroup = React.useMemo(() => {
    return products.filter((p) => p.name === decodedName);
  }, [products, decodedName]);

  const group = React.useMemo(() => {
    if (!baseGroup.length) return [];
    const p0 = baseGroup[0];
    const allParts = [];
    const seen = new Set();
    for (const p of baseGroup) {
      const rawV = p.variant ?? p.規格 ?? "";
      const variantStr = Array.isArray(rawV)
        ? rawV.map((v) => String(v).trim()).filter(Boolean).join(",")
        : String(rawV || "");
      const parts = splitVariantString(variantStr);
      for (const part of parts) {
        if (part && !seen.has(part)) {
          seen.add(part);
          allParts.push(part);
        }
      }
    }
    const toQty = (v) => (v !== undefined && v !== null && v !== "") ? (typeof v === "number" ? Math.max(0, v) : Math.max(0, parseInt(String(v).trim(), 10) || 0)) : null;
    let stockList = Array.isArray(p0.variantStock) ? p0.variantStock.map(toQty) : (typeof (p0.variantStock || p0.raw?.variantStock || p0.raw?.規格庫存) === "string" ? (p0.variantStock || p0.raw?.variantStock || p0.raw?.規格庫存 || "").split(/[,，、\s]+/).map((s) => toQty(s)) : []);
    if (stockList.length === 0) {
      let mainStock = getProductStockNumber(p0);
      if (mainStock == null && baseGroup.length > 1) {
        for (let i = 1; i < baseGroup.length; i++) {
          mainStock = getProductStockNumber(baseGroup[i]);
          if (mainStock != null) break;
        }
      }
      if (mainStock != null) stockList = [mainStock];
    }
    if (allParts.length > 1 && baseGroup.length > 1) {
      stockList = allParts.map((part) => {
        const row = baseGroup.find((p) => {
          const v = p.variant ?? p.規格 ?? "";
          const str = Array.isArray(v) ? v.join(",") : String(v || "").trim();
          if (str === part) return true;
          const partsOfRow = splitVariantString(str);
          return partsOfRow.indexOf(part) >= 0;
        });
        return row != null ? getProductStockNumber(row) : null;
      });
      for (let i = 0; i < stockList.length; i++) {
        if (stockList[i] == null) stockList[i] = getProductStockNumber(p0) ?? stockList[0] ?? null;
      }
    }
    if (allParts.length === 0) {
      const rawV = p0.variant ?? p0.規格 ?? "";
      const v = Array.isArray(rawV) ? rawV.join(",") : String(rawV || "").trim();
      const qty = stockList[0] != null ? stockList[0] : getProductStockNumber(p0);
      return [{ ...p0, variant: v || "單一規格", sku: [p0.name, v || "單一規格", p0.price ?? ""].join("||"), variantStockQty: qty }];
    }
    if (allParts.length === 1) {
      const qty = stockList[0] != null ? stockList[0] : getProductStockNumber(p0);
      return [{ ...p0, variant: allParts[0], sku: [p0.name, allParts[0], p0.price ?? ""].join("||"), variantStockQty: qty }];
    }
    const variantImgList =
      p0.variantImages && Array.isArray(p0.variantImages)
        ? p0.variantImages
        : typeof p0.variantImages === "string"
          ? splitVariantString(p0.variantImages)
          : [];
    return allParts.map((part, i) => {
      const variantImage =
        variantImgList[i] && String(variantImgList[i]).trim()
          ? variantImgList[i]
          : p0.image;
      const stock = stockList[i] != null ? stockList[i] : (getProductStockNumber(p0) ?? stockList[0] ?? null);
      return {
        ...p0,
        variant: part,
        image: variantImage || p0.image,
        sku: [p0.name, part, p0.price ?? ""].join("||"),
        variantStockQty: stock,
      };
    });
  }, [baseGroup]);

  if (!decodedName) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8">
        <button
          onClick={() => history.back()}
          className="inline-flex items-center gap-1.5 text-xs mb-4 px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:border-slate-900 hover:text-slate-900 bg-white shadow-sm transition-colors"
        >
          <span className="text-sm">←</span>
          <span>返回列表</span>
        </button>
        <p className="text-sm text-slate-500">找不到此商品。</p>
      </main>
    );
  }

  const mainProduct = group[0];
  const [selectedSku, setSelectedSku] = React.useState(null);

  React.useEffect(() => {
    if (!group?.length) return;
    setSelectedSku((prev) => {
      if (prev && group.some((g) => g.sku === prev)) return prev;
      return group[0].sku;
    });
  }, [decodedName, group?.length]);

  const selectedItem = React.useMemo(() => {
    if (!group?.length) return null;
    if (!selectedSku) return group[0];
    return group.find((g) => g.sku === selectedSku) || group[0];
  }, [group, selectedSku]);

  // 主圖依選中的規格自動切換該規格圖片
  const displayImage =
    selectedItem?.image ||
    mainProduct?.image ||
    (mainProduct?.variantImages && mainProduct.variantImages[0]) ||
    "";

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <button
        onClick={() => history.back()}
        className="inline-flex items-center gap-1.5 text-xs mb-4 px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:border-slate-900 hover:text-slate-900 bg-white shadow-sm transition-colors"
      >
        <span className="text-sm">←</span>
        <span>返回列表</span>
      </button>

      {!mainProduct ? (
        <p className="text-sm text-slate-500">找不到此商品。</p>
      ) : (
        <div className="grid gap-8 md:grid-cols-[1.1fr,0.9fr]">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="aspect-square bg-slate-100">
              {displayImage ? (
                <img
                  key={selectedItem?.sku || "main"}
                  src={displayImage}
                  alt={mainProduct.name + (selectedItem?.variant ? " " + selectedItem.variant : "")}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                  No Image
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="text-lg font-semibold tracking-tight">
              {mainProduct.name}
            </h1>

            {(mainProduct.character || selectedItem?.character) ? (
              <p className="text-sm text-slate-500">
                角色：{mainProduct.character || selectedItem?.character}
              </p>
            ) : null}

            {(mainProduct.stockType || selectedItem?.stockType || mainProduct.raw?.貨況 || selectedItem?.raw?.貨況) ? (
              <p className="pt-0.5">
                <StockTag value={String(mainProduct.stockType || selectedItem?.stockType || mainProduct.raw?.貨況 || selectedItem?.raw?.貨況 || "").trim()} size="sm" />
              </p>
            ) : null}

            {(selectedItem?.price != null || selectedItem?.sellingPrice != null) ? (
              <div className="space-y-0.5">
                {getDisplayPrice(selectedItem, rate) ? (
                  <p className="text-base text-slate-900">
                    {getDisplayPrice(selectedItem, rate)}
                  </p>
                ) : (
                  <p className="text-base text-slate-500">價格請洽詢</p>
                )}
              </div>
            ) : null}

            {mainProduct.description && (
              <p className="text-sm text-slate-600 whitespace-pre-line">
                {mainProduct.description}
              </p>
            )}

            {(selectedItem?.introduction || mainProduct?.introduction) ? (
              <div className="pt-2">
                <h2 className="text-xs font-medium text-slate-500 tracking-[0.2em] uppercase mb-2">
                  商品介紹
                </h2>
                <div className="text-sm text-slate-700 whitespace-pre-line bg-white rounded-2xl border border-slate-200 p-4">
                  {selectedItem?.introduction || mainProduct?.introduction}
                </div>
              </div>
            ) : null}

            <div className="mt-2 space-y-3">
              {group.length >= 1 ? (
                <div>
                  <h2 className="text-xs font-medium text-slate-500 tracking-[0.2em] uppercase mb-2">
                    規格
                  </h2>
                  <div className="space-y-2">
                    {group.map((item, index) => {
                      const label =
                        item.variant || (group.length === 1 ? "單一規格" : `款式 ${index + 1}`);
                      const isSoldOut = item.variantStockQty !== undefined && item.variantStockQty !== null && item.variantStockQty === 0;
                      return (
                        <label
                          key={item.sku || item.id || index}
                          className={[
                            "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
                            isSoldOut ? "cursor-not-allowed opacity-70 bg-slate-50 border-slate-200" : "cursor-pointer",
                            selectedSku === item.sku && !isSoldOut
                              ? "border-slate-900 bg-slate-50"
                              : selectedSku === item.sku && isSoldOut
                                ? "border-slate-300 bg-slate-100"
                                : !isSoldOut
                                  ? "border-slate-200 bg-white hover:border-slate-900"
                                  : "border-slate-200 bg-white",
                          ].join(" ")}
                        >
                          <span className="flex items-center gap-2 text-sm text-slate-700 min-w-0 flex-1">
                            <input
                              type="radio"
                              name="variant"
                              checked={selectedSku === item.sku}
                              onChange={() => !isSoldOut && setSelectedSku(item.sku)}
                              disabled={isSoldOut}
                            />
                            {item.image ? (
                              <span className="w-8 h-8 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
                                <img
                                  src={item.image}
                                  alt={label}
                                  className="w-full h-full object-contain"
                                  loading="lazy"
                                />
                              </span>
                            ) : null}
                            <span className="inline-block text-left" style={{ writingMode: "horizontal-tb" }}>{label}</span>
                            {isSoldOut ? (
                              <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">已售完</span>
                            ) : null}
                          </span>
                          <span className="text-xs text-slate-500 shrink-0 w-16 text-center">
                            {item.variantStockQty !== undefined && item.variantStockQty !== null
                              ? `庫存 ${item.variantStockQty}`
                              : "庫存 -"}
                          </span>
                          <span className="text-xs text-slate-500 shrink-0">
                            {getDisplayPrice(item, rate) || ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(() => {
                const selectedSoldOut = selectedItem && selectedItem.variantStockQty !== undefined && selectedItem.variantStockQty !== null && selectedItem.variantStockQty === 0;
                return (
                  <button
                    type="button"
                    onClick={() => selectedItem && !selectedSoldOut && onAddToCart(selectedItem, 1)}
                    disabled={!selectedItem || selectedSoldOut}
                    className="w-full rounded-xl bg-slate-900 text-white text-sm py-3 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {selectedSoldOut ? "已售完" : "加入購物車"}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CartDrawer({
  open,
  onClose,
  items,
  products = [],
  rate,
  onInc,
  onDec,
  onRemove,
  onClear,
}) {
  const [copyState, setCopyState] = React.useState({ status: "idle", message: "" });

  function getEffectiveItem(it) {
    const key = it.key || [it.name, it.variant || "", it.price ?? ""].join("||");
    let fromList = products.find(
      (p) => (p.sku || [p.name, p.variant || "", p.price ?? ""].join("||")) === key
    );
    if (!fromList) {
      fromList = products.find(
        (p) =>
          (p.name || "") === (it.name || "") &&
          (p.variant || "") === (it.variant || "")
      );
    }
    if (!fromList) return it;
    return {
      ...it,
      price: it.price ?? fromList.price ?? it.price,
      sellingPrice: it.sellingPrice ?? fromList.sellingPrice,
    };
  }

  function getMaxStock(it) {
    const key = it.key || [it.name, it.variant || "", it.price ?? ""].join("||");
    let p = products.find(
      (x) => (x.sku || [x.name, x.variant || "", x.price ?? ""].join("||")) === key
    );
    if (!p) {
      p = products.find(
        (x) => (x.name || "") === (it.name || "") && (x.variant || "") === (it.variant || "")
      );
    }
    return p ? (p.variantStockQty ?? getProductStockNumber(p) ?? null) : null;
  }

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setCopyState({ status: "idle", message: "" });
  }, [open]);

  const totalTWD = React.useMemo(() => {
    return items.reduce(
      (sum, it) =>
        sum +
        (getUnitTWD(getEffectiveItem(it), rate) ?? 0) * (Number(it.qty) || 0),
      0
    );
  }, [items, products, rate]);

  function buildCheckoutText() {
    const lines = [];
    lines.push("MAARU 日本萌GO代購登記清單：");
    lines.push("");

    for (const it of items) {
      const name = (it.name || "").trim();
      const variant = (it.variant || "").trim();
      const qty = Number(it.qty || 0);
      const unitTWD = getUnitTWD(getEffectiveItem(it), rate);
      const lineName = variant ? `${name} ${variant}` : name;
      const lineTWD = unitTWD != null ? unitTWD * qty : null;

      if (lineTWD != null) {
        lines.push(`${lineName} × ${qty}  NT$${Math.round(lineTWD).toLocaleString("zh-TW")}`);
      } else {
        lines.push(`${lineName} × ${qty}  NT$—`);
      }
    }

    lines.push("");
    if (totalTWD != null && Number.isFinite(totalTWD)) {
      lines.push(`商品總計：NT$${Math.round(totalTWD).toLocaleString("zh-TW")}`);
    } else {
      lines.push(`商品總計：NT$—`);
    }
    lines.push("");

    return lines.join("\n");
  }

  async function copyCheckoutText() {
    if (!items.length) return;
    const text = buildCheckoutText();

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy_failed");
      }

      setCopyState({
        status: "success",
        message: "已複製完成，請直接回傳到官方LINE登記建立訂單",
      });
    } catch (e) {
      setCopyState({
        status: "error",
        message: "複製失敗，請改用手動選取文字。",
      });
      console.error("Copy failed:", e);
    }
  }

  return (
    <div
      className={[
        "fixed inset-0 z-40",
        open ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      aria-hidden={!open}
    >
      <div
        className={[
          "absolute inset-0 bg-black/30 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        ].join(" ")}
        onClick={onClose}
      />
      <aside
        className={[
          "absolute right-0 top-0 h-full w-full max-w-md bg-white border-l border-slate-200",
          "transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="h-full flex flex-col">
          <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold tracking-[0.15em] uppercase">
                Cart
              </p>
              <p className="text-xs text-slate-500">{items.length} 項</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full border border-slate-200 hover:border-slate-900"
              aria-label="關閉購物車"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">購物車目前是空的。</p>
            ) : (
              items.map((it) => (
                <div
                  key={it.key}
                  className="flex gap-3 rounded-2xl border border-slate-200 p-3"
                >
                  <div className="w-16 h-20 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0">
                    {it.image ? (
                      <img
                        src={it.image}
                        alt={it.name}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{it.name}</p>
                    {it.variant ? (
                      <p className="text-xs text-slate-500 mt-0.5">{it.variant}</p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-600">
                        {(() => {
                          const unitTWD = getUnitTWD(getEffectiveItem(it), rate);
                          const qty = Number(it.qty || 0);
                          const lineTWD = unitTWD != null ? unitTWD * qty : null;
                          const twdText =
                            lineTWD != null
                              ? `NT$${Math.round(lineTWD).toLocaleString("zh-TW")}`
                              : null;
                          return (
                            <div className="space-y-0.5">
                              {twdText ? (
                                <div>{twdText}</div>
                              ) : (
                                <div className="text-slate-500">價格請洽詢</div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onDec(it.key)}
                          className="w-8 h-8 rounded-full border border-slate-200 hover:border-slate-900"
                          aria-label="減少數量"
                        >
                          −
                        </button>
                        <span className="text-sm w-6 text-center">{it.qty}</span>
                        {(() => {
                          const maxStock = it.maxStock ?? getMaxStock(it);
                          const atMax = maxStock != null && (Number(it.qty) || 0) >= maxStock;
                          return (
                            <button
                              type="button"
                              onClick={() => !atMax && onInc(it.key)}
                              disabled={atMax}
                              className="w-8 h-8 rounded-full border border-slate-200 hover:border-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200"
                              aria-label="增加數量"
                              title={atMax ? "已達庫存上限 " + maxStock : "增加數量"}
                            >
                              +
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => onRemove(it.key)}
                          className="text-xs text-slate-500 hover:text-slate-900 ml-1"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-4 border-t border-slate-200 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 tracking-[0.2em] uppercase">
                  Total
                </p>
                <p className="text-base font-semibold">
                  {totalTWD != null && Number.isFinite(totalTWD)
                    ? "NT$" + Math.round(totalTWD).toLocaleString("zh-TW")
                    : "—"}
                </p>
              </div>
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  清空
                </button>
              ) : null}
            </div>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={copyCheckoutText}
              className="w-full rounded-xl bg-slate-900 text-white text-sm py-3 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              複製登記文字
            </button>
            {copyState.status !== "idle" ? (
              <p
                className={[
                  "text-xs",
                  copyState.status === "success" ? "text-slate-600" : "text-red-600",
                ].join(" ")}
              >
                {copyState.message}
              </p>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function NotFoundPage() {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <p className="text-sm text-slate-500">頁面不存在，請回到首頁。</p>
      <Link to="/" className="inline-block mt-3 text-xs text-slate-900 underline">
        回首頁
      </Link>
    </main>
  );
}

function App() {
  const { products, rate, characterImages, loading, error, refetch } = useProducts();
  const path = useHashPath();
  const route = React.useMemo(() => getRoute(path), [path]);

  const CART_KEY = "maarushop_cart_v1";
  const [cartOpen, setCartOpen] = React.useState(false);
  const [cartItems, setCartItems] = React.useState(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    } catch {
      // ignore
    }
  }, [cartItems]);

  const cartCount = React.useMemo(() => {
    return cartItems.reduce((sum, it) => sum + (it.qty || 0), 0);
  }, [cartItems]);

  function addToCart(product, qty) {
    const key = product.sku || [product.name, product.variant || "", product.price ?? ""].join("||");
    const maxStock = product.variantStockQty ?? getProductStockNumber(product) ?? null;
    const addQty = Math.max(1, Number(qty || 1));
    setCartItems((prev) => {
      const idx = prev.findIndex((x) => x.key === key);
      if (idx >= 0) {
        const copy = prev.slice();
        const cur = copy[idx];
        const newQty = Math.min((cur.qty || 0) + addQty, maxStock != null ? maxStock : Infinity);
        copy[idx] = { ...cur, qty: newQty, maxStock: maxStock != null ? maxStock : cur.maxStock };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          name: product.name,
          variant: product.variant || "",
          price: product.price,
          sellingPrice: product.sellingPrice,
          image: product.image || "",
          qty: Math.min(addQty, maxStock != null ? maxStock : addQty),
          maxStock: maxStock,
        },
      ];
    });
    setCartOpen(true);
  }

  function incItem(key) {
    setCartItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const max = it.maxStock != null ? it.maxStock : Infinity;
        if ((it.qty || 0) >= max) return it;
        return { ...it, qty: (it.qty || 0) + 1 };
      })
    );
  }

  function decItem(key) {
    setCartItems((prev) =>
      prev
        .map((it) => (it.key === key ? { ...it, qty: it.qty - 1 } : it))
        .filter((it) => it.qty > 0)
    );
  }

  function removeItem(key) {
    setCartItems((prev) => prev.filter((it) => it.key !== key));
  }

  function clearCart() {
    setCartItems([]);
  }

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sidebarSearch, setSidebarSearch] = React.useState("");
  const handleMenuNavigate = (path) => {
    let full = path;
    const q = sidebarSearch.trim();
    if (q) full += (path.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(q);
    navigateTo(full);
  };

  const homeParams = React.useMemo(() => parseSearchParams(route.search || ""), [route.search]);

  // 從網址 ?q= 同步到左側搜尋（例如從連結開啟時）
  React.useEffect(() => {
    if (route.name !== "home") return;
    if (homeParams.q != null) setSidebarSearch(homeParams.q);
  }, [route.name, homeParams.q]);

  let page = null;
  if (route.name === "home") {
    page = (
      <HomePage
        products={products}
        rate={rate}
        loading={loading}
        error={error}
        search={route.search}
        searchKeyword={sidebarSearch}
        onSearchChange={setSidebarSearch}
        onNavigateHome={navigateTo}
      />
    );
  } else if (route.name === "product") {
    page = (
      <ProductDetailPage
        products={products}
        rate={rate}
        encodedName={route.encodedName}
        onAddToCart={addToCart}
      />
    );
  } else {
    page = <NotFoundPage />;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
        onLogoClick={() => {
          window.location.hash = "#/";
          window.location.reload();
        }}
      />
      <CategorySidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        searchKeyword={sidebarSearch}
        onSearchChange={setSidebarSearch}
        onNavigate={handleMenuNavigate}
        selectedCharacter={homeParams.character || ""}
        characterImages={characterImages}
      />
      {page}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
        products={products}
        rate={rate}
        onInc={incItem}
        onDec={decItem}
        onRemove={removeItem}
        onClear={clearCart}
      />
    </div>
  );
}

const rootEl = document.getElementById("root");
const root = ReactDOM.createRoot(rootEl);
root.render(<App />);


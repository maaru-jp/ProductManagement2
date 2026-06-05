const SHOP_BRAND_NAME = "MAARU 日本萌GO";
const SHOP_BRAND_TAGLINE = "日本周邊 · 藥妝代購";

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
  if (pathname === "/points") return { name: "points", search };
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

/** 只保留純數字 token，過濾日期（2026-03-07）等非庫存文字 */
function sanitizeVariantStockString(raw) {
  if (raw == null || String(raw).trim() === "") return "";
  const parts = String(raw).trim().split(/[,，、\s]+/);
  return parts.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).join(", ");
}

/** 從試算表 raw 列正規化庫存（與後台 Code.gs 邏輯一致） */
function normalizeStockFromRaw(row) {
  if (!row || typeof row !== "object") {
    return { variantStock: [], stock: null };
  }
  const rawVs = row.variantStock ?? row.規格庫存 ?? row["規格庫存"] ?? "";
  const cleanVs = sanitizeVariantStockString(rawVs);
  let variantStock = parseVariantStockStrict(cleanVs);
  let mainStockNum =
    toNumberOrNull(row.stock) ??
    toNumberOrNull(row.Stock) ??
    toNumberOrNull(row.庫存) ??
    toNumberOrNull(row["庫存"]) ??
    toNumberOrNull(row["庫存數量"]);
  if (mainStockNum == null) {
    for (const k of Object.keys(row)) {
      if ((/^stock$/i.test(k) || (k.includes("庫存") && !k.includes("規格"))) && row[k] !== "" && row[k] != null) {
        const n = toNumberOrNull(row[k]);
        if (n != null) {
          mainStockNum = n;
          break;
        }
      }
    }
  }
  if (variantStock.length === 0 && mainStockNum !== null && mainStockNum !== undefined) {
    variantStock = [Math.max(0, mainStockNum)];
  }
  const stock =
    variantStock.length > 0
      ? variantStock.reduce((a, b) => a + b, 0)
      : mainStockNum;
  return { variantStock, stock };
}

/** 依規格名稱取得該規格的庫存數量 */
function getVariantStockQty(product, variantPart) {
  if (!product) return null;
  const variantStr =
    product.variant ??
    product.raw?.variant ??
    product.raw?.規格 ??
    "";
  const parts = splitVariantString(
    Array.isArray(variantStr) ? variantStr.join(",") : String(variantStr || "")
  );
  const stocks = Array.isArray(product.variantStock)
    ? product.variantStock.map((n) => Math.max(0, Number(n) || 0))
    : parseVariantStockStrict(
        product.variantStock ??
          product.raw?.variantStock ??
          product.raw?.規格庫存 ??
          ""
      );
  if (variantPart && parts.length > 1) {
    const idx = parts.findIndex((p) => p === variantPart || p.trim() === String(variantPart).trim());
    if (idx >= 0 && stocks[idx] != null) return stocks[idx];
  }
  if (stocks.length === 1) return stocks[0];
  if (stocks.length > 1) {
    if (variantPart) {
      const idx = parts.indexOf(variantPart);
      if (idx >= 0 && stocks[idx] != null) return stocks[idx];
    }
    return stocks.reduce((a, b) => a + b, 0);
  }
  return getProductStockNumber(product);
}

function findProductForCartItem(products, item) {
  if (!item || !Array.isArray(products)) return null;
  const key = item.key || [item.name, item.variant || "", item.price ?? ""].join("||");
  let p = products.find(
    (x) => (x.sku || [x.name, x.variant || "", x.price ?? ""].join("||")) === key
  );
  if (p) return p;
  const variant = (item.variant || "").trim();
  p = products.find((x) => {
    if ((x.name || "") !== (item.name || "")) return false;
    if (!variant) return true;
    const parts = splitVariantString(x.variant ?? x.raw?.variant ?? x.raw?.規格 ?? "");
    return parts.includes(variant) || String(x.variant || "").trim() === variant;
  });
  if (p) return p;
  return products.find((x) => (x.name || "") === (item.name || "")) || null;
}

function resolveMaxStockForCartItem(item, products) {
  const p = findProductForCartItem(products, item);
  if (!p) return item.maxStock != null ? item.maxStock : null;
  return getVariantStockQty(p, item.variant || "");
}

function buildProductsFetchUrl(baseUrl, bust) {
  const sep = baseUrl.indexOf("?") >= 0 ? "&" : "?";
  return baseUrl + sep + "_t=" + bust + "&_r=" + Math.random().toString(36).slice(2, 11);
}

function productsStockFingerprint(list) {
  return (list || [])
    .map((p) => {
      const vs = Array.isArray(p.variantStock) ? p.variantStock.join("+") : String(p.variantStock ?? "");
      return [p.name, p.variant, p.stock, vs, p.status].join("|");
    })
    .join(";;");
}

/** 只解析純數字的規格庫存 token，避免「2025年03月」被誤算 */
function parseVariantStockStrict(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  const parts = Array.isArray(raw)
    ? raw.map((x) => String(x).trim())
    : String(raw).trim().split(/[,，、\s]+/).map((s) => s.trim());
  return parts.filter((s) => /^\d+$/.test(s)).map((s) => Math.max(0, parseInt(s, 10)));
}

function parseVariantPriceList(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  const parts = Array.isArray(raw)
    ? raw.map((x) => String(x).trim())
    : String(raw).trim().split(/[,，、\s]+/).map((s) => s.trim());
  return parts.map((s) => {
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  });
}

function resolveVariantUnitPrice_(product, variantPrice) {
  if (variantPrice != null && Number.isFinite(variantPrice)) {
    return variantPrice;
  }
  const customerPrice = toNumberOrNull(product?.customerDisplayPrice);
  if (customerPrice != null) return customerPrice;
  const twd = toNumberOrNull(product?.sellingPrice);
  if (twd != null) return twd;
  return null;
}

/** 從商品或 raw 取得單一庫存數字（含 0），沒資料回傳 null；供顧客頁穩定顯示庫存用 */
function getProductStockNumber(p) {
  if (!p || typeof p !== "object") return null;
  const tryVal = (val) => {
    if (val === undefined || val === null || val === "") return null;
    const n = typeof val === "number" ? val : parseInt(String(val).trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  const rawVariantStock = p.variantStock ?? p.規格庫存 ?? p["規格庫存"] ?? p.raw?.variantStock ?? p.raw?.規格庫存 ?? p.raw?.["規格庫存"];
  const variantNums = parseVariantStockStrict(rawVariantStock);
  if (variantNums.length > 0) return variantNums.reduce((a, b) => a + b, 0);
  const direct =
    tryVal(p.stock) ?? tryVal(p.Stock) ?? tryVal(p.庫存) ?? tryVal(p["庫存"]) ?? tryVal(p["庫存數量"]) ??
    tryVal(p.raw?.stock) ?? tryVal(p.raw?.Stock) ?? tryVal(p.raw?.庫存) ?? tryVal(p.raw?.["庫存"]) ?? tryVal(p.raw?.["庫存數量"]) ?? tryVal(p.raw?.Stock);
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
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** 上架日距今幾天（本地日期；上架當天 = 0） */
function daysSinceLocalDate(dateValue) {
  const d = parseDateOrNull(dateValue);
  if (!d) return null;
  const today = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/** 新上架視窗：上架後 7 日內（第 0～6 天）顯示，第 7 天起自動移除 */
const NEW_LISTING_DAYS = 7;

function isNewListingWithinDays(dateValue, windowDays = NEW_LISTING_DAYS) {
  const days = daysSinceLocalDate(dateValue);
  if (days == null) return false;
  if (days < 0) return true;
  return days < windowDays;
}

function isWithinLastDays(dateValue, days) {
  return isNewListingWithinDays(dateValue, days);
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

const LOYALTY_NAME_KEY = "maarushop_loyalty_name_v1";

function getApiBaseUrl() {
  return isLocalDev ? API_URL_LOCAL : API_URL;
}

function buildPointsBalanceUrl(customerName) {
  const base = getApiBaseUrl();
  const sep = base.indexOf("?") >= 0 ? "&" : "?";
  const q =
    "action=points_balance&name=" +
    encodeURIComponent(String(customerName || "").trim()) +
    "&_t=" +
    Date.now();
  return base + sep + q;
}

async function fetchPointsBalance(customerName) {
  const directUrl = buildPointsBalanceUrl(customerName);
  const urlsToTry = [directUrl];
  if (!isLocalDev) {
    urlsToTry.push(CORS_PROXY_PREFIX + encodeURIComponent(directUrl));
  }
  let lastError = null;
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (text.trimStart().startsWith("<")) {
        throw new Error("API 回傳 HTML，請確認 Code.gs 已重新部署");
      }
      const data = JSON.parse(text);
      if (data && data.error) throw new Error(data.message || "查詢失敗");
      return data;
    } catch (err) {
      lastError = err;
      console.warn("Points balance fetch failed:", url, err);
    }
  }
  throw lastError || new Error("無法連線查詢紅利");
}

function normalizeLoyaltyCustomerName(name) {
  return String(name || "").trim().replace(/\s+/g, "");
}

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
  const stockNorm = normalizeStockFromRaw(row);
  let variantStock = stockNorm.variantStock;
  const stock = stockNorm.stock;
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
  const rawVariantPrices =
    row.variantPrices ?? row.規格售價 ?? row["規格售價"] ?? row["規格台幣售價"] ?? "";
  const variantPrices =
    rawVariantPrices != null && String(rawVariantPrices).trim() !== ""
      ? String(rawVariantPrices).trim()
      : "";
  const variantDim1Label = (row.variantDim1Label ?? row["規格維度1名稱"] ?? "").toString().trim();
  const variantDim1Options = (row.variantDim1Options ?? row["規格維度1選項"] ?? "").toString().trim();
  const variantDim2Label = (row.variantDim2Label ?? row["規格維度2名稱"] ?? "").toString().trim();
  const variantDim2Options = (row.variantDim2Options ?? row["規格維度2選項"] ?? "").toString().trim();
  const category = row.category ?? row.分類 ?? "";
  const subcategory = row.subcategory ?? row.子分類 ?? "";
  const character = row.character ?? row.角色 ?? row.角色名稱 ?? "";
  const stockType = (row.stockType ?? row.貨況 ?? row["貨況"] ?? row.現貨預購 ?? row["現貨預購"] ?? row["現貨/預購"] ?? "").toString().trim();
  const status = (row.status ?? row.狀態 ?? "上架").toString().trim() || "上架";
  const isHot = toBoolFlag(row.hot ?? row.熱銷);
  const isRecommended = toBoolFlag(row.recommended ?? row.推薦);
  const publishedAt = row.publishedAt ?? row.上架日期 ?? row.上架時間 ?? null;
  const isNewByFlag = toBoolFlag(row.isNew ?? row.新品);
  const isNewListing = isNewListingWithinDays(publishedAt, NEW_LISTING_DAYS);
  const isNew = isNewByFlag || isNewListing;

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
    variantPrices,
    variantDim1Label,
    variantDim1Options,
    variantDim2Label,
    variantDim2Options,
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
  const [lastSyncedAt, setLastSyncedAt] = React.useState(null);

  const fetchDataRef = React.useRef(null);
  const prevServerTimeRef = React.useRef(null);
  const prevNonceRef = React.useRef(null);
  const staleRetryRef = React.useRef(0);
  const productsFingerprintRef = React.useRef("");

  React.useEffect(() => {
    let cancelled = false;

    async function applyProductsPayload(data, silent) {
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
      const onlyListed = normalized.filter((x) => {
        const s = (x.status ?? x.狀態 ?? "").toString().trim();
        return s !== "下架";
      });
      let finalList = onlyListed;
      try {
        const hiddenRaw = localStorage.getItem("maaru_admin_hidden_product_names");
        const hiddenNames = hiddenRaw ? JSON.parse(hiddenRaw) : [];
        const hiddenSet = new Set(Array.isArray(hiddenNames) ? hiddenNames.map((n) => String(n).trim()).filter(Boolean) : []);
        if (hiddenSet.size > 0) {
          finalList = onlyListed.filter((x) => !hiddenSet.has((x.name || "").trim()));
        }
      } catch {
        finalList = onlyListed;
      }
      const fp = productsStockFingerprint(finalList);
      if (fp !== productsFingerprintRef.current || !silent) {
        productsFingerprintRef.current = fp;
        setProducts(finalList.map((p) => ({ ...p })));
      }
      setLastSyncedAt(Date.now());
    }

    async function fetchData(silent = false, allowProxy = !silent) {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      let lastError = null;
      const bust = Date.now();
      const directUrl = buildProductsFetchUrl(isLocalDev ? API_URL_LOCAL : API_URL, bust);
      const urlsToTry = [];
      if (isLocalDev) urlsToTry.push(buildProductsFetchUrl(API_URL_LOCAL, bust + 1));
      urlsToTry.push(directUrl);
      if (allowProxy) {
        urlsToTry.push(CORS_PROXY_PREFIX + encodeURIComponent(directUrl));
      }

      for (const url of urlsToTry) {
        if (cancelled) break;
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const text = await res.text();
          const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
          if (text.trimStart().startsWith("<") || contentType.includes("text/html")) {
            throw new Error(
              "API 回傳了 HTML 而非 JSON，請確認試算表已部署為「網頁應用程式」且「誰可以存取」選「任何人」。"
            );
          }
          let data;
          try {
            data = JSON.parse(text);
          } catch (parseErr) {
            throw new Error("API 回傳的內容不是有效的 JSON：" + (text.slice(0, 80) + (text.length > 80 ? "…" : "")));
          }

          const serverTime = data?.serverTime;
          const nonce = data?.nonce;
          const looksCached =
            silent &&
            serverTime != null &&
            nonce != null &&
            productsFingerprintRef.current &&
            prevServerTimeRef.current === serverTime &&
            prevNonceRef.current === nonce;

          if (looksCached) {
            if (staleRetryRef.current < 3 && fetchDataRef.current) {
              staleRetryRef.current += 1;
              setTimeout(() => fetchDataRef.current(true, false), 600 + staleRetryRef.current * 400);
            }
            lastError = null;
            break;
          }

          staleRetryRef.current = 0;
          if (serverTime != null) prevServerTimeRef.current = serverTime;
          if (nonce != null) prevNonceRef.current = nonce;

          if (!cancelled) {
            await applyProductsPayload(data, silent);
          }
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.warn("Fetch attempt failed:", url, err);
        }
      }

      if (!cancelled) {
        if (lastError) {
          const msg = lastError?.message || "無法載入商品資料";
          const hint =
            window.location.hostname.includes("github.io") || window.location.hostname === "localhost"
              ? " 若在 GitHub 上仍無法載入，請確認 Apps Script 已重新部署。"
              : "";
          if (!silent) setError(msg + hint);
        }
        setLoading(false);
      }
    }

    fetchDataRef.current = fetchData;
    fetchData(false, true);

    const onVisible = () => {
      if (document.visibilityState === "visible" && fetchDataRef.current) fetchDataRef.current(true, false);
    };
    document.addEventListener("visibilitychange", onVisible);

    const onStorage = (e) => {
      if (!fetchDataRef.current) return;
      if (e.key === "maaru_admin_hidden_product_names" || e.key === "maaru_products_updated") {
        fetchDataRef.current(true, false);
      }
    };
    window.addEventListener("storage", onStorage);

    const onFocus = () => {
      if (fetchDataRef.current) fetchDataRef.current(true, false);
    };
    window.addEventListener("focus", onFocus);

    const interval = setInterval(() => {
      if (fetchDataRef.current) fetchDataRef.current(true, false);
    }, 3000);

    return () => {
      cancelled = true;
      fetchDataRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, []);

  const refetch = React.useCallback(function refetchProducts() {
    if (fetchDataRef.current) fetchDataRef.current(true, false);
  }, []);

  return { products, rate, characterImages, loading, error, refetch, lastSyncedAt };
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
    label: "預購商品",
    value: "預購商品",
    children: [
      { label: "2026年03月", value: "2026年03月" },
    ],
  },
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

function subcategorySortKey(label) {
  const normalized = normalizeSubcategoryLabel(label);
  const m = normalized.match(/^(\d{4})年(\d{1,2})月$/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  return null;
}

/** 月份子分類統一為 YYYY年MM月，避免 4月 / 04月 對不上 */
function normalizeSubcategoryLabel(label) {
  const t = String(label ?? "").trim();
  const m = t.match(/^(\d{4})年(\d{1,2})月$/);
  if (m) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) {
      return `${m[1]}年${String(month).padStart(2, "0")}月`;
    }
  }
  return t;
}

function subcategoriesMatch(a, b) {
  return normalizeSubcategoryLabel(a) === normalizeSubcategoryLabel(b);
}

function sortSubcategoryLabels(labels) {
  return labels.slice().sort((a, b) => {
    const pa = subcategorySortKey(a);
    const pb = subcategorySortKey(b);
    if (pa != null && pb != null) return pb - pa;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return a.localeCompare(b, "zh-Hant");
  });
}

/** 合併試算表子分類，新增月份無需再改程式 */
function buildCategoryMenu(products) {
  const subsByCategory = new Map();
  for (const p of products || []) {
    const cat = (p?.category ?? p?.分類 ?? "").toString().trim();
    const sub = normalizeSubcategoryLabel(p?.subcategory ?? p?.子分類 ?? "");
    if (!cat || !sub) continue;
    if (!subsByCategory.has(cat)) subsByCategory.set(cat, new Set());
    subsByCategory.get(cat).add(sub);
  }

  return CATEGORY_MENU.map((item) => {
    const staticSubs = (item.children || [])
      .map((c) => (typeof c === "string" ? c : c.value || c.label || ""))
      .filter(Boolean);
    const fromProducts = subsByCategory.has(item.value)
      ? Array.from(subsByCategory.get(item.value))
      : [];
    const merged = sortSubcategoryLabels(Array.from(new Set([...staticSubs, ...fromProducts])));
    if (!merged.length) return { ...item, children: item.children || [] };
    return {
      ...item,
      children: merged.map((v) => ({ label: v, value: v })),
    };
  });
}

function getKnownCategoryValues() {
  return CATEGORY_MENU.map((item) => item.value).filter(Boolean);
}

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
  { label: "預購商品", children: ["2026年03月"] },
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

function CategorySidebar({ open, onClose, searchKeyword, onSearchChange, onNavigate, selectedCharacter = "", characterImages = {}, products = [] }) {
  const searchRef = React.useRef(null);
  const characterCarouselRef = React.useRef(null);
  const [expandedStoreKey, setExpandedStoreKey] = React.useState(null);
  const menu = React.useMemo(() => buildCategoryMenu(products), [products]);

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
              {menu.map((item) => {
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
                        <span className="flex items-center gap-1.5">
                          <span>{label}</span>
                          {value === "預購商品" ? (
                            <span className="sidebar-hot-badge" role="status" aria-label="熱門預購">
                              Hot
                            </span>
                          ) : null}
                        </span>
                        <span className={["text-slate-400 transition-transform duration-200", isExpanded ? "rotate-90" : ""].join(" ")}>›</span>
                      </button>
                      {isExpanded ? (
                        <div className="py-2 px-3 bg-neutral-50 border-l-2 border-neutral-300 ml-2 mr-2 mb-2 rounded-r-md space-y-0.5">
                          {children.map((sub) => (
                            <button
                              key={sub.value}
                              type="button"
                              onClick={() => {
                                onNavigate("/?category=" + encodeURIComponent(value) + "&subcategory=" + encodeURIComponent(sub.value));
                                onClose();
                              }}
                              className="flex items-center gap-2 w-full py-2 px-3 rounded-md text-sm text-neutral-600 hover:text-neutral-900 hover:bg-white transition-colors text-left"
                            >
                              <span className="w-1 h-1 rounded-full bg-neutral-400 shrink-0" aria-hidden />
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

const CAROUSEL_STORAGE_KEY = "maaru_shop_carousel_v1";

function parseCarouselConfig(raw) {
  if (!raw || typeof raw !== "object" || raw.enabled === false) return null;
  const images = (Array.isArray(raw.images) ? raw.images : [])
    .map((item) => {
      if (typeof item === "string") {
        const s = item.trim();
        return s ? { url: s, link: "" } : null;
      }
      if (item && typeof item === "object") {
        const url = String(item.url || "").trim();
        if (!url) return null;
        return { url, link: String(item.link || "").trim() };
      }
      return null;
    })
    .filter(Boolean);
  if (!images.length) return null;
  const sec = Number(raw.intervalSec);
  const intervalMs = Math.max(2000, Math.min(30000, (Number.isFinite(sec) && sec > 0 ? sec : 5) * 1000));
  return { slides: images, intervalMs };
}

function readCarouselConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAROUSEL_STORAGE_KEY) || "null");
    return parseCarouselConfig(raw);
  } catch {
    return null;
  }
}

function useHomeCarousel() {
  const [config, setConfig] = React.useState(() => readCarouselConfig());

  React.useEffect(() => {
    function refresh() {
      setConfig(readCarouselConfig());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return config;
}

function HomeCarousel({ slides, intervalMs = 5000 }) {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const count = slides ? slides.length : 0;

  React.useEffect(() => {
    setIndex(0);
  }, [count]);

  React.useEffect(() => {
    if (count <= 1 || paused) return undefined;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, intervalMs, paused]);

  if (!slides || count === 0) return null;

  function handleSlideClick(e, link) {
    if (!link) return;
    const trimmed = link.trim();
    if (!trimmed) return;
    if (/^https?:\/\//i.test(trimmed)) return;
    e.preventDefault();
    const path = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    navigateTo(path.startsWith("/") ? path : "/" + path);
  }

  function goTo(i) {
    if (i < 0 || i >= count) return;
    setIndex(i);
  }

  return (
    <section
      className="shop-carousel mb-6"
      aria-label="首頁輪播"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="shop-carousel-frame relative aspect-[2/1] sm:aspect-[2.4/1] rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200">
        {slides.map((slide, i) => {
          const isActive = i === index;
          const imgEl = (
            <img
              src={slide.url}
              alt=""
              className="w-full h-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
            />
          );
          return (
            <div
              key={slide.url + "-" + i}
              className={"shop-carousel-slide" + (isActive ? " is-active" : "")}
              aria-hidden={!isActive}
            >
              {slide.link ? (
                /^https?:\/\//i.test(slide.link) ? (
                  <a href={slide.link} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                    {imgEl}
                  </a>
                ) : (
                  <a
                    href={slide.link.startsWith("#") ? slide.link : "#" + slide.link.replace(/^\/?/, "/")}
                    className="block w-full h-full"
                    onClick={(e) => handleSlideClick(e, slide.link)}
                  >
                    {imgEl}
                  </a>
                )
              ) : (
                imgEl
              )}
            </div>
          );
        })}

        {count > 1 ? (
          <>
            <button
              type="button"
              className="shop-carousel-nav shop-carousel-nav-prev"
              onClick={() => goTo((index - 1 + count) % count)}
              aria-label="上一張"
            >
              ‹
            </button>
            <button
              type="button"
              className="shop-carousel-nav shop-carousel-nav-next"
              onClick={() => goTo((index + 1) % count)}
              aria-label="下一張"
            >
              ›
            </button>
            <div className="shop-carousel-dots">
              {slides.map((slide, i) => (
                <button
                  key={"dot-" + i}
                  type="button"
                  className={"shop-carousel-dot" + (i === index ? " is-active" : "")}
                  onClick={() => goTo(i)}
                  aria-label={"第 " + (i + 1) + " 張"}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Navbar({ cartCount, onOpenCart, onOpenMenu, onLogoClick, searchKeyword, onSearchChange, loyaltyBalance }) {
  return (
    <header className="shop-header sticky top-0 z-20 border-b border-neutral-200/80">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenMenu}
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-neutral-100/80 transition-colors"
            aria-label="開啟分類選單"
          >
            <svg className="w-5 h-5 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <button
            type="button"
            onClick={onLogoClick}
            className="shop-logo-btn flex items-center gap-3 min-w-0 focus:outline-none text-left"
            aria-label={SHOP_BRAND_NAME + " 回首頁"}
          >
            <div className="shop-logo-glass shrink-0">
              <img src="./品牌logo_tondiv.jpg" alt={SHOP_BRAND_NAME} className="shop-logo-img" loading="lazy" />
            </div>
            <div className="min-w-0">
              <span id="shopBrandName" className="block text-xs sm:text-base font-semibold tracking-tight text-neutral-900 leading-tight whitespace-nowrap">
                {SHOP_BRAND_NAME}
              </span>
              <span className="hidden sm:block text-[11px] text-neutral-500 leading-tight mt-0.5">
                {SHOP_BRAND_TAGLINE}
              </span>
            </div>
          </button>
        </div>

        <div className="flex-1 min-w-0 max-w-lg mx-auto">
          <div className="flex items-center rounded-md border border-neutral-200 bg-white px-3 py-2 gap-2 focus-within:border-neutral-400 transition-colors">
            <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input
              type="search"
              value={searchKeyword || ""}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              placeholder="搜尋商品或規格"
              className="shop-header-search flex-1 min-w-0 bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 border-0 focus:ring-0 p-0"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 shrink-0">
          <Link
            to="/points"
            className="relative inline-flex items-center justify-center gap-1 min-w-[2.25rem] h-9 px-2 rounded-md hover:bg-amber-50 text-amber-800 transition-colors"
            aria-label="我的紅利點數"
            title="我的紅利點數"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {loyaltyBalance != null && loyaltyBalance > 0 ? (
              <span className="text-[11px] font-semibold leading-none">{loyaltyBalance > 99 ? "99+" : loyaltyBalance}</span>
            ) : (
              <span className="hidden sm:inline text-[11px] font-medium leading-none">點數</span>
            )}
          </Link>
          <button
            type="button"
            onClick={onOpenCart}
            className="relative inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-neutral-100 transition-colors"
            aria-label="開啟購物車"
          >
            <svg className="w-5 h-5 text-neutral-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
            {cartCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-sm bg-neutral-800 text-white text-[10px] leading-4 text-center font-medium">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}

function PromoBanner({ onDismiss, visible }) {
  if (!visible) return null;
  return (
    <div className="shop-promo-bar border-b border-neutral-700/20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        <p className="text-xs sm:text-sm text-white/95 leading-relaxed">
          <span className="font-medium">日本卡通周邊 · 藥妝代購</span>
          <span className="hidden sm:inline text-white/75"> — 加入購物車後複製登記清單，回傳 LINE 即可完成登記</span>
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-white/80 hover:text-white px-2 py-1 rounded transition-colors"
          aria-label="關閉提示"
        >
          關閉
        </button>
      </div>
    </div>
  );
}

function ShopSidebar({ products, activeCategory, activeSubcategory, newTodayActive, onNavigate }) {
  const [expandedKey, setExpandedKey] = React.useState(activeCategory || null);
  const menu = React.useMemo(() => buildCategoryMenu(products), [products]);

  React.useEffect(() => {
    if (activeCategory) setExpandedKey(activeCategory);
  }, [activeCategory]);

  function navClass(isActive) {
    return [
      "flex items-center gap-1.5 w-full py-2 px-2 rounded-md text-left text-sm transition-colors",
      isActive ? "shop-sidebar-item-active" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50",
    ].join(" ");
  }

  function renderCategoryLabel(item) {
    return (
      <>
        <span>{item.label}</span>
        {item.value === "預購商品" ? (
          <span className="sidebar-hot-badge" role="status" aria-label="熱門預購">
            Hot
          </span>
        ) : null}
      </>
    );
  }

  return (
    <aside className="hidden lg:block w-44 xl:w-48 shrink-0 pr-8 pt-1 pb-8 border-r border-neutral-200" aria-label="商品分類">
      <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3 px-2">分類</p>
      <nav className="space-y-0.5 sticky top-24">
        <button
          type="button"
          onClick={() => onNavigate("/?newToday=1")}
          className={navClass(!!newTodayActive)}
        >
          新上架
        </button>
        <button
          type="button"
          onClick={() => onNavigate("/")}
          className={navClass(!newTodayActive && activeCategory === "ALL" && !activeSubcategory)}
        >
          全部商品
        </button>
        {menu.map((item) => {
          const isActive = activeCategory === item.value && !newTodayActive;
          const isExpanded = expandedKey === item.value;
          const hasChildren = item.children && item.children.length > 0;

          if (hasChildren) {
            return (
              <div key={item.value}>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedKey(isExpanded ? null : item.value);
                    onNavigate("/?category=" + encodeURIComponent(item.value));
                  }}
                  className={navClass(isActive && !activeSubcategory)}
                >
                  {renderCategoryLabel(item)}
                </button>
                {isExpanded ? (
                  <div className="ml-2 pl-2 border-l border-neutral-200 space-y-0.5 mt-0.5 mb-1">
                    {item.children.map((sub) => (
                      <button
                        key={sub.value}
                        type="button"
                        onClick={() => onNavigate("/?category=" + encodeURIComponent(item.value) + "&subcategory=" + encodeURIComponent(sub.value))}
                        className={[
                          "block w-full text-left py-1.5 px-2 rounded-md text-xs",
                          subcategoriesMatch(activeSubcategory, sub.value) ? "text-neutral-900 font-medium bg-neutral-100" : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50",
                        ].join(" ")}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onNavigate("/?category=" + encodeURIComponent(item.value))}
              className={navClass(isActive)}
            >
              {renderCategoryLabel(item)}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function NewListingBadge({ size = "card" }) {
  const sizeClass = size === "detail" ? "new-listing-badge--detail" : "new-listing-badge--card";
  return (
    <span className={"new-listing-badge " + sizeClass} role="status">
      新上架
    </span>
  );
}

function StockTag({ value, size = "sm", overlay = false }) {
  if (!value || !String(value).trim()) return null;
  const v = String(value).trim();
  const isStock = v === "現貨";
  const isPreorder = v === "預購";
  const variant = isStock ? "instock" : isPreorder ? "preorder" : "default";
  const label = isStock ? "現貨" : isPreorder ? "預購" : v;

  return (
    <span
      className={[
        "stock-tag",
        size === "md" ? "stock-tag--md" : "stock-tag--sm",
        "stock-tag--" + variant,
        overlay ? "stock-tag--overlay" : "",
      ].join(" ")}
    >
      <span className="stock-tag__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function ProductCard({ product, rate, wishlist, onToggleWishlist }) {
  const twd = getDisplayPrice(product, rate);
  const encodedName = encodeURIComponent(product.name);
  const productKey = product.id || product.name;
  const isWishlisted = wishlist && wishlist.has(productKey);
  const imgSrc = product.image || (product.variantImages && product.variantImages[0]) || "";

  return (
    <Link
      to={`/product/${encodedName}`}
      className="product-card group block w-full"
    >
      <div className="product-image-wrap relative aspect-[5/6] bg-white border border-neutral-200 overflow-hidden rounded-md">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            className="product-card-image w-full h-full object-contain p-2 sm:p-2.5"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
            無圖片
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onToggleWishlist) onToggleWishlist(productKey);
          }}
          className={[
            "absolute top-1.5 right-1.5 w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center transition-colors",
            isWishlisted ? "bg-neutral-800 text-white" : "bg-white/90 text-neutral-500 border border-neutral-200 hover:text-neutral-800",
          ].join(" ")}
          aria-label={isWishlisted ? "取消收藏" : "加入收藏"}
        >
          <svg className="w-3.5 h-3.5" fill={isWishlisted ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
        </button>

        {(product.isHot || product.isNewListing) ? (
          <div className="absolute top-1.5 left-1.5 z-[2] flex flex-col items-start gap-1 max-w-[calc(100%-2.75rem)]">
            {product.isNewListing ? <NewListingBadge size="card" /> : null}
            {product.isHot ? (
              <span className="product-badge-hot">熱銷</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pt-2 space-y-0.5">
        <h2 className="text-xs sm:text-sm text-neutral-800 line-clamp-2 leading-snug font-medium">
          {product.name}
        </h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {twd ? (
            <p className="text-xs sm:text-sm font-semibold text-neutral-900">{twd}</p>
          ) : (
            <p className="text-xs text-neutral-500">價格請洽詢</p>
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

function HomePage({ products, rate, loading, error, search: routeSearch, searchKeyword = "", onSearchChange, onNavigateHome, wishlist, onToggleWishlist, carouselConfig }) {
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
    const set = new Set(getKnownCategoryValues());
    for (const p of products) {
      const c = (p?.category ?? p?.分類 ?? "").toString().trim();
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

    // 左側欄「新上架」：上架日期 7 日內自動顯示
    if (newTodayFromUrl) {
      result = result.filter((p) => isNewListingWithinDays(p?.publishedAt ?? p?.上架日期 ?? p?.raw?.publishedAt ?? p?.raw?.上架日期, NEW_LISTING_DAYS));
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
      result = result.filter((p) =>
        subcategoriesMatch(p?.subcategory ?? p?.子分類 ?? "", subcategoryFromUrl)
      );
    }

    // 左側欄選角色：依商品卡的「規格」顯示（規格包含該角色名稱即符合）
    if (characterFromUrl) {
      const charFilter = (characterFromUrl || "").trim();
      result = result.filter((p) => productVariantMatchesCharacter(p, charFilter));
    }
    return result;
  }, [products, selectedCategory, subcategoryFromUrl, characterFromUrl, searchKeyword, newTodayFromUrl, productVariantMatchesCharacter]);

  // 取得用於排序的數字價格（與顧客頁顯示一致：優先顧客顯示售價 → 台幣售價 → 日幣×匯率）
  const getSortPrice = React.useCallback((p) => {
    return getUnitTWD(p, rate);
  }, [rate]);

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
      // price_desc：高→低；price_asc：低→高
      if (sortMode === "price_desc") return pb - pa;
      return pa - pb;
    });
    return arr;
  }, [filteredProducts, sortMode, getSortPrice]);

  const [stockTypeFilter, setStockTypeFilter] = React.useState("ALL");

  const pageTitle = React.useMemo(() => {
    if (newTodayFromUrl) return "新上架";
    if (subcategoryFromUrl) return subcategoryFromUrl;
    if (selectedCategory !== "ALL") return selectedCategory;
    if (characterFromUrl) return characterFromUrl;
    if ((searchKeyword || "").trim()) return "搜尋結果";
    return "全部商品";
  }, [newTodayFromUrl, subcategoryFromUrl, selectedCategory, characterFromUrl, searchKeyword]);

  const filteredByStockType = React.useMemo(() => {
    if (stockTypeFilter === "ALL") return uniqueProducts;
    return uniqueProducts.filter((p) => {
      const st = String(p.stockType || p.raw?.貨況 || p.raw?.現貨預購 || "").trim();
      return st === stockTypeFilter;
    });
  }, [uniqueProducts, stockTypeFilter]);

  return (
    <div className="flex-1 min-w-0 pb-16">
      {carouselConfig ? (
        <HomeCarousel slides={carouselConfig.slides} intervalMs={carouselConfig.intervalMs} />
      ) : null}
      <div className="mb-5 pb-4 border-b border-neutral-200">
        <h1 className="text-lg sm:text-xl font-semibold text-neutral-900 mb-3">
          {pageTitle}
        </h1>

        {!loading && !error && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            <button
              type="button"
              onClick={() => setSortMode("none")}
              className={"shop-filter-chip shrink-0 " + (sortMode === "none" ? "shop-filter-chip-active" : "")}
            >
              預設排序
            </button>
            <button
              type="button"
              onClick={() => {
                if (sortMode === "none") setSortMode("price_desc");
                else if (sortMode === "price_desc") setSortMode("price_asc");
                else setSortMode("price_desc");
              }}
              className={"shop-filter-chip shrink-0 " + (sortMode !== "none" ? "shop-filter-chip-active" : "")}
            >
              {sortMode === "price_desc" ? "價格高→低" : sortMode === "price_asc" ? "價格低→高" : "依價格"}
            </button>
            <button
              type="button"
              onClick={() => setStockTypeFilter("ALL")}
              className={"shop-filter-chip shrink-0 " + (stockTypeFilter === "ALL" ? "shop-filter-chip-active" : "")}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setStockTypeFilter("現貨")}
              className={"shop-filter-chip shrink-0 " + (stockTypeFilter === "現貨" ? "shop-filter-chip-active" : "")}
            >
              現貨
            </button>
            <button
              type="button"
              onClick={() => setStockTypeFilter("預購")}
              className={"shop-filter-chip shrink-0 " + (stockTypeFilter === "預購" ? "shop-filter-chip-active" : "")}
            >
              預購
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <div className="flex flex-col items-center space-y-3 text-neutral-500 text-sm">
            <div className="w-5 h-5 border-2 border-neutral-200 border-t-neutral-600 rounded-full animate-spin" />
            <span>載入商品中</span>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-md mb-6 bg-white border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
          <p className="font-medium mb-1">載入失敗</p>
          <p className="mb-1">{error}</p>
          <p className="text-xs text-red-500">
            請稍後重試，並在瀏覽器主控台查看錯誤訊息。
          </p>
        </div>
      )}

      {!loading && !error && filteredByStockType.length === 0 && (
        <div className="text-center text-sm text-neutral-500 space-y-1 py-20">
          <p>目前沒有可顯示的商品</p>
          {newTodayFromUrl ? (
            <p className="text-xs text-neutral-400">尚無新上架商品（上架 7 日內會自動顯示於此）</p>
          ) : characterFromUrl ? (
            <p className="text-xs text-neutral-400">
              篩選角色「{characterFromUrl}」：試算表「規格」欄需包含該名稱
            </p>
          ) : null}
        </div>
      )}

      <section className="product-grid">
        {filteredByStockType.map((p) => (
          <ProductCard
            key={p.id || p.name}
            product={p}
            rate={rate}
            wishlist={wishlist}
            onToggleWishlist={onToggleWishlist}
          />
        ))}
      </section>
    </div>
  );
}

// 試算表「規格」欄：多個規格以逗號分隔；名稱內可含空白（例：吊飾娃 酷洛米, 手機鍊 美樂蒂）
function splitVariantString(variantStr) {
  if (variantStr == null || variantStr === "") return [];
  const s = String(variantStr).trim();
  if (!s) return [];
  return s.split(/[,，、;；\n\r\uFF0C]+/).map((part) => part.trim()).filter(Boolean);
}

function parseDimOptionsFromSheet_(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(/[,，、;；\n\r\uFF0C\u3000]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatVariantComboName_(parts) {
  return (parts || []).map((p) => String(p || "").trim()).filter(Boolean).join(" ");
}

function variantNameTokens_(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function inferVariantDimensionsFromParts_(parts) {
  if (!parts || parts.length < 2) return null;
  const tokens = parts.map((p) => variantNameTokens_(p));
  const len = tokens[0]?.length || 0;
  if (len < 2 || !tokens.every((t) => t.length === len)) return null;
  const dims = [];
  for (let i = 0; i < len; i++) {
    const seen = new Set();
    const options = [];
    tokens.forEach((t) => {
      if (t[i] && !seen.has(t[i])) {
        seen.add(t[i]);
        options.push(t[i]);
      }
    });
    const defaultLabel = len === 2 ? (i === 0 ? "品項" : "規格") : `規格${i + 1}`;
    dims.push({ label: defaultLabel, options });
  }
  return dims.length >= 2 ? dims : null;
}

function getVariantDimensionConfig_(product, variantParts) {
  const src = product?.raw ?? product ?? {};
  const dims = [];
  for (let i = 1; i <= 2; i++) {
    const label = (src[`variantDim${i}Label`] ?? src[`規格維度${i}名稱`] ?? "").toString().trim();
    const options = parseDimOptionsFromSheet_(src[`variantDim${i}Options`] ?? src[`規格維度${i}選項`]);
    if (options.length) {
      dims.push({
        label: label || (i === 1 ? "品項" : "規格"),
        options,
      });
    }
  }
  if (dims.length >= 2) return dims;
  if (product) {
    const fromProduct = [];
    for (let i = 1; i <= 2; i++) {
      const label = (product[`variantDim${i}Label`] ?? "").toString().trim();
      const options = parseDimOptionsFromSheet_(product[`variantDim${i}Options`]);
      if (options.length) {
        fromProduct.push({ label: label || (i === 1 ? "品項" : "角色"), options });
      }
    }
    if (fromProduct.length >= 2) return fromProduct;
  }
  return inferVariantDimensionsFromParts_(variantParts);
}

function normalizeVariantKey_(v) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

function cartesianDimOptions_(optionLists) {
  const lists = (optionLists || []).filter((arr) => arr && arr.length);
  if (!lists.length) return [];
  return lists.reduce((acc, opts) => {
    if (!acc.length) return opts.map((o) => [o]);
    const out = [];
    acc.forEach((prefix) => {
      opts.forEach((o) => out.push([...prefix, o]));
    });
    return out;
  }, []);
}

function buildFlatVariantItems_(baseGroup) {
  if (!baseGroup.length) return [];
  const p0 = baseGroup[0];
  const allParts = [];
  const seen = new Set();
  for (const p of baseGroup) {
    const rawV = p.variant ?? p.規格 ?? p.raw?.variant ?? p.raw?.規格 ?? "";
    const variantStr = Array.isArray(rawV)
      ? rawV.map((v) => String(v).trim()).filter(Boolean).join(",")
      : String(rawV || "");
    for (const part of splitVariantString(variantStr)) {
      if (part && !seen.has(part)) {
        seen.add(part);
        allParts.push(part);
      }
    }
  }

  let stockList = Array.isArray(p0.variantStock)
    ? p0.variantStock.map((n) => Math.max(0, Number(n) || 0))
    : parseVariantStockStrict(p0.variantStock ?? p0.raw?.variantStock ?? p0.raw?.規格庫存 ?? "");

  if (stockList.length === 0) {
    const mainStock = getProductStockNumber(p0);
    if (mainStock != null) stockList = [mainStock];
  }

  if (allParts.length > 1 && baseGroup.length > 1) {
    stockList = allParts.map((part) => {
      const row = baseGroup.find((p) => {
        const str = String(p.variant ?? p.規格 ?? p.raw?.variant ?? p.raw?.規格 ?? "").trim();
        if (str === part) return true;
        return splitVariantString(str).includes(part);
      });
      return row != null ? getVariantStockQty(row, part) : null;
    });
  } else if (allParts.length > 1) {
    stockList = allParts.map((_, i) => {
      if (stockList[i] != null) return stockList[i];
      if (stockList.length === 1 && stockList[0] != null) return stockList[0];
      return getVariantStockQty(p0, allParts[i]) ?? getProductStockNumber(p0);
    });
  }

  const variantImgList =
    p0.variantImages && Array.isArray(p0.variantImages)
      ? p0.variantImages
      : typeof p0.variantImages === "string"
        ? String(p0.variantImages).split(/[,，、;；\n\r\uFF0C]+/).map((s) => s.trim()).filter(Boolean)
        : [];

  const priceList = parseVariantPriceList(
    p0.variantPrices ?? p0.raw?.variantPrices ?? p0.raw?.規格售價 ?? ""
  );

  if (allParts.length === 0) {
    const rawV = p0.variant ?? p0.規格 ?? "";
    const v = Array.isArray(rawV) ? rawV.join(",") : String(rawV || "").trim();
    const qty = stockList[0] != null ? stockList[0] : getProductStockNumber(p0);
    const unitPrice = resolveVariantUnitPrice_(p0, priceList[0]);
    return [{
      ...p0,
      variant: v || "單一規格",
      sellingPrice: unitPrice ?? p0.sellingPrice,
      customerDisplayPrice: unitPrice ?? p0.customerDisplayPrice,
      sku: [p0.name, v || "單一規格", unitPrice ?? p0.price ?? ""].join("||"),
      variantStockQty: qty,
    }];
  }

  return allParts.map((part, i) => {
    const variantImage =
      variantImgList[i] && String(variantImgList[i]).trim()
        ? variantImgList[i]
        : p0.image;
    const stock =
      stockList[i] != null
        ? stockList[i]
        : getVariantStockQty(p0, part) ?? getProductStockNumber(p0);
    const unitPrice = resolveVariantUnitPrice_(p0, priceList[i]);
    return {
      ...p0,
      variant: part,
      image: variantImage || p0.image,
      sellingPrice: unitPrice ?? p0.sellingPrice,
      customerDisplayPrice: unitPrice ?? p0.customerDisplayPrice,
      sku: [p0.name, part, unitPrice ?? p0.price ?? ""].join("||"),
      variantStockQty: stock,
    };
  });
}

function buildGroupFromVariantDims_(flatItems, variantDims) {
  if (!flatItems.length || !variantDims || variantDims.length < 2) return flatItems;
  const p0 = flatItems[0];
  const combos = cartesianDimOptions_(variantDims.map((d) => d.options));
  if (!combos.length) return flatItems;

  const itemByKey = new Map();
  flatItems.forEach((item) => {
    const key = normalizeVariantKey_(item.variant);
    if (key) itemByKey.set(key, item);
  });

  const flatBySecondToken = new Map();
  flatItems.forEach((item) => {
    const tokens = variantNameTokens_(item.variant);
    if (tokens.length === 1) flatBySecondToken.set(tokens[0], item);
    if (tokens.length >= 2) flatBySecondToken.set(tokens[tokens.length - 1], item);
  });

  return combos.map((parts, comboIndex) => {
    const comboName = formatVariantComboName_(parts);
    const key = normalizeVariantKey_(comboName);
    let existing = itemByKey.get(key);

    if (!existing && parts.length >= 2) {
      existing =
        itemByKey.get(normalizeVariantKey_(parts[1])) ||
        flatBySecondToken.get(parts[parts.length - 1]) ||
        null;
    }

    if (existing) {
      const unitPrice = existing.sellingPrice ?? existing.customerDisplayPrice ?? p0.sellingPrice;
      return {
        ...existing,
        variant: comboName,
        sku: [p0.name, comboName, unitPrice ?? p0.price ?? ""].join("||"),
      };
    }

    const unitPrice = resolveVariantUnitPrice_(p0, null);
    return {
      ...p0,
      variant: comboName,
      image: p0.image,
      sellingPrice: unitPrice ?? p0.sellingPrice,
      customerDisplayPrice: unitPrice ?? p0.customerDisplayPrice,
      sku: [p0.name, comboName, unitPrice ?? p0.price ?? ""].join("||"),
      variantStockQty: getProductStockNumber(p0),
    };
  });
}

function resolveProductVariantLayout_(baseGroup) {
  if (!baseGroup.length) {
    return { group: [], variantDims: null, useTwoTier: false };
  }
  const flatItems = buildFlatVariantItems_(baseGroup);
  const parts = flatItems.map((g) => String(g.variant || "").trim()).filter(Boolean);
  const variantDims = getVariantDimensionConfig_(baseGroup[0], parts);
  const useTwoTier = !!(
    variantDims &&
    variantDims.length >= 2 &&
    variantDims[0].options?.length &&
    variantDims[1].options?.length
  );
  const group = useTwoTier ? buildGroupFromVariantDims_(flatItems, variantDims) : flatItems;
  return { group, variantDims, useTwoTier };
}

function isDimOptionAvailable_(dimIndex, option, selectedDims, group) {
  if (!option || !group?.length) return false;
  if (dimIndex === 0) {
    return group.some((g) => {
      const tokens = variantNameTokens_(g.variant);
      return tokens[0] === option || normalizeVariantKey_(g.variant).indexOf(option) >= 0;
    });
  }
  const dim0 = selectedDims[0];
  if (!dim0) return false;
  return !!findGroupItemByCombo_(group, [dim0, option]);
}

function findGroupItemByCombo_(group, parts) {
  const combo = formatVariantComboName_(parts);
  if (!combo) return null;
  const key = normalizeVariantKey_(combo);
  return (
    group.find((g) => normalizeVariantKey_(g.variant) === key) ||
    group.find((g) => String(g.variant || "").trim() === combo) ||
    null
  );
}

function VariantTwoTierPicker({ variantDims, group, selectedDims, onPickDim }) {
  return (
    <div className="variant-two-tier space-y-4">
      {variantDims.map((dim, dimIndex) => (
        <div key={`${dim.label}-${dimIndex}`} className="variant-tier-block">
          <h3 className="text-xs font-medium text-slate-500 tracking-wide mb-2">
            {dim.label}
          </h3>
          <div className="flex flex-wrap gap-2">
            {dim.options.map((opt) => {
              const available = isDimOptionAvailable_(dimIndex, opt, selectedDims, group);
              const active = selectedDims[dimIndex] === opt;
              const isItemTier =
                /品項|類型|種類|類別/.test(String(dim.label || "").trim()) || dimIndex === 0;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={!available}
                  onClick={() => onPickDim(dimIndex, opt)}
                  className={[
                    "variant-dim-chip min-w-[4.5rem] px-3 py-2 rounded-xl border text-sm transition-colors",
                    isItemTier ? "text-center" : "text-left",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : available
                        ? "border-slate-200 bg-white text-slate-700 hover:border-slate-900"
                        : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed",
                  ].join(" ")}
                >
                  <span className="block font-medium leading-tight">{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductDetailPage({ products, rate, encodedName, onAddToCart }) {
  const decodedName = decodeURIComponent(encodedName || "");

  const baseGroup = React.useMemo(() => {
    return products.filter((p) => p.name === decodedName);
  }, [products, decodedName]);

  const { group, variantDims, useTwoTier } = React.useMemo(
    () => resolveProductVariantLayout_(baseGroup),
    [baseGroup]
  );

  if (!decodedName) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
        <button
          onClick={() => history.back()}
          className="inline-flex items-center gap-1 text-sm mb-6 text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <span>←</span>
          <span>返回列表</span>
        </button>
        <p className="text-sm text-neutral-500">找不到此商品。</p>
      </main>
    );
  }

  const mainProduct = group[0];
  const [selectedSku, setSelectedSku] = React.useState(null);
  const [selectedDims, setSelectedDims] = React.useState([null, null]);

  React.useEffect(() => {
    if (!group?.length) return;
    if (useTwoTier && variantDims) {
      const initial = variantDims.map((d) => d.options[0]);
      const item = findGroupItemByCombo_(group, initial) || group[0];
      setSelectedDims(initial);
      setSelectedSku(item.sku);
      return;
    }
    setSelectedDims([null, null]);
    setSelectedSku((prev) => {
      if (prev && group.some((g) => g.sku === prev)) return prev;
      return group[0].sku;
    });
  }, [decodedName, group, useTwoTier, variantDims]);

  function onPickDim(dimIndex, value) {
    setSelectedDims((prev) => {
      const next = variantDims.map((d, i) => {
        if (i === dimIndex) return value;
        return prev[i] && d.options.includes(prev[i]) ? prev[i] : d.options[0];
      });
      if (dimIndex === 0) {
        const matched = findGroupItemByCombo_(group, next);
        if (!matched) {
          const fallback = group.find((g) => variantNameTokens_(g.variant)[0] === value);
          if (fallback) {
            const tokens = variantNameTokens_(fallback.variant);
            next[0] = tokens[0];
            next[1] = tokens[1] || next[1];
          }
        }
      }
      const item = findGroupItemByCombo_(group, next);
      if (item) setSelectedSku(item.sku);
      return next;
    });
  }

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
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => history.back()}
        className="inline-flex items-center gap-1 text-sm mb-6 text-neutral-600 hover:text-neutral-900 transition-colors"
      >
        <span>←</span>
        <span>返回列表</span>
      </button>

      {!mainProduct ? (
        <p className="text-sm text-neutral-500">找不到此商品。</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
            <div className="aspect-square bg-neutral-50">
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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                {mainProduct.name}
              </h1>
              {mainProduct.isNewListing ? <NewListingBadge size="detail" /> : null}
            </div>

            {(mainProduct.character || selectedItem?.character) ? (
              <p className="text-sm text-slate-500">
                角色：{mainProduct.character || selectedItem?.character}
              </p>
            ) : null}

            {(mainProduct.stockType || selectedItem?.stockType || mainProduct.raw?.貨況 || selectedItem?.raw?.貨況) ? (
              <div className="pt-0.5">
                <StockTag
                  value={String(mainProduct.stockType || selectedItem?.stockType || mainProduct.raw?.貨況 || selectedItem?.raw?.貨況 || "").trim()}
                  size="md"
                />
              </div>
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
                <h2 className="text-xs font-medium text-neutral-500 mb-2">
                  商品介紹
                </h2>
                <div className="text-sm text-neutral-700 whitespace-pre-line bg-white rounded-md border border-neutral-200 p-4">
                  {selectedItem?.introduction || mainProduct?.introduction}
                </div>
              </div>
            ) : null}

            <div className="mt-2 space-y-3">
              {group.length >= 1 ? (
                <div>
                  {useTwoTier && variantDims ? (
                    <>
                      <h2 className="text-xs font-medium text-slate-500 tracking-[0.2em] uppercase mb-3">
                        請選擇規格
                      </h2>
                      <VariantTwoTierPicker
                        variantDims={variantDims}
                        group={group}
                        selectedDims={selectedDims}
                        onPickDim={onPickDim}
                      />
                      {selectedItem ? (
                        <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                          已選：<span className="text-slate-800 font-medium">{selectedItem.variant}</span>
                          {getDisplayPrice(selectedItem, rate) ? (
                            <span className="ml-2">{getDisplayPrice(selectedItem, rate)}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <h2 className="text-xs font-medium text-slate-500 tracking-[0.2em] uppercase mb-2">
                        規格
                      </h2>
                      <div className="space-y-2">
                        {group.map((item, index) => {
                          const label =
                            item.variant || (group.length === 1 ? "單一規格" : `款式 ${index + 1}`);
                          return (
                            <label
                              key={item.sku || item.id || index}
                              className={[
                                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 cursor-pointer",
                                selectedSku === item.sku
                                  ? "border-slate-900 bg-slate-50"
                                  : "border-slate-200 bg-white hover:border-slate-900",
                              ].join(" ")}
                            >
                              <span className="flex items-center gap-2 text-sm text-slate-700 min-w-0 flex-1">
                                <input
                                  type="radio"
                                  name="variant"
                                  checked={selectedSku === item.sku}
                                  onChange={() => setSelectedSku(item.sku)}
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
                              </span>
                              <span className="text-xs text-slate-500 shrink-0">
                                {getDisplayPrice(item, rate) || ""}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => selectedItem && onAddToCart(selectedItem, 1)}
                disabled={!selectedItem}
                className="w-full rounded-md bg-neutral-800 text-white text-sm py-3 hover:bg-neutral-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
              >
                加入購物車
              </button>
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
      customerDisplayPrice: it.customerDisplayPrice ?? fromList.customerDisplayPrice,
    };
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
                        <button
                          type="button"
                          onClick={() => onInc(it.key)}
                          className="w-8 h-8 rounded-full border border-slate-200 hover:border-slate-900"
                          aria-label="增加數量"
                        >
                          +
                        </button>
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

function PointsPage() {
  const [nameInput, setNameInput] = React.useState(() => {
    try {
      return localStorage.getItem(LOYALTY_NAME_KEY) || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);

  const queryBalance = React.useCallback(async (name, silent) => {
    const trimmed = String(name || "").trim();
    if (normalizeLoyaltyCustomerName(trimmed).length < 2) {
      setError("請輸入至少兩個字的客戶姓名（需與訂單姓名一致）");
      setResult(null);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchPointsBalance(trimmed);
      setResult(data);
      try {
        localStorage.setItem(LOYALTY_NAME_KEY, trimmed);
      } catch {
        // ignore
      }
      setNameInput(trimmed);
      try {
        window.dispatchEvent(
          new CustomEvent("maaru-loyalty-updated", { detail: { balance: Number(data.balance) || 0 } })
        );
      } catch {
        // ignore
      }
    } catch (err) {
      setError(err && err.message ? err.message : "查詢失敗");
      setResult(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const saved = (nameInput || "").trim();
    if (normalizeLoyaltyCustomerName(saved).length >= 2) {
      queryBalance(saved, true).finally(() => setLoading(false));
    }
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    queryBalance(nameInput, false);
  }

  function handleClearSaved() {
    try {
      localStorage.removeItem(LOYALTY_NAME_KEY);
    } catch {
      // ignore
    }
    setNameInput("");
    setResult(null);
    setError(null);
    try {
      window.dispatchEvent(new CustomEvent("maaru-loyalty-updated", { detail: { balance: null } }));
    } catch {
      // ignore
    }
  }

  const balance = result && !result.error ? Number(result.balance) || 0 : null;

  return (
    <main className="flex-1 w-full max-w-lg mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <Link to="/" className="text-xs text-neutral-500 hover:text-neutral-800 underline">
          ← 回首頁
        </Link>
        <h1 className="mt-3 text-xl font-semibold text-neutral-900 tracking-tight">我的紅利點數</h1>
        <p className="mt-1 text-sm text-neutral-500">輸入與訂單相同的客戶姓名，即可查詢可用點數</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div>
          <label htmlFor="loyaltyNameInput" className="block text-xs font-medium text-neutral-600 mb-1.5">
            客戶姓名
          </label>
          <input
            id="loyaltyNameInput"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="例：陳小華"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            autoComplete="name"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-60 transition-colors"
        >
          {loading ? "查詢中…" : "查詢點數"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 text-sm text-red-600 rounded-lg border border-red-100 bg-red-50 px-3 py-2">{error}</p>
      ) : null}

      {result && !error ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm space-y-4">
          <div>
            <p className="text-xs text-amber-800/70 uppercase tracking-wide">會員</p>
            <p className="text-lg font-semibold text-neutral-900 mt-0.5">{result.customerName || nameInput}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/80 border border-amber-100 p-3">
              <p className="text-xs text-neutral-500">可用點數</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{balance}</p>
            </div>
            <div className="rounded-lg bg-white/80 border border-amber-100 p-3">
              <p className="text-xs text-neutral-500">約可折抵</p>
              <p className="text-2xl font-bold text-neutral-800 mt-1">NT${balance}</p>
            </div>
          </div>
          {result.nextExpireDate ? (
            <p className="text-xs text-neutral-600">
              最近到期：<span className="font-medium">{String(result.nextExpireDate).slice(0, 10)}</span>
              {result.nextExpirePoints ? `（${result.nextExpirePoints} 點）` : ""}
            </p>
          ) : null}
          {balance === 0 ? (
            <div className="text-sm text-neutral-600 space-y-2">
              <p>{result.message || "目前尚無可用紅利點數"}</p>
              <p className="text-xs text-neutral-500">
                若後台已有點數卻顯示 0，請到後台「紅利點數」按<strong>同步至試算表</strong>，並確認姓名與訂單完全一致。
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">下次下單時可於 LINE 告知要使用幾點折抵。</p>
          )}
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 space-y-2">
        <p className="font-medium text-neutral-800">集點規則</p>
        <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm">
          <li>消費滿 NT$100 集 1 點（依訂單完成後計算）</li>
          <li>1 點可折抵 NT$1</li>
          <li>點數自發放日起 365 天內有效</li>
        </ul>
      </div>

      {nameInput ? (
        <button
          type="button"
          onClick={handleClearSaved}
          className="mt-4 text-xs text-neutral-400 hover:text-neutral-600 underline"
        >
          清除已記住的姓名
        </button>
      ) : null}
    </main>
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

  const [loyaltyBalance, setLoyaltyBalance] = React.useState(null);

  React.useEffect(() => {
    function onLoyaltyUpdated(e) {
      if (!e || !e.detail) return;
      if (e.detail.balance == null) setLoyaltyBalance(null);
      else setLoyaltyBalance(Number(e.detail.balance) || 0);
    }
    window.addEventListener("maaru-loyalty-updated", onLoyaltyUpdated);
    return () => window.removeEventListener("maaru-loyalty-updated", onLoyaltyUpdated);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let saved = "";
    try {
      saved = (localStorage.getItem(LOYALTY_NAME_KEY) || "").trim();
    } catch {
      saved = "";
    }
    if (normalizeLoyaltyCustomerName(saved).length < 2) {
      setLoyaltyBalance(null);
      return;
    }
    fetchPointsBalance(saved)
      .then((data) => {
        if (!cancelled) setLoyaltyBalance(Number(data.balance) || 0);
      })
      .catch(() => {
        if (!cancelled) setLoyaltyBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  function addToCart(product, qty) {
    const key =
      product.sku ||
      [product.name, product.variant || "", product.sellingPrice ?? product.price ?? ""].join("||");
    const addQty = Math.max(1, Number(qty || 1));
    setCartItems((prev) => {
      const idx = prev.findIndex((x) => x.key === key);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], qty: (copy[idx].qty || 0) + addQty };
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
          customerDisplayPrice: product.customerDisplayPrice,
          image: product.image || "",
          qty: addQty,
        },
      ];
    });
    setCartOpen(true);
  }

  function incItem(key) {
    setCartItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, qty: (it.qty || 0) + 1 } : it))
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

  const WISHLIST_KEY = "maarushop_wishlist_v1";
  const [wishlist, setWishlist] = React.useState(() => {
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify([...wishlist]));
    } catch {
      // ignore
    }
  }, [wishlist]);

  function toggleWishlist(productKey) {
    setWishlist((prev) => {
      const next = new Set(prev);
      if (next.has(productKey)) next.delete(productKey);
      else next.add(productKey);
      return next;
    });
  }

  const PROMO_KEY = "maarushop_promo_dismissed_v1";
  const [promoVisible, setPromoVisible] = React.useState(() => {
    try {
      return localStorage.getItem(PROMO_KEY) !== "1";
    } catch {
      return true;
    }
  });

  function dismissPromo() {
    setPromoVisible(false);
    try {
      localStorage.setItem(PROMO_KEY, "1");
    } catch {
      // ignore
    }
  }

  const handleMenuNavigate = (path) => {
    let full = path;
    const q = sidebarSearch.trim();
    if (q) full += (path.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(q);
    navigateTo(full);
  };

  const homeParams = React.useMemo(() => parseSearchParams(route.search || ""), [route.search]);
  const carouselConfig = useHomeCarousel();

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
        wishlist={wishlist}
        onToggleWishlist={toggleWishlist}
        carouselConfig={carouselConfig}
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
  } else if (route.name === "points") {
    page = <PointsPage />;
  } else {
    page = <NotFoundPage />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#fafafa]">
      <Navbar
        cartCount={cartCount}
        loyaltyBalance={loyaltyBalance}
        onOpenCart={() => setCartOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
        onLogoClick={() => {
          window.location.hash = "#/";
          window.location.reload();
        }}
        searchKeyword={sidebarSearch}
        onSearchChange={setSidebarSearch}
      />
      <PromoBanner visible={promoVisible} onDismiss={dismissPromo} />
      <CategorySidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        searchKeyword={sidebarSearch}
        onSearchChange={setSidebarSearch}
        onNavigate={handleMenuNavigate}
        selectedCharacter={homeParams.character || ""}
        characterImages={characterImages}
        products={products}
      />
      {route.name === "home" ? (
        <div className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 flex gap-6 lg:gap-8">
          <ShopSidebar
            products={products}
            activeCategory={homeParams.category || "ALL"}
            activeSubcategory={homeParams.subcategory || ""}
            newTodayActive={homeParams.newToday === "1" || homeParams.newToday === "true"}
            onNavigate={handleMenuNavigate}
          />
          {page}
        </div>
      ) : (
        page
      )}
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


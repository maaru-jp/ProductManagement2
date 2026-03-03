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
  const image =
    row.image ??
    row.圖片 ??
    row.imageUrl ??
    row.Image ??
    row["圖片URL"] ??
    "";
  const description =
    row.description ?? row.描述 ?? row.說明 ?? row.content ?? "";
  const introduction =
    row.introduction ??
    row.商品介紹 ??
    row.介紹 ??
    row.intro ??
    "";
  const variant = row.variant ?? row.規格 ?? row.顏色 ?? row.option ?? "";
  const category = row.category ?? row.分類 ?? "";
  const subcategory = row.subcategory ?? row.子分類 ?? "";
  const character = row.character ?? row.角色 ?? row.角色名稱 ?? "";
  const status = (row.status ?? row.狀態 ?? "上架").toString().trim() || "上架";
  const isHot = toBoolFlag(row.hot ?? row.熱銷);
  const isRecommended = toBoolFlag(row.recommended ?? row.推薦);
  const publishedAt = row.publishedAt ?? row.上架日期 ?? row.上架時間 ?? null;
  const isNewByFlag = toBoolFlag(row.isNew ?? row.新品);
  const isNewByDate = isWithinLastDays(publishedAt, 7);
  const isNew = isNewByFlag || isNewByDate;

  const sku = [name, variant, price ?? ""].join("||");

  return {
    raw: row,
    id,
    sku,
    name,
    price,
    image,
    description,
    introduction,
    variant,
    category,
    subcategory,
    character,
    status,
    isHot,
    isRecommended,
    isNew,
    publishedAt,
  };
}

function useProducts() {
  const [products, setProducts] = React.useState([]);
  const [rate, setRate] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      let lastError = null;
      const urlsToTry = isLocalDev
        ? [API_URL_LOCAL, API_URL, CORS_PROXY_PREFIX + encodeURIComponent(API_URL)]
        : [API_URL, CORS_PROXY_PREFIX + encodeURIComponent(API_URL)];
      for (const url of urlsToTry) {
        if (cancelled) break;
        try {
          // 不要加自訂 header，否則會觸發 CORS preflight，Google Script 常不回應
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
            setProducts(onlyListed);
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

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  return { products, rate, loading, error };
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

// 分類選單結構：主分類 + 子分類（可展開/收合）
const CATEGORY_MENU = [
  {
    label: "文 | 具 | 小 | 物",
    value: "文具小物",
    children: [
      { label: "各式筆類", value: "各式筆類" },
      { label: "筆記本 | 便條紙", value: "筆記本便條紙" },
      { label: "卡片 | 信紙 | 紙袋", value: "卡片信紙紙袋" },
      { label: "文件夾 | 資料袋", value: "文件夾資料袋" },
      { label: "紙膠帶 | 貼紙", value: "紙膠帶貼紙" },
      { label: "筆袋 | 筆盒", value: "筆袋筆盒" },
      { label: "剪刀 | 尺 | 事務用品", value: "剪刀尺事務用品" },
      { label: "3C周邊", value: "3C周邊" },
    ],
  },
  {
    label: "包 | 袋 | 配 | 件",
    value: "包袋配件",
    children: [
      { label: "後背包", value: "後背包" },
      { label: "手提 | 斜背包", value: "手提斜背包" },
      { label: "肩背 | 側背包", value: "肩背側背包" },
      { label: "皮夾", value: "皮夾" },
      { label: "零錢包 | 卡夾", value: "零錢包卡夾" },
      { label: "化妝包 | 束口袋 | 收納包", value: "化妝包束口袋收納包" },
      { label: "旅行用品", value: "旅行用品" },
      { label: "環保購物袋", value: "環保購物袋" },
      { label: "眼鏡盒", value: "眼鏡盒" },
      { label: "吊飾 | 鑰匙圈", value: "吊飾鑰匙圈" },
      { label: "手錶 | 飾品", value: "手錶飾品" },
      { label: "服飾 | 鞋襪 | 帽子 | 圍巾", value: "服飾鞋襪帽子圍巾" },
      { label: "髮飾", value: "髮飾" },
      { label: "風扇 | 扇子", value: "風扇扇子" },
    ],
  },
  {
    label: "餐 | 廚 | 百 | 貨",
    value: "餐廚百貨",
    children: [
      { label: "匙 | 叉 | 筷", value: "匙叉筷" },
      { label: "碗 | 盤 | 食器類", value: "碗盤食器類" },
      { label: "便當盒 | 保鮮盒", value: "便當盒保鮮盒" },
      { label: "馬克杯 | 各式水杯", value: "馬克杯各式水杯" },
      { label: "保溫杯瓶", value: "保溫杯瓶" },
      { label: "水壺", value: "水壺" },
      { label: "吸管 | 杯蓋 | 杯墊", value: "吸管杯蓋杯墊" },
      { label: "料理烘焙模具 | 創意便當", value: "料理烘焙模具創意便當" },
      { label: "杯袋 | 便當袋", value: "杯袋便當袋" },
      { label: "鍋具 | 茶壺 | 廚房電器", value: "鍋具茶壺廚房電器" },
      { label: "廚具 | 餐廚小物", value: "廚具餐廚小物" },
      { label: "廚房收納", value: "廚房收納" },
    ],
  },
  {
    label: "媽 | 咪 | 寶 | 貝",
    value: "媽咪寶貝",
    children: [
      { label: "兒童水壺 | 杯瓶", value: "兒童水壺杯瓶" },
      { label: "兒童餐具", value: "兒童餐具" },
      { label: "玩具", value: "玩具" },
      { label: "絨毛玩偶 | 公仔", value: "絨毛玩偶公仔" },
      { label: "卡通泡澡球", value: "卡通泡澡球" },
      { label: "Tomica小汽車", value: "Tomica小汽車" },
      { label: "兒童包袋服飾配件", value: "兒童包袋服飾配件" },
      { label: "母嬰用品", value: "母嬰用品" },
    ],
  },
  {
    label: "居 | 家 | 雜 | 貨",
    value: "居家雜貨",
    children: [
      { label: "桌上小物收納", value: "桌上小物收納" },
      { label: "收納籃 | 收納箱", value: "收納籃收納箱" },
      { label: "門簾 | 地墊", value: "門簾地墊" },
      { label: "寢具 | 抱枕 | 毯", value: "寢具抱枕毯" },
      { label: "時鐘 | 傢飾 | 燈", value: "時鐘傢飾燈" },
      { label: "室內拖 | 圍裙", value: "室內拖圍裙" },
      { label: "掛勾 | 衣架 | 洗曬", value: "掛勾衣架洗曬" },
      { label: "雨具 | 雨衣", value: "雨具雨衣" },
      { label: "垃圾桶 | 清潔小物", value: "垃圾桶清潔小物" },
      { label: "居家雜貨", value: "居家雜貨" },
      { label: "桌墊 | 野餐墊", value: "桌墊野餐墊" },
      { label: "汽機車用品", value: "汽機車用品" },
    ],
  },
  {
    label: "衛 | 浴 | 用 | 品",
    value: "衛浴用品",
    children: [
      { label: "毛巾 | 浴巾", value: "毛巾浴巾" },
      { label: "手帕 | 擦手巾", value: "手帕擦手巾" },
      { label: "牙刷 | 盥洗小物", value: "牙刷盥洗小物" },
      { label: "浴室收納 | 用具", value: "浴室收納用具" },
    ],
  },
  {
    label: "美 | 妝 | 衛 | 生",
    value: "美妝衛生",
    children: [
      { label: "口罩 | 防疫周邊", value: "口罩防疫周邊" },
      { label: "分裝瓶罐", value: "分裝瓶罐" },
      { label: "鏡梳", value: "鏡梳" },
      { label: "濕紙巾 | 面紙", value: "濕紙巾面紙" },
      { label: "ok繃 | 棉棒 | 牙線", value: "ok繃棉棒牙線" },
      { label: "清潔保養", value: "清潔保養" },
      { label: "美甲小物", value: "美甲小物" },
      { label: "其他美妝小物", value: "其他美妝小物" },
    ],
  },
];

// 商品款式角色（點擊後列出該角色所有商品）
const CHARACTER_LIST = [
  { value: "", label: "全部" },
  { value: "酷洛米", label: "酷洛米" },
  { value: "凱蒂貓", label: "凱蒂貓" },
  { value: "大耳狗", label: "大耳狗" },
  { value: "Hello Kitty", label: "Hello Kitty" },
  { value: "My Melody", label: "My Melody" },
  { value: "Cinnamoroll", label: "Cinnamoroll" },
  { value: "HANGYODON", label: "HANGYODON" },
  { value: "Pompompurin", label: "Pompompurin" },
  { value: "Little Twin Stars", label: "Little Twin Stars" },
  { value: "Pochacco", label: "Pochacco" },
  { value: "TUXEDOSAM", label: "TUXEDOSAM" },
  { value: "雙星仙子", label: "雙星仙子" },
];

// 店舗內分類：字串為單一項目，{ label, children } 為有子選單的項目
const STORE_CATEGORIES = [
  "全商品一覧",
  "新上架商品",
  "HOT預購商品",
  { label: "絨毛玩偶", children: ["玩偶公仔", "吊飾娃娃"] },
  { label: "包包時尚小物", children: ["托特包", "手提包", "肩背包", "斜背包"] },
  { label: "美妝用品", children: ["化妝包", "梳子", "鏡子", "美容小物", "其他美妝用品"] },
  { label: "飾品配件", children: ["髮飾", "飾品盒", "鑰匙圈", "眼鏡盒", "手錶", "其他時尚飾品"] },
  { label: "服飾專區", children: ["上衣", "睡衣", "襪子", "其他服飾"] },
  {
    label: "文具用品",
    children: ["年曆×手帳本", "筆記本×日記本×活頁紙", "便條紙", "貼紙", "文件收納", "辦公事務用品", "明信片", "其他文具用品"],
  },
  { label: "3C用品", children: ["手機殼", "充電配件", "其他3C周邊"] },
  { label: "居家生活", children: ["抱枕×靠枕", "居家裝飾品", "毛毯", "室內鞋", "收納用品"] },
  { label: "兒童專區", children: ["便當盒", "水壺", "手帕毛巾", "兒童小包"] },
  "廚房用品",
  "浴室用品",
  { label: "旅行用品", children: ["行李吊牌", "行李束帶", "旅行收納物", "旅用小物×其他"] },
  { label: "戶外用品", children: ["雨傘", "戶外用品"] },
  "使用者指南",
];

function CategorySidebar({ open, onClose, searchKeyword, onSearchChange, onNavigate, selectedCharacter = "" }) {
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
      <div
        className={[
          "fixed inset-0 z-30 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div
          className="absolute inset-0 bg-slate-900/20"
          onClick={onClose}
          aria-label="關閉選單"
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
        {/* Header：左側 X，右側品牌名 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
            aria-label="關閉"
          >
            ✕
          </button>
          <span className="text-sm font-semibold text-slate-900 tracking-wide uppercase">MENU</span>
        </div>

        <div className="flex-1 overflow-auto">
          {/* 搜尋欄：放大鏡在輸入關鍵字框左邊 */}
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white focus-within:ring-1 focus-within:ring-slate-300 focus-within:border-slate-300">
              <span
                className="shrink-0 w-9 h-9 flex items-center justify-center text-slate-500"
                aria-hidden
              >
                🔍
              </span>
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
                          "w-12 h-12 rounded-full flex items-center justify-center text-slate-700 text-sm font-medium border-2 transition-colors",
                          isSelected
                            ? "bg-slate-200 border-slate-400 ring-2 ring-slate-300"
                            : "bg-slate-100 border-slate-200 group-hover:bg-slate-200",
                        ].join(" ")}
                      >
                        {char.label.slice(0, 1)}
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

          {/* 店舗內分類：垂直列表 + 右箭頭 */}
          <div className="border-t border-slate-200 pt-2">
            <p className="px-4 text-xs font-semibold text-slate-500 tracking-wider mb-1">
              店舗內分類
            </p>
            <nav className="py-1">
              {STORE_CATEGORIES.map((item) => {
                const label = typeof item === "string" ? item : item.label;
                const children = typeof item === "string" ? null : item.children;
                const isExpanded = expandedStoreKey === label;

                if (children && children.length > 0) {
                  return (
                    <div key={label} className="border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => setExpandedStoreKey(isExpanded ? null : label)}
                        className={storeCategoryClass}
                      >
                        <span>{label}</span>
                        <span className={["text-slate-400 transition-transform", isExpanded ? "rotate-90" : ""].join(" ")}>›</span>
                      </button>
                      {isExpanded ? (
                        <div>
                          {children.map((sub) => (
                            <button
                              key={sub}
                              type="button"
                              onClick={() => {
                                onNavigate("/?category=" + encodeURIComponent(label) + "&subcategory=" + encodeURIComponent(sub));
                                onClose();
                              }}
                              className="flex items-center justify-between w-full py-2.5 pl-6 pr-4 text-left text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
                            >
                              <span>{sub}</span>
                              <span className="text-slate-400">›</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { onNavigate("/"); onClose(); }}
                    className={storeCategoryClass}
                  >
                    <span>{label}</span>
                    <span className="text-slate-400">›</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </aside>
    </>
  );
}

function Navbar({ cartCount, onOpenCart, onOpenMenu }) {
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-slate-200 bg-white hover:border-slate-900 transition-colors"
            aria-label="開啟分類選單"
          >
            <span className="text-lg leading-none">☰</span>
          </button>
        </div>

        <Link
          to="/"
          className="flex items-center space-x-2 justify-center transition-transform duration-150 hover:opacity-90 active:scale-95"
        >
          <div className="w-11 h-11 rounded-full overflow-hidden bg-slate-900 flex items-center justify-center">
            <img
              src="./品牌logo_tondiv.jpg"
              alt="Maaru 品牌 Logo"
              className="w-full h-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex flex-col leading-tight text-left">
            <span className="text-sm font-semibold tracking-[0.2em] uppercase">
              Maaru
            </span>
            <span className="text-xs text-slate-500 tracking-[0.15em] uppercase">
              Select Shop
            </span>
          </div>
        </Link>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onOpenCart}
            className="relative inline-flex items-center justify-center w-11 h-11 rounded-full border border-slate-200 bg-white hover:border-slate-900 transition-colors"
            aria-label="開啟購物車"
          >
            <span className="text-base">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-slate-900 text-white text-[10px] leading-5 text-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function ProductCard({ product, rate }) {
  const twd = formatTWDFromJPY(product.price, rate);

  const encodedName = encodeURIComponent(product.name);

  return (
    <Link
      to={`/product/${encodedName}`}
      className="product-card group block bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-slate-900 transition-colors duration-200"
    >
      <div className="scan-target relative aspect-[4/5] bg-slate-100 overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            No Image
          </div>
        )}

        {(product.isHot || product.isRecommended || product.isNew || product.character) ? (
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

  const [selectedCategory, setSelectedCategory] = React.useState(() => {
    if (categoryFromUrl) return categoryFromUrl;
    try {
      return localStorage.getItem(CATEGORY_KEY) || "ALL";
    } catch {
      return "ALL";
    }
  });

  const [selectedSubcategory, setSelectedSubcategory] = React.useState(subcategoryFromUrl || "");

  // 當網址列上的 category / subcategory 改變時，同步到 state
  React.useEffect(() => {
    if (categoryFromUrl !== null) setSelectedCategory(categoryFromUrl);
  }, [categoryFromUrl]);
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

  const filteredProducts = React.useMemo(() => {
    let result = products;
    if (selectedCategory !== "ALL") {
      result = result.filter(
        (p) => (p?.category || "").trim() === selectedCategory
      );
    }
    if (subcategoryFromUrl) {
      result = result.filter(
        (p) => (p?.subcategory || "").trim() === subcategoryFromUrl
      );
    }
    if (characterFromUrl) {
      const charFilter = (characterFromUrl || "").trim();
      result = result.filter((p) => {
        const pChar = (
          (p?.character ?? p?.raw?.character ?? p?.raw?.角色 ?? p?.raw?.角色名稱 ?? "") + ""
        ).trim();
        return pChar === charFilter;
      });
    }
    const q = (searchKeyword || "").trim().toLowerCase();
    if (!q) return result;

    return result.filter((p) => {
      const name = (p?.name || "").toLowerCase();
      const variant = (p?.variant || "").toLowerCase();
      return name.includes(q) || variant.includes(q);
    });
  }, [products, selectedCategory, subcategoryFromUrl, characterFromUrl, searchKeyword]);

  const uniqueProducts = React.useMemo(() => {
    const base = getUniqueProductsByName(filteredProducts);
    if (sortMode === "none") return base;

    const arr = base.slice();
    arr.sort((a, b) => {
      const pa = toNumberOrNull(a?.price);
      const pb = toNumberOrNull(b?.price);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return sortMode === "price_asc" ? pa - pb : pb - pa;
    });
    return arr;
  }, [filteredProducts, sortMode]);

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

      {!loading && !error && uniqueProducts.length === 0 && (
        <div className="text-center text-sm text-slate-500 space-y-1">
          <p>目前沒有可顯示的商品。</p>
          {characterFromUrl ? (
            <p className="text-xs">
              篩選角色「{characterFromUrl}」：請確認試算表「角色」欄是否填寫與左側選單完全一致的名稱（如 酷洛米、凱蒂貓、大耳狗）。
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

function ProductDetailPage({ products, rate, encodedName, onAddToCart }) {
  const decodedName = decodeURIComponent(encodedName || "");

  const group = React.useMemo(() => {
    return products.filter((p) => p.name === decodedName);
  }, [products, decodedName]);

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

  const displayImage = selectedItem?.image || mainProduct?.image || "";

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
            <div className="aspect-[4/5] bg-slate-100">
              {displayImage ? (
                <img
                  src={displayImage}
                  alt={mainProduct.name}
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

            {selectedItem?.price != null ? (
              <div className="space-y-0.5">
                {formatTWDFromJPY(selectedItem.price, rate) ? (
                  <p className="text-base text-slate-900">
                    {formatTWDFromJPY(selectedItem.price, rate)}
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
                          <span className="flex items-center gap-2 text-sm text-slate-700 min-w-0">
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
                            <span>{label}</span>
                          </span>
                          <span className="text-xs text-slate-500">
                            {item.price != null ? formatTWDFromJPY(item.price, rate) || "" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => selectedItem && onAddToCart(selectedItem, 1)}
                disabled={!selectedItem}
                className="w-full rounded-xl bg-slate-900 text-white text-sm py-3 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
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
  rate,
  onInc,
  onDec,
  onRemove,
  onClear,
}) {
  const [copyState, setCopyState] = React.useState({ status: "idle", message: "" });

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

  const totalJPY = React.useMemo(() => {
    return items.reduce((sum, it) => sum + (toNumberOrNull(it.price) || 0) * it.qty, 0);
  }, [items]);

  const totalTWD = formatTWDFromJPY(totalJPY, rate);

  function buildCheckoutText() {
    const lines = [];
    lines.push("MAARU 日本萌GO代購登記清單：");
    lines.push("");

    const r = toNumberOrNull(rate);

    for (const it of items) {
      const name = (it.name || "").trim();
      const variant = (it.variant || "").trim();
      const qty = Number(it.qty || 0);
      const jpy = toNumberOrNull(it.price) || 0;
      const lineName = variant ? `${name} ${variant}` : name;

      if (r != null) {
        const twd = Math.round(jpy * r * qty);
        lines.push(`${lineName} × ${qty}  NT$${twd.toLocaleString("zh-TW")}`);
      } else {
        lines.push(`${lineName} × ${qty}  NT$—`);
      }
    }

    lines.push("");
    if (r != null) {
      const total = Math.round((toNumberOrNull(totalJPY) || 0) * r);
      lines.push(`商品總計：NT$${total.toLocaleString("zh-TW")}`);
    } else {
      lines.push(`商品總計：NT$—`);
    }
    lines.push("");
    lines.push("已複製完成，請直接回傳到官方LINE登記建立訂單");

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
                          const r = toNumberOrNull(rate);
                          const jpyUnit = toNumberOrNull(it.price) || 0;
                          const qty = Number(it.qty || 0);
                          const jpyLine = jpyUnit * qty;
                          const twdText =
                            r != null
                              ? `NT$${Math.round(jpyLine * r).toLocaleString("zh-TW")}`
                              : "";

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
                <p className="text-base font-semibold">{totalTWD || "—"}</p>
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
  const { products, rate, loading, error } = useProducts();
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
    const addQty = Math.max(1, Number(qty || 1));
    setCartItems((prev) => {
      const idx = prev.findIndex((x) => x.key === key);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + addQty };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          name: product.name,
          variant: product.variant || "",
          price: product.price,
          image: product.image || "",
          qty: addQty,
        },
      ];
    });
    setCartOpen(true);
  }

  function incItem(key) {
    setCartItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, qty: it.qty + 1 } : it))
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
      />
      <CategorySidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        searchKeyword={sidebarSearch}
        onSearchChange={setSidebarSearch}
        onNavigate={handleMenuNavigate}
        selectedCharacter={homeParams.character || ""}
      />
      {page}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
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


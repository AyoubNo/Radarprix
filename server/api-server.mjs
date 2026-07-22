import http from "node:http";
import { readFile } from "node:fs/promises";

const PORT = 3500;
const CACHE_TTL_MS = 30 * 60 * 1000;
const SOURCES = [
  { key: "pc", label: "PC & Gaming", api: "http://127.0.0.1:3300" },
  { key: "home", label: "Maison & Électroménager", api: "http://127.0.0.1:3400" },
];

const PC_CATEGORY_NAMES = new Set([
  "alimentations", "boitiers", "bureaux gaming", "cables adaptateurs", "cartes graphiques", "cartes meres",
  "casques audio", "chaises gaming", "claviers", "consoles jeux", "eclairage rgb", "ecrans", "gaming consoles",
  "impression", "informatique", "manettes simulation", "memoire ram", "mobiles tablettes", "onduleurs energie",
  "pc de bureau", "pc portables", "processeurs", "realite virtuelle", "refroidissement", "reseau", "souris tapis",
  "stockage", "streaming creation", "supports ergonomie",
]);
const HOME_CATEGORY_NAMES = new Set([
  "aspirateurs entretien", "beaute bien etre", "climatisation chauffage", "cuisson fours", "lavage sechage",
  "lave vaisselle", "petit electromenager", "refrigerateurs congelateurs",
]);
const PC_PRODUCT_PATTERNS = [
  /\b(gaming|gamer|playstation|ps[345]|xbox|nintendo|switch|console|manette|gamepad|controller|joystick)\b/,
  /\b(pc|laptop|notebook|ordinateur|processeur|carte graphique|carte mere|geforce|radeon|rtx\s*\d|gtx\s*\d)\b/,
  /\b(clavier|keyboard|souris|mouse|webcam|routeur|router|imprimante|scanner|ssd|disque dur|memoire ram)\b/,
];

let cache = { deals: [], rawDealCount: 0, fetchedAt: 0, warnings: [], loading: null };

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classifyUniverse(product, source) {
  const category = normalize(product.category);
  const searchable = normalize(`${product.name || ""} ${product.category || ""}`);
  if (PC_CATEGORY_NAMES.has(category)) return "pc";
  if (PC_PRODUCT_PATTERNS.some((pattern) => pattern.test(searchable))) return "pc";
  if (HOME_CATEGORY_NAMES.has(category)) return "home";
  return source.key;
}

function getUniverseLabel(universe) {
  return SOURCES.find((source) => source.key === universe)?.label || SOURCES[1].label;
}

const MATCH_STOP_WORDS = new Set([
  "a", "au", "aux", "avec", "de", "des", "du", "et", "en", "la", "le", "les", "pour", "sans",
  "edition", "gaming", "gamer", "noir", "noire", "black", "blanc", "blanche", "white", "gris", "grise",
  "rouge", "bleu", "blue", "vert", "pack", "produit", "smart", "wifi", "rgb", "led", "uhd", "fhd",
]);
const KNOWN_BRANDS = new Set([
  "acer", "aeg", "amd", "apple", "arktek", "asus", "awei", "be quiet", "beko", "biostar", "bosch",
  "braun", "candy", "canon", "cooler master", "corsair", "dell", "deepcool", "electrolux", "energy sistem",
  "epson", "gainward", "gigabyte", "haier", "hisense", "hp", "huawei", "hybrok", "intel", "jbl", "kingston",
  "lenovo", "lg", "logitech", "mars gaming", "midea", "msi", "moulinex", "nextlevel", "ninja", "nintendo",
  "nvidia", "nzxt", "panasonic", "philips", "pny", "rapoo", "razer", "realme", "rowenta", "samsung",
  "severin", "sharp", "solac", "sony", "spirit of gamer", "taurus", "tefal", "thermaltake", "toshiba",
  "ultragear", "ufesa", "whirlpool", "xiaomi", "xtrmlab", "zotac",
]);
const GENERIC_LEADING_WORDS = new Set([
  "accessoire", "adaptateur", "aspirateur", "aspirette", "barre", "batterie", "boitier", "bouilloire", "cable",
  "cafetiere", "camera", "casque", "chaise", "clavier", "congelateur", "ecouteurs", "ecran", "fer", "friteuse",
  "four", "gsm", "hotel", "imprimante", "kit", "laptop", "lave", "machine", "manette", "micro", "moniteur",
  "ordinateur", "pack", "pc", "penderie", "poele", "processeur", "purificateur", "refrigerateur", "set", "souris",
  "tablette", "telephone", "televiseur", "tv", "ventilateur",
]);
const IMPORTANT_VARIANTS = new Set(["digital", "max", "plus", "pro", "slim", "super", "ti", "ultra", "xt", "x3d"]);

function matchMetadata(name) {
  const normalizedName = normalize(name);
  const tokens = normalizedName.split(" ").filter((token) => token.length >= 2 && !MATCH_STOP_WORDS.has(token));
  const tokenSet = new Set(tokens);
  const codes = new Set(tokens.filter((token) => {
    if (/^\d{4}$/.test(token) && Number(token) >= 2020 && Number(token) <= 2035) return false;
    if (/^\d+(go|gb|tb|hz|w|l|cm|mm|pcs?)$/.test(token)) return false;
    if (["4k", "8k", "ddr4", "ddr5", "4in1", "3in1", "2in1"].includes(token)) return false;
    return /^(?=.*\d)[a-z0-9]{3,}$/.test(token) || /^\d{4,}$/.test(token);
  }));
  const brands = new Set([...KNOWN_BRANDS].filter((brand) => normalizedName.includes(brand)));
  const firstToken = tokens[0];
  if (firstToken && firstToken.length >= 3 && !GENERIC_LEADING_WORDS.has(firstToken)) brands.add(firstToken);
  const variants = new Set(tokens.filter((token) => IMPORTANT_VARIANTS.has(token)));
  const specs = new Set(tokens.filter((token) => /^\d+(gb|go|tb)$/.test(token)).map((token) => {
    const match = token.match(/^(\d+)(gb|go|tb)$/);
    return match[2] === "tb" ? `${Number(match[1]) * 1000}gb` : `${match[1]}gb`;
  }));
  return { normalizedName, tokens: tokenSet, codes, brands, variants, specs };
}

function matchConfidence(left, right) {
  if (left.normalizedName === right.normalizedName) return 1;
  if (left.brands.size && right.brands.size && ![...left.brands].some((brand) => right.brands.has(brand))) return 0;
  if (left.variants.size || right.variants.size) {
    const sameVariants = left.variants.size === right.variants.size && [...left.variants].every((variant) => right.variants.has(variant));
    if (!sameVariants) return 0;
  }
  if (left.specs.size && right.specs.size) {
    const sameSpecs = left.specs.size === right.specs.size && [...left.specs].every((spec) => right.specs.has(spec));
    if (!sameSpecs) return 0;
  }
  const sharedCodes = [...left.codes].filter((token) => right.codes.has(token));
  if (left.codes.size && right.codes.size && !sharedCodes.length) return 0;
  const intersection = [...left.tokens].filter((token) => right.tokens.has(token)).length;
  const union = new Set([...left.tokens, ...right.tokens]).size;
  const jaccard = union ? intersection / union : 0;
  const overlap = Math.min(left.tokens.size, right.tokens.size)
    ? intersection / Math.min(left.tokens.size, right.tokens.size)
    : 0;
  if (sharedCodes.length && intersection >= 2) return Math.min(0.99, 0.82 + jaccard * 0.17);
  if (intersection >= 4 && jaccard >= 0.56) return 0.8 + jaccard * 0.15;
  if (intersection >= 3 && overlap >= 0.82 && jaccard >= 0.5) return 0.78 + jaccard * 0.15;
  return 0;
}

function toOffer(product, source) {
  const price = Number(product.priceCents);
  if (!Number.isFinite(price) || price <= 0 || !product.productUrl) return null;
  const universe = classifyUniverse(product, source);
  return {
    key: `${source.key}-${product.site}-${product.id}`,
    universe,
    universeLabel: getUniverseLabel(universe),
    site: product.site,
    name: product.name,
    category: product.category,
    priceCents: price,
    originalPriceCents: Number(product.originalPriceCents) || null,
    availability: product.availability,
    productUrl: product.productUrl,
    imageProxyUrl: product.imageUrl
      ? `/api/image?source=${source.key}&url=${encodeURIComponent(product.imageUrl)}`
      : null,
  };
}

function attachComparisonsAndDedupe(deals, offers) {
  const metadata = new Map();
  const tokenIndex = new Map();
  for (const offer of offers) {
    const meta = matchMetadata(offer.name);
    metadata.set(offer.key, meta);
    for (const token of meta.tokens) {
      if (!tokenIndex.has(token)) tokenIndex.set(token, []);
      tokenIndex.get(token).push(offer);
    }
  }

  const dealKeys = new Set(deals.map((deal) => deal.key));
  const claimedDeals = new Set();
  const grouped = [];
  for (const deal of deals) {
    if (claimedDeals.has(deal.key)) continue;
    const dealMeta = metadata.get(deal.key) || matchMetadata(deal.name);
    const usefulTokens = [...dealMeta.tokens]
      .filter((token) => (tokenIndex.get(token)?.length || 0) <= 250)
      .sort((a, b) => {
        const aCode = dealMeta.codes.has(a) ? 1 : 0;
        const bCode = dealMeta.codes.has(b) ? 1 : 0;
        return bCode - aCode || (tokenIndex.get(a)?.length || 0) - (tokenIndex.get(b)?.length || 0) || b.length - a.length;
      })
      .slice(0, 5);
    const candidates = new Map();
    for (const token of usefulTokens) {
      for (const offer of tokenIndex.get(token) || []) {
        if (offer.key !== deal.key && offer.site !== deal.site) candidates.set(offer.key, offer);
      }
    }

    const bestBySite = new Map();
    for (const offer of candidates.values()) {
      const confidence = matchConfidence(dealMeta, metadata.get(offer.key));
      if (confidence < 0.86) continue;
      const previous = bestBySite.get(offer.site);
      if (!previous || offer.priceCents < previous.priceCents) bestBySite.set(offer.site, { ...offer, confidence: Math.round(confidence * 100) });
    }
    const comparisons = [...bestBySite.values()]
      .sort((a, b) => (a.availability === "in_stock" ? 0 : 1) - (b.availability === "in_stock" ? 0 : 1) || a.priceCents - b.priceCents)
      .slice(0, 7);
    for (const offer of comparisons) if (dealKeys.has(offer.key)) claimedDeals.add(offer.key);
    claimedDeals.add(deal.key);
    const merchantCount = new Set([deal.site, ...comparisons.map((offer) => offer.site)]).size;
    const bestPriceCents = Math.min(deal.priceCents, ...comparisons.filter((offer) => offer.availability === "in_stock").map((offer) => offer.priceCents));
    const universe = [deal, ...comparisons].some((offer) => offer.universe === "pc") ? "pc" : "home";
    grouped.push({ ...deal, universe, universeLabel: getUniverseLabel(universe), comparisons, merchantCount, bestPriceCents });
  }
  return grouped;
}

function scoreDeal(product, source) {
  const price = Number(product.priceCents);
  const original = Number(product.originalPriceCents);
  if (!Number.isFinite(price) || !Number.isFinite(original) || price <= 0 || original <= price) return null;

  const savings = Math.max(0, original - price);
  const calculatedDiscount = (savings / original) * 100;
  const discount = Number.isFinite(Number(product.discountPercent))
    ? Number(product.discountPercent)
    : calculatedDiscount;
  if (discount < 3 || discount > 90 || savings < 1000) return null;

  const savingsMad = savings / 100;
  const discountScore = Math.min(discount, 65) / 65 * 50;
  const savingsScore = Math.min(1, Math.log10(1 + savingsMad) / 4) * 24;
  const stockScore = product.availability === "in_stock" ? 18 : product.availability === "unknown" ? 5 : 0;
  const scrapedTime = Date.parse(product.scrapedAt || "");
  const ageDays = Number.isFinite(scrapedTime) ? (Date.now() - scrapedTime) / 86400000 : 99;
  const freshnessScore = ageDays <= 2 ? 8 : ageDays <= 7 ? 5 : 2;
  const suspiciousPenalty = discount > 80 ? 12 : 0;
  const score = Math.max(0, Math.min(100, Math.round(discountScore + savingsScore + stockScore + freshnessScore - suspiciousPenalty)));
  const quality = score >= 85 ? "Exceptionnelle" : score >= 72 ? "Excellente" : score >= 60 ? "Très bonne" : "Bonne";
  const universe = classifyUniverse(product, source);

  return {
    ...product,
    key: `${source.key}-${product.site}-${product.id}`,
    universe,
    universeLabel: getUniverseLabel(universe),
    score,
    quality,
    priceCents: price,
    originalPriceCents: original,
    savingsCents: savings,
    discountPercent: Math.round(discount * 10) / 10,
    imageProxyUrl: product.imageUrl
      ? `/api/image?source=${source.key}&url=${encodeURIComponent(product.imageUrl)}`
      : null,
  };
}

async function fetchPage(source, page) {
  const url = `${source.api}/api/products?sort=name_asc&limit=200&page=${page}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${source.label}: HTTP ${response.status}`);
  return response.json();
}

async function fetchSource(source) {
  let products;
  let warning = null;
  try {
    const first = await fetchPage(source, 1);
    const pages = Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => index + 2);
    products = [...first.products];
    for (let index = 0; index < pages.length; index += 6) {
      const batch = await Promise.all(pages.slice(index, index + 6).map((page) => fetchPage(source, page)));
      for (const result of batch) products.push(...result.products);
    }
  } catch (liveError) {
    try {
      const snapshot = JSON.parse(await readFile(new URL(`../data/${source.key}-products.json`, import.meta.url), "utf8"));
      products = Array.isArray(snapshot.products) ? snapshot.products : [];
      warning = `${source.label}: copie locale du ${new Date(snapshot.exportedAt).toLocaleDateString("fr-MA")} utilisée`;
    } catch {
      throw liveError;
    }
  }
  return {
    deals: products.filter((product) => product.onSale).map((product) => scoreDeal(product, source)).filter(Boolean),
    offers: products.map((product) => toOffer(product, source)).filter(Boolean),
    warning,
  };
}

async function refreshDeals(force = false) {
  if (!force && cache.deals.length && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (cache.loading) return cache.loading;

  cache.loading = (async () => {
    const settled = await Promise.allSettled(SOURCES.map((source) => fetchSource(source)));
    const warnings = [];
    const deals = [];
    const offers = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        deals.push(...result.value.deals);
        offers.push(...result.value.offers);
        if (result.value.warning) warnings.push(result.value.warning);
      }
      else warnings.push(`${SOURCES[index].label} indisponible: ${result.reason?.message || "erreur inconnue"}`);
    });
    if (!deals.length && cache.deals.length) return { ...cache, warnings };
    deals.sort((a, b) => b.score - a.score || b.savingsCents - a.savingsCents || b.discountPercent - a.discountPercent);
    const groupedDeals = attachComparisonsAndDedupe(deals, offers);
    cache = { deals: groupedDeals, rawDealCount: deals.length, fetchedAt: Date.now(), warnings, loading: null };
    return cache;
  })();

  try {
    return await cache.loading;
  } finally {
    cache.loading = null;
  }
}

async function getDealsForRequest() {
  if (!cache.deals.length) return refreshDeals(false);
  if (Date.now() - cache.fetchedAt >= CACHE_TTL_MS && !cache.loading) {
    void refreshDeals(true).catch((error) => {
      const message = `Actualisation en arrière-plan impossible: ${error?.message || "erreur inconnue"}`;
      cache = { ...cache, warnings: [...new Set([...cache.warnings, message])], loading: null };
    });
  }
  return cache;
}

function filterDeals(deals, params) {
  const q = normalize(params.get("q") || "");
  const universe = params.get("universe") || "all";
  const site = params.get("site") || "all";
  const category = params.get("category") || "all";
  const availability = params.get("availability") || "in_stock";
  const minPriceCents = Math.max(0, Number(params.get("minPrice") || 0) * 100);
  const maxPriceCents = Math.max(0, Number(params.get("maxPrice") || 0) * 100);
  const minDiscount = Number(params.get("minDiscount") || 0);
  return deals.filter((deal) => {
    if (universe !== "all" && deal.universe !== universe) return false;
    if (site !== "all" && deal.site !== site && !deal.comparisons.some((offer) => offer.site === site)) return false;
    if (category !== "all" && deal.category !== category) return false;
    if (availability !== "all" && deal.availability !== availability) return false;
    if (minPriceCents && deal.priceCents < minPriceCents) return false;
    if (maxPriceCents && deal.priceCents > maxPriceCents) return false;
    if (deal.discountPercent < minDiscount) return false;
    if (q && !normalize(`${deal.name} ${deal.category} ${deal.site} ${deal.comparisons.map((offer) => `${offer.name} ${offer.site}`).join(" ")}`).includes(q)) return false;
    return true;
  });
}

function sortDeals(deals, sort) {
  const sorted = [...deals];
  if (sort === "discount_desc") sorted.sort((a, b) => b.discountPercent - a.discountPercent || b.score - a.score);
  else if (sort === "savings_desc") sorted.sort((a, b) => b.savingsCents - a.savingsCents || b.score - a.score);
  else if (sort === "price_asc") sorted.sort((a, b) => a.priceCents - b.priceCents);
  else sorted.sort((a, b) => b.score - a.score || b.savingsCents - a.savingsCents);
  return sorted;
}

async function proxyImage(url, response) {
  const sourceKey = url.searchParams.get("source");
  const imageUrl = url.searchParams.get("url");
  const source = SOURCES.find((item) => item.key === sourceKey);
  if (!source || !imageUrl || !/^https?:\/\//i.test(imageUrl)) return json(response, 400, { error: "Image invalide" });
  const upstream = await fetch(`${source.api}/api/image?url=${encodeURIComponent(imageUrl)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!upstream.ok || !upstream.body) return json(response, upstream.status || 502, { error: "Image indisponible" });
  response.writeHead(200, {
    "content-type": upstream.headers.get("content-type") || "image/jpeg",
    "cache-control": "public, max-age=86400",
  });
  for await (const chunk of upstream.body) response.write(chunk);
  response.end();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, cachedDeals: cache.deals.length, fetchedAt: cache.fetchedAt || null, sources: SOURCES });
    }
    if (request.method === "GET" && url.pathname === "/api/image") return await proxyImage(url, response);
    if (request.method === "POST" && url.pathname === "/api/refresh") {
      const result = await refreshDeals(true);
      return json(response, 200, { ok: true, total: result.deals.length, fetchedAt: result.fetchedAt, warnings: result.warnings });
    }
    if (request.method === "GET" && url.pathname === "/api/deals") {
      const state = await getDealsForRequest();
      const filtered = filterDeals(state.deals, url.searchParams);
      const sorted = sortDeals(filtered, url.searchParams.get("sort") || "score_desc");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(60, Math.max(12, Number(url.searchParams.get("limit") || 24)));
      const start = (page - 1) * limit;
      const sites = [...new Set(state.deals.flatMap((deal) => [deal.site, ...deal.comparisons.map((offer) => offer.site)]))].sort((a, b) => a.localeCompare(b, "fr"));
      const categories = [...new Set(state.deals.map((deal) => deal.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      const inStock = state.deals.filter((deal) => deal.availability === "in_stock").length;
      const maxSavings = state.deals.reduce((max, deal) => Math.max(max, deal.savingsCents), 0);
      return json(response, 200, {
        deals: sorted.slice(start, start + limit).map((deal, index) => ({ ...deal, rank: start + index + 1 })),
        total: sorted.length,
        page,
        totalPages: Math.max(1, Math.ceil(sorted.length / limit)),
        options: { sites, categories },
        stats: { analyzed: state.rawDealCount || state.deals.length, inStock, stores: sites.length, maxSavings, updatedAt: state.fetchedAt },
        warnings: state.warnings,
      });
    }
    return json(response, 404, { error: "Route introuvable" });
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: error?.message || "Erreur serveur" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PrixRadar API: http://127.0.0.1:${PORT}`);
});

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { promisify } from "node:util";
import {
  USER_AGENT,
  attr,
  decodeHtml,
  fetchJson,
  fetchText,
  parseAvailability,
  parsePriceCents,
  productNameFromUrl,
  sleep,
  textContent,
} from "./common.mjs";

const execFileAsync = promisify(execFile);
const ELECTROPLANET_COOKIE_JAR = path.join(process.cwd(), "data", "electroplanet-cookies.txt");
const ELECTROPLANET_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export const HOME_SOURCES = [
  { site: "Electroplanet", type: "electroplanet", url: "https://www.electroplanet.ma" },
  { site: "Electro Bousfiha", type: "prestashop", url: "https://electrobousfiha.com" },
  { site: "Biougnach", type: "biougnach", url: "https://www.biougnach.ma" },
  { site: "Brands Corners", type: "woocommerce", url: "https://brandscorners.ma" },
];

async function fetchTextWithCurl(url) {
  await fs.mkdir(path.dirname(ELECTROPLANET_COOKIE_JAR), { recursive: true });
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    command,
    [
      "-L", "--fail", "--silent", "--show-error", "--compressed", "--max-time", "90",
      "--retry", "6", "--retry-delay", "3", "--retry-max-time", "210", "--retry-all-errors",
      "--cookie", ELECTROPLANET_COOKIE_JAR, "--cookie-jar", ELECTROPLANET_COOKIE_JAR,
      "-e", "https://www.electroplanet.ma/", "-A", USER_AGENT, url,
    ],
    { encoding: "utf8", maxBuffer: 24 * 1024 * 1024, windowsHide: true },
  );
  return stdout;
}

async function fetchSourceText(url) {
  if (new URL(url).hostname.endsWith("electroplanet.ma")) {
    try {
      return await fetchTextWithCurl(url);
    } catch {
      return fetchText(url, { timeout: 60_000 });
    }
  }
  return fetchText(url);
}

function parsePrestaCard(card, sourcePage) {
  const externalId = attr(card.match(/<article[^>]*>/i)?.[0] || card, "data-id-product");
  const link =
    card.match(/<a[^>]+(?:class=["'][^"']*product-thumbnail[^"']*["'][^>]*href|href)=["'](https?:\/\/[^"']+\.html(?:\?[^"']*)?)["']/i)?.[1]
    || card.match(/href=["'](https?:\/\/[^"']+\.html(?:\?[^"']*)?)["']/i)?.[1];
  if (!link) return null;

  const nameHtml =
    card.match(/itemprop=["']name["'][^>]*>([\s\S]*?)<\//i)?.[1]
    || card.match(/class=["'][^"']*product-title[^"']*["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const priceRaw =
    card.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || card.match(/<span[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
  const regularPriceRaw = card.match(/<span[^>]*class=["'][^"']*regular-price[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
  const imageTag = card.match(/<img[^>]+(?:itemprop=["']image["']|product-defult-img|product-thumbnail)[^>]*>/i)?.[0]
    || card.match(/<img[^>]*>/i)?.[0];
  const priceCents = parsePriceCents(priceRaw);
  const regularPriceCents = parsePriceCents(regularPriceRaw);
  const originalPriceCents = Number.isFinite(priceCents)
    && Number.isFinite(regularPriceCents)
    && regularPriceCents > priceCents
    ? regularPriceCents
    : null;

  return {
    externalId: externalId || link.match(/\/(\d+)-[^/]+\.html/)?.[1] || null,
    name: textContent(nameHtml) || productNameFromUrl(link),
    brand: null,
    sourceCategory: null,
    priceCents,
    originalPriceCents,
    availability: parseAvailability(card),
    productUrl: decodeHtml(link),
    imageUrl: imageTag ? decodeHtml(attr(imageTag, "src") || attr(imageTag, "data-src") || "") : null,
    sourcePage,
    scrapedAt: new Date().toISOString(),
  };
}

function parsePrestashopPage(html, pageNumber) {
  if (html.trimStart().startsWith("{")) {
    const payload = JSON.parse(html);
    const items = Array.isArray(payload.products) ? payload.products : [];
    const products = items.map((product) => {
      const priceCents = Number.isFinite(Number(product.price_amount))
        ? Math.round(Number(product.price_amount) * 100)
        : parsePriceCents(product.price);
      const regularPriceCents = Number.isFinite(Number(product.regular_price_amount))
        ? Math.round(Number(product.regular_price_amount) * 100)
        : parsePriceCents(product.regular_price);
      const originalPriceCents = Number.isFinite(priceCents)
        && Number.isFinite(regularPriceCents)
        && regularPriceCents > priceCents
        ? regularPriceCents
        : null;
      return {
        externalId: String(product.id_product || product.id || "") || null,
        name: decodeHtml(product.name || "") || productNameFromUrl(product.url || product.link || ""),
        brand: decodeHtml(product.manufacturer_name || product.brand || "") || null,
        sourceCategory: decodeHtml(product.category_name || "") || null,
        priceCents,
        originalPriceCents,
        availability: product.add_to_cart_url ? "in_stock" : "out_of_stock",
        productUrl: product.url || product.canonical_url || product.link,
        imageUrl: product.cover?.medium?.url
          || product.cover?.large?.url
          || product.cover?.bySize?.home_default?.url
          || null,
        sourcePage: pageNumber,
        scrapedAt: new Date().toISOString(),
      };
    }).filter((product) => product.productUrl && product.name);
    return {
      products,
      reported: Number(payload.pagination?.total_items || 0),
      totalPages: Number(payload.pagination?.pages_count || 1),
    };
  }

  const cards = [...html.matchAll(/<article\s+class=["'][^"']*js-product-miniature[^>]*>[\s\S]*?<\/article>/gi)];
  const products = cards.map((match) => parsePrestaCard(match[0], pageNumber)).filter(Boolean);
  const reported = Number(
    html.match(/(?:Il y a\s+|Affichage\s+\d+\s*-\s*\d+\s+de\s+)(\d[\d\s]*)\s+(?:produits?|article)/i)?.[1]?.replace(/\s/g, "") || 0,
  );
  const pageNumbers = [...html.matchAll(/[?&](?:page|p)=(\d+)/gi)].map((match) => Number(match[1]));
  const totalPages = Math.max(1, ...pageNumbers, reported ? Math.ceil(reported / Math.max(1, products.length)) : 1);
  return { products, reported, totalPages };
}

async function crawlPrestashop(source, onProgress) {
  const first = parsePrestashopPage(await fetchSourceText(`${source.url}/2-accueil`), 1);
  if (!first.products.length || first.totalPages < 1) {
    throw new Error("La page catalogue PrestaShop n'a pas pu être analysée.");
  }

  const byUrl = new Map(first.products.map((product) => [product.productUrl, product]));
  onProgress?.({ page: 1, totalPages: first.totalPages, products: byUrl.size });
  const pageNumbers = Array.from({ length: first.totalPages - 1 }, (_, index) => index + 2);
  for (let offset = 0; offset < pageNumbers.length; offset += 5) {
    const batch = pageNumbers.slice(offset, offset + 5);
    const pages = await Promise.all(batch.map(async (page) => ({
      page,
      ...parsePrestashopPage(await fetchSourceText(`${source.url}/2-accueil?page=${page}`), page),
    })));
    for (const result of pages) {
      for (const product of result.products) byUrl.set(product.productUrl, product);
    }
    onProgress?.({ page: batch.at(-1), totalPages: first.totalPages, products: byUrl.size });
    await sleep(200);
  }

  const products = [...byUrl.values()];
  if (first.reported && products.length < first.reported * 0.80) {
    throw new Error(`Collecte incomplète (${products.length}/${first.reported}).`);
  }
  return { products, pages: first.totalPages, reported: first.reported || products.length };
}

function splitMagentoCards(html) {
  const markers = [...html.matchAll(/<li\s+class=["'][^"']*\bproduct-item\b[^"']*["'][^>]*>/gi)];
  return markers.map((marker, index) => html.slice(marker.index, markers[index + 1]?.index || html.length));
}

function parseElectroplanetPage(html, pageNumber) {
  const products = splitMagentoCards(html).map((card) => {
    const infoTag = card.match(/<div[^>]*class=["'][^"']*product-item-info[^"']*["'][^>]*>/i)?.[0] || "";
    const link = card.match(/<a[^>]*class=["'][^"']*product-item-link[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
      || card.match(/<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*product-item-link/i)?.[1];
    if (!link) return null;
    const imageTag = card.match(/<img[^>]*class=["'][^"']*product-image-photo[^"']*["'][^>]*>/i)?.[0] || "";
    const finalPriceTag = card.match(/<span[^>]*data-price-type=["']finalPrice["'][^>]*>/i)?.[0] || "";
    const oldPriceTag = card.match(/<span[^>]*data-price-type=["']oldPrice["'][^>]*>/i)?.[0] || "";
    const priceCents = parsePriceCents(attr(finalPriceTag, "data-price-amount"));
    const regularPriceCents = parsePriceCents(attr(oldPriceTag, "data-price-amount"));
    const originalPriceCents = Number.isFinite(priceCents)
      && Number.isFinite(regularPriceCents)
      && regularPriceCents > priceCents
      ? regularPriceCents
      : null;
    const imageAlt = decodeHtml(attr(imageTag, "alt") || "");
    const linkText = textContent(card.match(/<a[^>]*class=["'][^"']*product-item-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const brand = textContent(card.match(/<span[^>]*class=["'][^"']*brand[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    return {
      externalId: attr(infoTag, "data-product-sku") || link.match(/\/p(\d+)-/i)?.[1] || null,
      name: imageAlt || linkText || productNameFromUrl(link),
      brand: brand || null,
      sourceCategory: null,
      priceCents,
      originalPriceCents,
      availability: parseAvailability(card),
      productUrl: decodeHtml(link),
      imageUrl: decodeHtml(
        attr(imageTag, "src")
        || attr(imageTag, "data-src")
        || attr(imageTag, "data-lazy")
        || attr(imageTag, "data-original")
        || "",
      ) || null,
      sourcePage: pageNumber,
      scrapedAt: new Date().toISOString(),
    };
  }).filter(Boolean);
  const reported = Number(html.match(/toolbar-number[^>]*>\s*([\d\s]+)/i)?.[1]?.replace(/\s/g, "") || 0);
  return { products, reported };
}

async function crawlElectroplanetHttp(source, onProgress) {
  const pageUrl = (page) => `${source.url}/recherche?q=%2A&product_list_limit=60&p=${page}`;
  const first = parseElectroplanetPage(await fetchSourceText(pageUrl(1)), 1);
  if (!first.products.length) throw new Error("Le catalogue Electroplanet n'a pas pu être analysé.");
  const totalPages = Math.max(1, Math.ceil((first.reported || first.products.length) / first.products.length));
  const byUrl = new Map(first.products.map((product) => [product.productUrl, product]));
  onProgress?.({ page: 1, totalPages, products: byUrl.size });

  for (let page = 2; page <= totalPages; page += 1) {
    const result = parseElectroplanetPage(await fetchSourceText(pageUrl(page)), page);
    for (const product of result.products) byUrl.set(product.productUrl, product);
    onProgress?.({ page, totalPages, products: byUrl.size });
    await sleep(1200);
  }

  const products = [...byUrl.values()];
  if (first.reported && products.length < first.reported * 0.80) {
    throw new Error(`Collecte Electroplanet incomplète (${products.length}/${first.reported}).`);
  }
  return { products, pages: totalPages, reported: first.reported || products.length };
}

async function findChromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Essaie le chemin suivant; le collecteur HTTP reste disponible en repli.
    }
  }
  throw new Error("Chromium est introuvable (définir CHROMIUM_PATH si nécessaire).");
}

async function readElectroplanetBrowserPage(page, url, pageNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector("li.product-item", { timeout: 35_000 });
      const parsed = parseElectroplanetPage(await page.content(), pageNumber);
      if (!parsed.products.length) throw new Error("page catalogue vide");
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(2500 * attempt);
    }
  }
  throw lastError;
}

async function crawlElectroplanetBrowser(source, onProgress) {
  const executablePath = await findChromiumExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 120_000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--lang=fr-FR",
      `--user-agent=${ELECTROPLANET_BROWSER_USER_AGENT}`,
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7" });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["font", "image", "media", "stylesheet"].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    const pageUrl = (pageNumber, direction) => (
      `${source.url}/recherche?q=%2A&product_list_limit=60&product_list_order=price&product_list_dir=${direction}&p=${pageNumber}`
    );
    const first = await readElectroplanetBrowserPage(page, pageUrl(1, "asc"), 1);
    const reportedPages = Math.max(1, Math.ceil((first.reported || first.products.length) / first.products.length));
    // Magento/Elasticsearch refuse les résultats au-delà de la fenêtre de 2 400 articles.
    // Les premières pages triées dans les deux sens couvrent alors les deux extrémités du catalogue.
    const ascendingPages = Math.min(40, reportedPages);
    const descendingPages = reportedPages > ascendingPages ? Math.min(10, reportedPages) : 0;
    const totalPages = ascendingPages + descendingPages;
    const byUrl = new Map(first.products.map((product) => [product.productUrl, product]));
    onProgress?.({ page: 1, totalPages, products: byUrl.size });

    for (let pageNumber = 2; pageNumber <= ascendingPages; pageNumber += 1) {
      const result = await readElectroplanetBrowserPage(page, pageUrl(pageNumber, "asc"), pageNumber);
      for (const product of result.products) byUrl.set(product.productUrl, product);
      onProgress?.({ page: pageNumber, totalPages, products: byUrl.size });
      await sleep(650);
    }

    for (let pageNumber = 1; pageNumber <= descendingPages; pageNumber += 1) {
      const progressPage = ascendingPages + pageNumber;
      const result = await readElectroplanetBrowserPage(
        page,
        pageUrl(pageNumber, "desc"),
        progressPage,
      );
      for (const product of result.products) byUrl.set(product.productUrl, product);
      onProgress?.({ page: progressPage, totalPages, products: byUrl.size });
      await sleep(650);
    }

    const products = [...byUrl.values()];
    if (first.reported && products.length < first.reported * 0.90) {
      throw new Error(`Collecte Electroplanet incomplète (${products.length}/${first.reported}).`);
    }
    return { products, pages: totalPages, reported: first.reported || products.length };
  } finally {
    await browser.close();
  }
}

async function crawlElectroplanet(source, onProgress) {
  try {
    return await crawlElectroplanetBrowser(source, onProgress);
  } catch (browserError) {
    const detail = browserError instanceof Error ? browserError.message : String(browserError);
    console.warn(`[Electroplanet] Navigation Chromium indisponible: ${detail}. Repli HTTP.`);
    return crawlElectroplanetHttp(source, onProgress);
  }
}

function wooPriceToCents(raw, minorUnit = 0) {
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * (10 ** Math.max(0, 2 - Number(minorUnit || 0))));
}

function parseWooProduct(product, sourcePage) {
  const minorUnit = Number(product.prices?.currency_minor_unit || 0);
  const priceCents = wooPriceToCents(product.prices?.price, minorUnit);
  const regularPriceCents = wooPriceToCents(product.prices?.regular_price, minorUnit);
  const originalPriceCents = Number.isFinite(priceCents)
    && Number.isFinite(regularPriceCents)
    && regularPriceCents > priceCents
    ? regularPriceCents
    : null;
  const topCategory = product.categories?.find((category) => {
    const categoryPath = String(category.link || "").split("/categorie-produit/")[1] || "";
    return categoryPath.split("/").filter(Boolean).length === 1;
  }) || product.categories?.[0];
  return {
    externalId: String(product.sku || product.id || "") || null,
    name: decodeHtml(product.name || ""),
    brand: decodeHtml(product.brands?.[0]?.name || product.tags?.[0]?.name || "") || null,
    sourceCategory: decodeHtml(topCategory?.name || "") || null,
    priceCents,
    originalPriceCents,
    availability: product.is_in_stock ? "in_stock" : "out_of_stock",
    productUrl: product.permalink,
    imageUrl: product.images?.[0]?.src || product.images?.[0]?.thumbnail || null,
    sourcePage,
    scrapedAt: new Date().toISOString(),
  };
}

async function crawlWooCommerce(source, onProgress) {
  const pageUrl = (page) => `${source.url}/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
  const firstResponse = await fetchJson(pageUrl(1));
  const firstItems = Array.isArray(firstResponse.data) ? firstResponse.data : [];
  if (!firstItems.length) throw new Error("Le catalogue WooCommerce n'a pas pu être lu.");
  const reported = Number(firstResponse.headers.get("x-wp-total") || firstItems.length);
  const totalPages = Number(firstResponse.headers.get("x-wp-totalpages") || Math.ceil(reported / 100));
  const products = firstItems.map((product) => parseWooProduct(product, 1));
  onProgress?.({ page: 1, totalPages, products: products.length });

  const pages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
  for (let offset = 0; offset < pages.length; offset += 5) {
    const batch = pages.slice(offset, offset + 5);
    const results = await Promise.all(batch.map(async (page) => {
      const { data } = await fetchJson(pageUrl(page));
      return { page, items: Array.isArray(data) ? data : [] };
    }));
    for (const result of results) {
      products.push(...result.items.map((product) => parseWooProduct(product, result.page)));
    }
    onProgress?.({ page: batch.at(-1), totalPages, products: products.length });
    await sleep(150);
  }
  if (reported && products.length < reported * 0.95) {
    throw new Error(`Collecte Brands Corners incomplète (${products.length}/${reported}).`);
  }
  return { products, pages: totalPages, reported };
}

function parseBiougnachProduct(product, sourcePage, sourceUrl) {
  const priceCents = parsePriceCents(product.price);
  const oldPriceCents = parsePriceCents(product.oldPrice);
  const originalPriceCents = Number.isFinite(priceCents)
    && Number.isFinite(oldPriceCents)
    && oldPriceCents > priceCents
    ? oldPriceCents
    : null;
  const code = String(product.productCode || product.erpId || product.id || "");
  const encodedCode = encodeURIComponent(Buffer.from(code).toString("base64"));
  return {
    externalId: code || null,
    name: decodeHtml(product.name || ""),
    brand: decodeHtml(product.catalogBrand?.brand || "") || null,
    sourceCategory: decodeHtml(product.subCategory?.subCategoryName || product.family?.familyName || "") || null,
    priceCents,
    originalPriceCents,
    availability: Number(product.availableStock) > 0 ? "in_stock" : "out_of_stock",
    productUrl: `${sourceUrl}/shop/product/${encodedCode}`,
    imageUrl: product.pictureFileName || product.pictureUri || null,
    sourcePage,
    scrapedAt: new Date().toISOString(),
  };
}

async function crawlBiougnach(source, onProgress) {
  const pageSize = 100;
  const endpoint = `${source.url}/webapigw/api/v1/c/Catalog/FilterItemsAsync/`;
  const pageUrl = (page) => `${endpoint}?PageIndex=${page - 1}&pageSize=${pageSize}&MaxPrice=0&MinPrice=0`;
  const { data: first } = await fetchJson(pageUrl(1));
  const firstItems = Array.isArray(first.data) ? first.data : [];
  if (!firstItems.length) throw new Error("Le catalogue Biougnach n'a pas pu être lu.");
  const reported = Number(first.count || first.totalCount || firstItems.length);
  const totalPages = Math.max(1, Math.ceil(reported / pageSize));
  const products = firstItems.map((product) => parseBiougnachProduct(product, 1, source.url));
  onProgress?.({ page: 1, totalPages, products: products.length });

  const pages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
  for (let offset = 0; offset < pages.length; offset += 5) {
    const batch = pages.slice(offset, offset + 5);
    const results = await Promise.all(batch.map(async (page) => {
      const { data } = await fetchJson(pageUrl(page));
      return { page, items: Array.isArray(data.data) ? data.data : [] };
    }));
    for (const result of results) {
      products.push(...result.items.map((product) => parseBiougnachProduct(product, result.page, source.url)));
    }
    onProgress?.({ page: batch.at(-1), totalPages, products: products.length });
    await sleep(150);
  }
  if (reported && products.length < reported * 0.95) {
    throw new Error(`Collecte Biougnach incomplète (${products.length}/${reported}).`);
  }
  return { products, pages: totalPages, reported };
}

const crawlers = {
  electroplanet: crawlElectroplanet,
  prestashop: crawlPrestashop,
  biougnach: crawlBiougnach,
  woocommerce: crawlWooCommerce,
};

export async function crawlHomeSources(onProgress) {
  const results = [];
  for (const source of HOME_SOURCES) {
    onProgress?.({ universe: "home", site: source.site, status: "running", page: 0, products: 0 });
    try {
      const result = await crawlers[source.type](source, (state) => {
        onProgress?.({ universe: "home", site: source.site, status: "running", ...state });
      });
      results.push({ source, ok: true, ...result });
      onProgress?.({
        universe: "home",
        site: source.site,
        status: "done",
        page: result.pages,
        totalPages: result.pages,
        products: result.products.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ source, ok: false, error: message, products: [] });
      onProgress?.({ universe: "home", site: source.site, status: "error", error: message });
    }
  }
  return results;
}


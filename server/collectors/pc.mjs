import {
  attr,
  decodeHtml,
  fetchText,
  parseAvailability,
  parsePriceCents,
  productNameFromUrl,
  sleep,
  textContent,
} from "./common.mjs";

export const PC_SOURCES = [
  { site: "TechSpace", type: "shopify", url: "https://techspace.ma" },
  { site: "UltraPC", type: "prestashop", url: "https://www.ultrapc.ma" },
  { site: "NextLevelPC", type: "prestashop", url: "https://nextlevelpc.ma" },
];

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
  const firstHtml = await fetchText(`${source.url}/2-accueil`, { timeout: 30_000 });
  const first = parsePrestashopPage(firstHtml, 1);
  if (!first.products.length || first.totalPages < 1) {
    throw new Error("La page catalogue PrestaShop n'a pas pu être analysée.");
  }

  const byUrl = new Map(first.products.map((product) => [product.productUrl, product]));
  onProgress?.({ page: 1, totalPages: first.totalPages, products: byUrl.size });

  const pageNumbers = Array.from({ length: first.totalPages - 1 }, (_, index) => index + 2);
  for (let offset = 0; offset < pageNumbers.length; offset += 5) {
    const batch = pageNumbers.slice(offset, offset + 5);
    const pages = await Promise.all(
      batch.map(async (page) => {
        const html = await fetchText(`${source.url}/2-accueil?page=${page}`, { timeout: 30_000 });
        return { page, ...parsePrestashopPage(html, page) };
      }),
    );
    for (const result of pages) {
      for (const product of result.products) byUrl.set(product.productUrl, product);
    }
    onProgress?.({ page: batch.at(-1), totalPages: first.totalPages, products: byUrl.size });
    await sleep(250);
  }

  const products = [...byUrl.values()];
  if (first.reported && products.length < first.reported * 0.85) {
    throw new Error(`Collecte incomplète (${products.length}/${first.reported}).`);
  }
  return { products, pages: first.totalPages, reported: first.reported || products.length };
}

async function crawlShopify(source, onProgress) {
  const products = [];
  for (let page = 1; page <= 100; page += 1) {
    const text = await fetchText(`${source.url}/products.json?limit=250&page=${page}`, { timeout: 30_000 });
    const payload = JSON.parse(text);
    const items = Array.isArray(payload.products) ? payload.products : [];
    if (!items.length) return { products, pages: page - 1, reported: products.length };

    for (const product of items) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const pricedVariant = variants.find((variant) => variant.available) || variants[0];
      const priceCents = parsePriceCents(pricedVariant?.price);
      const compareAtPriceCents = parsePriceCents(pricedVariant?.compare_at_price);
      const originalPriceCents = Number.isFinite(priceCents)
        && Number.isFinite(compareAtPriceCents)
        && compareAtPriceCents > priceCents
        ? compareAtPriceCents
        : null;
      products.push({
        externalId: String(product.id),
        name: decodeHtml(product.title),
        priceCents,
        originalPriceCents,
        availability: variants.some((variant) => variant.available) ? "in_stock" : "out_of_stock",
        productUrl: `${source.url}/products/${product.handle}`,
        imageUrl: product.images?.[0]?.src || product.image?.src || null,
        sourcePage: page,
        sourceUpdatedAt: product.updated_at || null,
        scrapedAt: new Date().toISOString(),
      });
    }
    onProgress?.({ page, totalPages: null, products: products.length });
    if (items.length < 250) return { products, pages: page, reported: products.length };
    await sleep(700);
  }
  throw new Error("Le catalogue Shopify dépasse la limite de sécurité.");
}

export async function crawlPcSources(onProgress) {
  const results = [];
  for (const source of PC_SOURCES) {
    onProgress?.({ universe: "pc", site: source.site, status: "running", page: 0, products: 0 });
    try {
      const crawler = source.type === "shopify" ? crawlShopify : crawlPrestashop;
      const result = await crawler(source, (state) => {
        onProgress?.({ universe: "pc", site: source.site, status: "running", ...state });
      });
      results.push({ source, ok: true, ...result });
      onProgress?.({
        universe: "pc",
        site: source.site,
        status: "done",
        page: result.pages,
        totalPages: result.pages,
        products: result.products.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ source, ok: false, error: message, products: [] });
      onProgress?.({ universe: "pc", site: source.site, status: "error", error: message });
    }
  }
  return results;
}


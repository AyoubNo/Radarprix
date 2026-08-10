import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the PrixRadar ranking page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /PrixRadar Maroc/i);
  assert.match(html, /meilleures affaires/i);
  assert.match(html, /classement/i);
});

test("uses cached batch history and the dedicated ranking engine", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  const ranking = await readFile(new URL("../server/deal-ranking.mjs", import.meta.url), "utf8");
  const historicalStats = await readFile(new URL("../server/historical-stats.mjs", import.meta.url), "utf8");

  assert.match(api, /getActiveProductPriceStats/);
  assert.match(api, /buildRankedDeal/);
  assert.doesNotMatch(api, /products\.filter\(\(product\) => product\.onSale\)/);
  assert.match(ranking, /HISTORICAL_RANKING_WEIGHTS/);
  assert.match(ranking, /retailer_fallback/);
  assert.match(ranking, /fallbackScoreCap/);
  assert.match(historicalStats, /ROW_NUMBER\(\) OVER/);
  assert.match(historicalStats, /HISTORICAL_STATS_BATCH_QUERY_COUNT = 1/);
});

test("groups duplicate products and exposes multi-store comparisons", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(api, /attachComparisonsAndDedupe/);
  assert.match(api, /merchantCount/);
  assert.match(api, /confidence < 0\.86/);
  assert.match(page, /Vendu par/);
  assert.match(page, /Comparer/);
  assert.match(page, /ComparisonModal/);
});

test("classifies every product by category instead of by source store", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");

  assert.match(api, /function classifyUniverse/);
  assert.match(api, /PC_CATEGORY_NAMES\.has\(category\)/);
  assert.match(api, /PC_PRODUCT_PATTERNS\.some/);
  assert.match(api, /\[deal, \.\.\.comparisons\]\.some/);
});

test("serves pagination from cache and refreshes through the integrated catalogue", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  const store = await readFile(new URL("../server/catalog-store.mjs", import.meta.url), "utf8");
  const database = await readFile(new URL("../server/database.mjs", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(api, /async function getDealsForRequest/);
  assert.match(api, /refreshIntegratedCatalog/);
  assert.match(api, /const state = await getDealsForRequest\(\)/);
  assert.doesNotMatch(api, /127\.0\.0\.1:(3300|3400)/);
  assert.match(store, /crawlPcSources/);
  assert.match(store, /crawlHomeSources/);
  assert.match(database, /product_daily_history/);
  assert.match(database, /PRIMARY KEY\(product_key, observed_date\)/);
  assert.match(database, /isDailyCollectionDue/);
  assert.match(api, /runDailyCollectionIfNeeded/);
  assert.match(api, /DAILY_COLLECTION_CHECK_MS/);
  assert.match(page, /pageLoading/);
  assert.match(page, /controller\.abort\(\)/);
});

test("uses Chromium for Electroplanet and writes the collection text report", async () => {
  const collector = await readFile(new URL("../server/collectors/home.mjs", import.meta.url), "utf8");
  const store = await readFile(new URL("../server/catalog-store.mjs", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(collector, /puppeteer-core/);
  assert.match(collector, /crawlElectroplanetBrowser/);
  assert.match(collector, /disable-blink-features=AutomationControlled/);
  assert.match(collector, /crawlElectroplanetHttp/);
  assert.match(store, /derniere-collecte\.txt/);
  assert.match(store, /writeCollectionReport/);
  assert.match(dockerfile, /chromium/);
});

test("returns to the ranking header after pagination", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /pendingRankingScroll\.current = true/);
  assert.match(page, /data\.page !== page/);
  assert.match(page, /rankingRef\.current\?\.scrollIntoView/);
  assert.match(page, /behavior: "smooth", block: "start"/);
  assert.doesNotMatch(page, /scrollTo\(\{ top: 560/);
});

test("exposes stable, crawlable product-page foundations", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/produit/[id]/[slug]/page.tsx", import.meta.url), "utf8");
  const homepage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");

  assert.match(api, /\/api\/product-index/);
  assert.match(api, /\/api\\\/product\\\//);
  assert.match(api, /identifyLogicalProducts/);
  assert.match(page, /generateMetadata/);
  assert.match(page, /application\/ld\+json/);
  assert.match(page, /Prix habituel/);
  assert.match(page, /Merchant|merchant-offers/i);
  assert.match(page, /permanentRedirect/);
  assert.match(homepage, /href=\{deal\.productPath\}/);
  assert.match(homepage, /Analyse rapide/);
  assert.match(sitemap, /50_000/);
  assert.doesNotMatch(page, /useEffect|fetch\(`\/api\/product/);
});

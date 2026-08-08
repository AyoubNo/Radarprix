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

test("keeps the ranking formula explicit and filters invalid promotions", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  assert.match(api, /discountScore/);
  assert.match(api, /savingsScore/);
  assert.match(api, /stockScore/);
  assert.match(api, /freshnessScore/);
  assert.match(api, /discount > 90/);
  assert.match(api, /price <= 0/);
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

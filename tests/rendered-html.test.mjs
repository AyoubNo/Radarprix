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

test("serves pagination from cache while refreshing stale data in the background", async () => {
  const api = await readFile(new URL("../server/api-server.mjs", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(api, /async function getDealsForRequest/);
  assert.match(api, /void refreshDeals\(true\)/);
  assert.match(api, /const state = await getDealsForRequest\(\)/);
  assert.match(page, /pageLoading/);
  assert.match(page, /controller\.abort\(\)/);
});

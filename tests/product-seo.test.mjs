import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  assignLogicalProductIds,
  initializeLogicalProductSchema,
  resolveLogicalProductId,
} from "../server/logical-products.mjs";
import {
  absoluteProductUrl,
  buildHistoricalExplanation,
  buildProductMetadata,
  buildProductStructuredData,
  isSeoReadyProduct,
  productPath,
  productSlug,
} from "../server/product-seo.mjs";

function detail(overrides = {}) {
  return {
    id: "0011223344556677",
    name: "Sony PlayStation 5 Slim",
    category: "Consoles",
    universe: "pc",
    universeLabel: "PC & Gaming",
    canonicalPath: "/produit/0011223344556677/sony-playstation-5-slim",
    imageUrl: "https://images.example/ps5.webp",
    bestOffer: { site: "Store A", priceCents: 529_900 },
    offers: [
      { site: "Store A", priceCents: 529_900, availability: "in_stock", productUrl: "https://a.example/ps5" },
      { site: "Store B", priceCents: 544_900, availability: "in_stock", productUrl: "https://b.example/ps5" },
    ],
    stats: {
      windowDays: 90,
      observationsCount: 46,
      currentPriceCents: 529_900,
      medianPriceCents: 569_900,
      lowestPriceCents: 522_500,
      historicalDiscountPercent: 7,
      distanceFromLowestPercent: 1.4,
      dealVerdict: { code: "good", label: "Bonne affaire" },
    },
    ranking: { mode: "historical" },
    ...overrides,
  };
}

test("normalizes product slugs deterministically", () => {
  assert.equal(productSlug("  Téléviseur  LG   OLED (55\")  "), "televiseur-lg-oled-55");
  assert.equal(productSlug("ASUS TUF Gaming A15 (FA507)"), "asus-tuf-gaming-a15-fa507");
  assert.equal(productSlug("Cafetière & Moulin — édition spéciale!"), "cafetiere-et-moulin-edition-speciale");
  assert.equal(productSlug("***"), "produit");
  assert.equal(productSlug("Produit ".repeat(30)).length <= 80, true);
});

test("builds a deterministic canonical product URL around a stable ID", () => {
  const path = productPath("0011223344556677", "Sony PlayStation 5 Slim");
  assert.equal(path, "/produit/0011223344556677/sony-playstation-5-slim");
  assert.equal(productPath("0011223344556677", "Sony PlayStation 5 Slim"), path);
  assert.equal(absoluteProductUrl(detail(), "https://prixradar.example"), `https://prixradar.example${path}`);
});

test("keeps logical identity when a name or retailer offer changes", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE products_current (product_key TEXT PRIMARY KEY);
    INSERT INTO products_current VALUES ('offer-a'), ('offer-b'), ('offer-c');
  `);
  initializeLogicalProductSchema(database);
  const ids = ["1111111111111111", "2222222222222222"];
  const first = assignLogicalProductIds(database, [{
    productKey: "offer-a", name: "PlayStation 5 Slim", category: "Consoles", universe: "pc", comparisons: [],
  }], { now: new Date("2026-08-01T12:00:00Z"), createId: () => ids.shift() });
  const stableId = first[0].logicalProductId;
  const refreshed = assignLogicalProductIds(database, [{
    productKey: "offer-b", name: "Console Sony PlayStation 5 Slim", category: "Consoles", universe: "pc",
    comparisons: [{ productKey: "offer-a" }, { productKey: "offer-c" }],
  }], { now: new Date("2026-08-02T12:00:00Z"), createId: () => ids.shift() });

  assert.equal(refreshed[0].logicalProductId, stableId);
  assert.equal(resolveLogicalProductId(database, stableId), stableId);
  assert.equal(resolveLogicalProductId(database, "ffffffffffffffff"), null);
  database.close();
});

test("does not let an overlapping fuzzy comparison reassign emitted identities", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE products_current (product_key TEXT PRIMARY KEY);
    INSERT INTO products_current VALUES ('primary-a'), ('primary-b'), ('ambiguous-offer');
  `);
  initializeLogicalProductSchema(database);
  const generated = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"];
  const groups = [
    { productKey: "primary-a", name: "Produit A", category: "Test", universe: "pc", comparisons: [{ productKey: "ambiguous-offer" }] },
    { productKey: "primary-b", name: "Produit B", category: "Test", universe: "pc", comparisons: [{ productKey: "ambiguous-offer" }] },
  ];
  const first = assignLogicalProductIds(database, groups, { createId: () => generated.shift() });
  const byProduct = new Map(first.map((group) => [group.productKey, group.logicalProductId]));
  const second = assignLogicalProductIds(database, [...groups].reverse(), { createId: () => { throw new Error("unexpected new ID"); } });

  assert.equal(second.find((group) => group.productKey === "primary-a").logicalProductId, byProduct.get("primary-a"));
  assert.equal(second.find((group) => group.productKey === "primary-b").logicalProductId, byProduct.get("primary-b"));
  const ambiguousOwner = database.prepare("SELECT logical_product_id AS id FROM logical_product_members WHERE product_key = 'ambiguous-offer'").get();
  assert.equal(ambiguousOwner, undefined);
  database.close();
});

test("preserves an old logical ID as an alias when two products merge", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE products_current (product_key TEXT PRIMARY KEY);
    INSERT INTO products_current VALUES ('offer-a'), ('offer-b');
  `);
  initializeLogicalProductSchema(database);
  const generated = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"];
  assignLogicalProductIds(database, [
    { productKey: "offer-a", name: "Produit A", category: "Test", universe: "pc", comparisons: [] },
    { productKey: "offer-b", name: "Produit B", category: "Test", universe: "pc", comparisons: [] },
  ], { createId: () => generated.shift() });
  const merged = assignLogicalProductIds(database, [
    { productKey: "offer-a", name: "Produit commun", category: "Test", universe: "pc", comparisons: [{ productKey: "offer-b" }] },
  ], { createId: () => { throw new Error("unexpected new ID"); } });

  assert.equal(merged[0].logicalProductId, "aaaaaaaaaaaaaaaa");
  assert.equal(resolveLogicalProductId(database, "bbbbbbbbbbbbbbbb"), "aaaaaaaaaaaaaaaa");
  database.close();
});

test("generates concise deterministic metadata with canonical and social fallback", () => {
  const value = buildProductMetadata(detail({ imageUrl: null }), "https://prixradar.example");
  assert.match(value.title, /prix (?:au )?Maroc(?: et historique)? \| PrixRadar$/);
  assert.ok(value.title.length <= 65);
  assert.match(value.description, /5[\s\u202f]?299\sDH/);
  assert.match(value.description, /2 offres disponibles/);
  assert.equal(value.canonical, "https://prixradar.example/produit/0011223344556677/sony-playstation-5-slim");
  assert.equal(value.image, "https://prixradar.example/favicon.svg");
  assert.equal(value.robots, "index, follow");
});

test("explains historical evidence from known stats without invented claims", () => {
  const explanation = buildHistoricalExplanation(detail());
  assert.match(explanation, /46 fois sur les 90 derniers jours/);
  assert.match(explanation, /prix habituel.*5[\s\u202f]?699\sDH/);
  assert.match(explanation, /5[\s\u202f]?299\sDH.*7% inférieur/);
  assert.match(explanation, /1,4% du plus bas prix observé/);
  assert.match(explanation, /Bonne affaire/);
});

test("emits valid MAD AggregateOffer data with real offer counts only", () => {
  const value = buildProductStructuredData(detail(), "https://prixradar.example");
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /NaN|null/);
  assert.doesNotMatch(serialized, /review|rating|gtin|sku/i);
  assert.equal(value["@type"], "Product");
  assert.equal(value.offers["@type"], "AggregateOffer");
  assert.equal(value.offers.priceCurrency, "MAD");
  assert.equal(value.offers.lowPrice, 5299);
  assert.equal(value.offers.highPrice, 5449);
  assert.equal(value.offers.offerCount, 2);
});

test("emits one Offer and handles empty history honestly", () => {
  const product = detail({
    offers: [{ site: "Store A", priceCents: 529_900, availability: "in_stock", productUrl: "https://a.example/ps5" }],
    stats: {
      windowDays: 90,
      observationsCount: 0,
      currentPriceCents: 529_900,
      medianPriceCents: null,
      lowestPriceCents: null,
      historicalDiscountPercent: null,
      distanceFromLowestPercent: null,
      dealVerdict: { code: "insufficient_history", label: "Pas encore assez de données" },
    },
    ranking: { mode: "retailer_fallback" },
  });
  const value = buildProductStructuredData(product, "https://prixradar.example");
  assert.equal(value.offers["@type"], "Offer");
  assert.equal(value.offers.price, 5299);
  assert.match(value.description, /commence à suivre ce produit/);
  assert.equal(isSeoReadyProduct(product), false);
  assert.equal(buildProductMetadata(product, "https://prixradar.example").robots, "noindex, follow");
});

test("allows useful multi-retailer pages while guarding thin single-offer pages", () => {
  const sparse = detail({ stats: { observationsCount: 1 }, ranking: { mode: "retailer_fallback" } });
  assert.equal(isSeoReadyProduct(sparse), true);
  assert.equal(isSeoReadyProduct({ ...sparse, offers: sparse.offers.slice(0, 1) }), false);
  assert.equal(isSeoReadyProduct({ ...sparse, stats: { observationsCount: 6 }, offers: sparse.offers.slice(0, 1) }), false);
  assert.equal(isSeoReadyProduct({ ...sparse, stats: { observationsCount: 7 }, offers: sparse.offers.slice(0, 1) }), true);
  assert.equal(isSeoReadyProduct({ ...sparse, id: "bad", offers: [] }), false);
});

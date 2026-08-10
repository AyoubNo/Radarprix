import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadHistoricalStatsBatch } from "./historical-stats.mjs";
import {
  assignLogicalProductIds,
  initializeLogicalProductSchema,
  resolveLogicalProductId,
} from "./logical-products.mjs";
import { buildPriceStats, normalizeHistoryWindowDays } from "./price-intelligence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, "data");
mkdirSync(dataDirectory, { recursive: true });

export const databasePath = path.join(dataDirectory, "radarprix.sqlite.db");
const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 10000;

  CREATE TABLE IF NOT EXISTS products_current (
    product_key TEXT PRIMARY KEY,
    universe TEXT NOT NULL,
    site TEXT NOT NULL,
    external_id TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    original_price_cents INTEGER,
    on_sale INTEGER NOT NULL DEFAULT 0,
    discount_percent REAL,
    availability TEXT NOT NULL DEFAULT 'unknown',
    product_url TEXT NOT NULL,
    image_url TEXT,
    scraped_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(site, product_url)
  );

  CREATE TABLE IF NOT EXISTS product_daily_history (
    product_key TEXT NOT NULL,
    observed_date TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    original_price_cents INTEGER,
    discount_percent REAL,
    availability TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY(product_key, observed_date),
    FOREIGN KEY(product_key) REFERENCES products_current(product_key) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS collection_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    products_observed INTEGER NOT NULL DEFAULT 0,
    details_json TEXT
  );

  CREATE INDEX IF NOT EXISTS products_current_universe_idx
    ON products_current(universe, active);
  CREATE INDEX IF NOT EXISTS products_current_site_idx
    ON products_current(site, active);
  CREATE INDEX IF NOT EXISTS product_daily_history_date_idx
    ON product_daily_history(observed_date);
  CREATE INDEX IF NOT EXISTS product_daily_history_product_idx
    ON product_daily_history(product_key, observed_date DESC);
`);
initializeLogicalProductSchema(database);

const markUniverseInactive = database.prepare(`
  UPDATE products_current SET active = 0 WHERE universe = ?
`);

const upsertCurrent = database.prepare(`
  INSERT INTO products_current (
    product_key, universe, site, external_id, name, category,
    price_cents, original_price_cents, on_sale, discount_percent,
    availability, product_url, image_url, scraped_at, updated_at, active
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(product_key) DO UPDATE SET
    universe = excluded.universe,
    site = excluded.site,
    external_id = excluded.external_id,
    name = excluded.name,
    category = excluded.category,
    price_cents = excluded.price_cents,
    original_price_cents = excluded.original_price_cents,
    on_sale = excluded.on_sale,
    discount_percent = excluded.discount_percent,
    availability = excluded.availability,
    product_url = excluded.product_url,
    image_url = COALESCE(excluded.image_url, products_current.image_url),
    scraped_at = excluded.scraped_at,
    updated_at = excluded.updated_at,
    active = 1
`);

const upsertDailyHistory = database.prepare(`
  INSERT INTO product_daily_history (
    product_key, observed_date, price_cents, original_price_cents,
    discount_percent, availability, observed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(product_key, observed_date) DO UPDATE SET
    price_cents = excluded.price_cents,
    original_price_cents = excluded.original_price_cents,
    discount_percent = excluded.discount_percent,
    availability = excluded.availability,
    observed_at = excluded.observed_at
`);

function productKey(universe, site, productUrl) {
  const digest = createHash("sha1").update(`${site}|${productUrl}`).digest("hex");
  return `${universe}:${digest}`;
}

function dateInMorocco(isoValue) {
  const date = new Date(isoValue);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isDailyCollectionDue(now = new Date()) {
  const latest = database.prepare(`
    SELECT finished_at AS finishedAt
    FROM collection_runs
    WHERE status IN ('done', 'partial') AND finished_at IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `).get();
  return !latest?.finishedAt || dateInMorocco(latest.finishedAt) !== dateInMorocco(now.toISOString());
}

export function countProducts(universe) {
  return database.prepare(`
    SELECT COUNT(*) AS count FROM products_current WHERE universe = ? AND active = 1
  `).get(universe).count;
}

export function syncUniverse(universe, products, options = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const observedDate = dateInMorocco(observedAt);
  const observedSites = options.observedSites
    ? new Set(options.observedSites)
    : new Set(products.map((product) => product.site));
  let historyRows = 0;

  database.exec("BEGIN IMMEDIATE");
  try {
    markUniverseInactive.run(universe);
    for (const product of products) {
      const key = productKey(universe, product.site, product.productUrl);
      upsertCurrent.run(
        key,
        universe,
        product.site,
        product.id == null ? null : String(product.id),
        product.name,
        product.category || "Accessoires & autres",
        Number(product.priceCents),
        product.originalPriceCents == null ? null : Number(product.originalPriceCents),
        product.onSale ? 1 : 0,
        product.discountPercent == null ? null : Number(product.discountPercent),
        product.availability || "unknown",
        product.productUrl,
        product.imageUrl || null,
        product.scrapedAt || observedAt,
        observedAt,
      );
      if (observedSites.has(product.site)) {
        upsertDailyHistory.run(
          key,
          observedDate,
          Number(product.priceCents),
          product.originalPriceCents == null ? null : Number(product.originalPriceCents),
          product.discountPercent == null ? null : Number(product.discountPercent),
          product.availability || "unknown",
          observedAt,
        );
        historyRows += 1;
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { products: products.length, historyRows, observedAt, observedDate };
}

export function listProducts(universe) {
  return database.prepare(`
    SELECT
      external_id AS id,
      product_key AS productKey,
      site,
      name,
      category,
      price_cents AS priceCents,
      original_price_cents AS originalPriceCents,
      on_sale AS onSale,
      discount_percent AS discountPercent,
      availability,
      product_url AS productUrl,
      image_url AS imageUrl,
      scraped_at AS scrapedAt,
      updated_at AS updatedAt
    FROM products_current
    WHERE universe = ? AND active = 1
    ORDER BY site COLLATE NOCASE, name COLLATE NOCASE
  `).all(universe).map((row) => ({ ...row, onSale: Boolean(row.onSale) }));
}

export function getUniverseUpdatedAt(universe) {
  return database.prepare(`
    SELECT MAX(updated_at) AS updatedAt
    FROM products_current
    WHERE universe = ? AND active = 1
  `).get(universe).updatedAt || null;
}

export function startCollectionRun() {
  const startedAt = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO collection_runs(started_at, status) VALUES (?, 'running')
  `).run(startedAt);
  return { id: Number(result.lastInsertRowid), startedAt };
}

export function finishCollectionRun(id, status, details = {}) {
  const finishedAt = new Date().toISOString();
  database.prepare(`
    UPDATE collection_runs
    SET finished_at = ?, status = ?, products_observed = ?, details_json = ?
    WHERE id = ?
  `).run(
    finishedAt,
    status,
    Number(details.productsObserved || 0),
    JSON.stringify(details),
    id,
  );
  return { id, finishedAt, status };
}

export function getDatabaseStats() {
  const current = database.prepare(`
    SELECT COUNT(*) AS products, COUNT(DISTINCT site) AS sites
    FROM products_current WHERE active = 1
  `).get();
  const history = database.prepare(`
    SELECT COUNT(*) AS observations,
           COUNT(DISTINCT observed_date) AS days,
           MIN(observed_date) AS firstDate,
           MAX(observed_date) AS lastDate
    FROM product_daily_history
  `).get();
  return { ...current, ...history, databasePath };
}

export function getActiveProductPriceStats({ days = 90, now = new Date() } = {}) {
  return loadHistoricalStatsBatch(database, { days, now });
}

export function identifyLogicalProducts(groups, options) {
  return assignLogicalProductIds(database, groups, options);
}

export function findLogicalProductId(value) {
  return resolveLogicalProductId(database, value);
}

function resolveProductKey({ productKey: key, site, productUrl }) {
  let resolvedKey = key;
  if (!resolvedKey && site && productUrl) {
    resolvedKey = database.prepare(`
      SELECT product_key AS productKey
      FROM products_current
      WHERE site = ? AND product_url = ?
    `).get(site, productUrl)?.productKey;
  }
  return resolvedKey || null;
}

export function getProductHistory({ productKey: key, site, productUrl, limit = 365, days } = {}) {
  const resolvedKey = resolveProductKey({ productKey: key, site, productUrl });
  if (!resolvedKey) return null;

  const product = database.prepare(`
    SELECT product_key AS productKey, site, name, category,
           product_url AS productUrl, image_url AS imageUrl
    FROM products_current
    WHERE product_key = ?
  `).get(resolvedKey);
  if (!product) return null;

  const windowClause = days === null || days === undefined || days === ""
    ? ""
    : `AND observed_date >= date(
         (SELECT MAX(observed_date) FROM product_daily_history WHERE product_key = ?),
         ?
       )`;
  const statement = database.prepare(`
    SELECT observed_date AS observedDate,
           price_cents AS priceCents,
           original_price_cents AS originalPriceCents,
           discount_percent AS discountPercent,
           availability,
           observed_at AS observedAt
    FROM product_daily_history
    WHERE product_key = ?
    ${windowClause}
    ORDER BY observed_date DESC
    LIMIT ?
  `);
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 365));
  const history = windowClause
    ? statement.all(
      resolvedKey,
      resolvedKey,
      `-${normalizeHistoryWindowDays(days) - 1} days`,
      safeLimit,
    )
    : statement.all(resolvedKey, safeLimit);
  return { product, history };
}

export function getProductPriceStats({ productKey: key, site, productUrl, days = 90 } = {}) {
  const resolvedKey = resolveProductKey({ productKey: key, site, productUrl });
  if (!resolvedKey) return null;

  const product = database.prepare(`
    SELECT price_cents AS priceCents,
           original_price_cents AS originalPriceCents,
           discount_percent AS discountPercent
    FROM products_current
    WHERE product_key = ?
  `).get(resolvedKey);
  if (!product) return null;

  const windowDays = normalizeHistoryWindowDays(days);
  const history = database.prepare(`
    SELECT observed_date AS observedDate,
           price_cents AS priceCents,
           original_price_cents AS originalPriceCents,
           discount_percent AS discountPercent,
           availability,
           observed_at AS observedAt
    FROM product_daily_history
    WHERE product_key = ?
      AND observed_date >= date(
        (SELECT MAX(observed_date) FROM product_daily_history WHERE product_key = ?),
        ?
      )
    ORDER BY observed_date ASC
  `).all(resolvedKey, resolvedKey, `-${windowDays - 1} days`);

  return buildPriceStats({
    history,
    windowDays,
    currentPriceCents: product.priceCents,
    claimedOriginalPriceCents: product.originalPriceCents,
    claimedDiscountPercent: product.discountPercent,
  });
}

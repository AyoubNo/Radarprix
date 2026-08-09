import { performance } from "node:perf_hooks";
import {
  buildPriceStatsFromAggregates,
  normalizeHistoryWindowDays,
} from "./price-intelligence.mjs";

export const HISTORICAL_STATS_BATCH_QUERY_COUNT = 1;

const HISTORICAL_STATS_BATCH_SQL = `
  WITH latest_by_product AS (
    SELECT history.product_key, MAX(history.observed_date) AS latest_date
    FROM product_daily_history AS history
    JOIN products_current AS product
      ON product.product_key = history.product_key
     AND product.active = 1
    GROUP BY history.product_key
  ),
  windowed AS (
    SELECT
      history.product_key,
      history.observed_date,
      history.price_cents,
      history.observed_at,
      latest.latest_date,
      product.price_cents AS current_price_cents,
      product.original_price_cents AS claimed_original_price_cents,
      product.discount_percent AS claimed_discount_percent
    FROM product_daily_history AS history
    JOIN latest_by_product AS latest
      ON latest.product_key = history.product_key
    JOIN products_current AS product
      ON product.product_key = history.product_key
     AND product.active = 1
    WHERE history.observed_date >= date(latest.latest_date, ?)
      AND history.price_cents > 0
  ),
  ranked AS (
    SELECT
      windowed.*,
      ROW_NUMBER() OVER (
        PARTITION BY product_key
        ORDER BY price_cents, observed_date
      ) AS price_rank,
      COUNT(*) OVER (PARTITION BY product_key) AS observation_count
    FROM windowed
  )
  SELECT
    product_key AS productKey,
    MAX(observation_count) AS observationsCount,
    MAX(current_price_cents) AS currentPriceCents,
    CAST(ROUND(AVG(price_cents)) AS INTEGER) AS averagePriceCents,
    MIN(price_cents) AS lowestPriceCents,
    MAX(price_cents) AS highestPriceCents,
    CAST(ROUND(AVG(
      CASE
        WHEN price_rank IN (
          (observation_count + 1) / 2,
          (observation_count + 2) / 2
        )
        THEN price_cents
      END
    )) AS INTEGER) AS medianPriceCents,
    MIN(
      CASE
        WHEN observed_date <> latest_date OR price_cents <> current_price_cents
        THEN price_cents
      END
    ) AS previousLowestPriceCents,
    MAX(claimed_original_price_cents) AS claimedOriginalPriceCents,
    MAX(claimed_discount_percent) AS claimedDiscountPercent,
    MIN(observed_at) AS firstObservedAt,
    MAX(observed_at) AS lastObservedAt
  FROM ranked
  GROUP BY product_key
`;

export function loadHistoricalStatsBatch(database, { days = 90, now = new Date() } = {}) {
  if (!database?.prepare) throw new TypeError("A SQLite database connection is required");
  const windowDays = normalizeHistoryWindowDays(days);
  const startedAt = performance.now();
  const rows = database.prepare(HISTORICAL_STATS_BATCH_SQL).all(`-${windowDays - 1} days`);
  const statsByProductKey = new Map();
  let observationsRead = 0;

  for (const row of rows) {
    const observationsCount = Math.max(0, Number(row.observationsCount) || 0);
    observationsRead += observationsCount;
    statsByProductKey.set(row.productKey, buildPriceStatsFromAggregates({
      ...row,
      observationsCount,
      windowDays,
      now,
    }));
  }

  return {
    statsByProductKey,
    metrics: {
      queryCount: HISTORICAL_STATS_BATCH_QUERY_COUNT,
      productsAggregated: statsByProductKey.size,
      observationsRead,
      windowDays,
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
    },
  };
}

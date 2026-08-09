import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DEAL_RANKING_THRESHOLDS,
  rankDeal,
} from "../server/deal-ranking.mjs";
import { loadHistoricalStatsBatch } from "../server/historical-stats.mjs";
import { buildPriceStats } from "../server/price-intelligence.mjs";

const NOW = new Date("2026-08-09T20:00:00.000Z");

function product(overrides = {}) {
  return {
    priceCents: 850_000,
    originalPriceCents: null,
    discountPercent: null,
    onSale: false,
    availability: "in_stock",
    scrapedAt: "2026-08-09T18:00:00.000Z",
    ...overrides,
  };
}

function historicalStats(overrides = {}) {
  return {
    currentPriceCents: 850_000,
    medianPriceCents: 1_000_000,
    averagePriceCents: 990_000,
    lowestPriceCents: 850_000,
    highestPriceCents: 1_050_000,
    previousLowestPriceCents: 900_000,
    historicalDiscountPercent: 15,
    distanceFromLowestPercent: 0,
    observationsCount: 30,
    confidence: "high",
    freshness: { status: "fresh", ageHours: 2, lastObservedAt: "2026-08-09T18:00:00.000Z" },
    dealVerdict: { code: "exceptional", label: "Prix exceptionnel" },
    claimAssessment: { code: "unknown", label: "Remise non vérifiable" },
    ...overrides,
  };
}

test("ranks an unadvertised genuine deal in historical mode", () => {
  const result = rankDeal({
    product: product({ onSale: false, originalPriceCents: null, discountPercent: null }),
    historicalStats: historicalStats(),
    now: NOW,
  });

  assert.equal(result.mode, "historical");
  assert.equal(result.eligibility.isDeal, true);
  assert.ok(result.score >= 70, `expected a strong score, received ${result.score}`);
  assert.equal(result.historicalSavingsCents, 150_000);
  assert.equal(result.components.advertisedValue, 0);
});

test("does not let a fake-looking advertised discount dominate historical ranking", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    observedDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    priceCents: index === 29 ? 900_000 : 920_000,
    originalPriceCents: 1_200_000,
    discountPercent: 25,
  }));
  const stats = buildPriceStats({
    history,
    currentPriceCents: 900_000,
    claimedOriginalPriceCents: 1_200_000,
    claimedDiscountPercent: 25,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });
  const result = rankDeal({
    product: product({
      priceCents: 900_000,
      originalPriceCents: 1_200_000,
      discountPercent: 25,
      onSale: true,
    }),
    historicalStats: stats,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });

  assert.notEqual(stats.dealVerdict.code, "exceptional");
  assert.equal(stats.claimAssessment.code, "exaggerated");
  assert.equal(result.mode, "historical");
  assert.ok(result.score < 60, `advertised discount inflated score to ${result.score}`);
  assert.ok(result.components.historicalValue < 10);
  assert.equal(result.components.advertisedValue, 0);
});

test("does not call a negligible new low a meaningful deal", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    observedDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    priceCents: index === 29 ? 999_000 : 1_000_000,
  }));
  const stats = buildPriceStats({
    history,
    currentPriceCents: 999_000,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });
  const result = rankDeal({
    product: product({ priceCents: 999_000 }),
    historicalStats: stats,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });

  assert.equal(stats.historicalDiscountPercent, 0.1);
  assert.equal(stats.dealVerdict.code, "normal");
  assert.equal(result.eligibility.isDeal, false);
});

test("keeps an excellent current price strong when the retailer claim is exaggerated", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    observedDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    priceCents: index === 29 ? 800_000 : 1_000_000,
    originalPriceCents: 1_200_000,
    discountPercent: 33.3,
  }));
  const stats = buildPriceStats({
    history,
    currentPriceCents: 800_000,
    claimedOriginalPriceCents: 1_200_000,
    claimedDiscountPercent: 33.3,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });
  const result = rankDeal({
    product: product({ priceCents: 800_000, originalPriceCents: 1_200_000, discountPercent: 33.3 }),
    historicalStats: stats,
    now: new Date("2026-07-30T13:00:00.000Z"),
  });

  assert.equal(stats.claimAssessment.code, "exaggerated");
  assert.equal(stats.dealVerdict.code, "exceptional");
  assert.equal(result.mode, "historical");
  assert.equal(result.eligibility.isDeal, true);
  assert.ok(result.score >= 85);
});

test("uses retailer fallback for a meaningful new-product promotion", () => {
  const result = rankDeal({
    product: product({
      priceCents: 900_000,
      originalPriceCents: 1_200_000,
      discountPercent: 25,
      onSale: true,
    }),
    historicalStats: historicalStats({
      observationsCount: 2,
      confidence: "insufficient",
      dealVerdict: { code: "insufficient_history", label: "Pas encore assez de données" },
    }),
    now: NOW,
  });

  assert.equal(result.mode, "retailer_fallback");
  assert.equal(result.eligibility.isDeal, true);
  assert.ok(result.score > 0);
  assert.ok(result.score <= DEAL_RANKING_THRESHOLDS.fallbackScoreCap);
});

test("does not promote a new product without retailer or historical evidence", () => {
  const result = rankDeal({
    product: product(),
    historicalStats: historicalStats({
      observationsCount: 1,
      confidence: "insufficient",
      historicalDiscountPercent: 0,
    }),
    now: NOW,
  });

  assert.equal(result.mode, "retailer_fallback");
  assert.equal(result.eligibility.isDeal, false);
  assert.equal(result.score, 0);
});

test("disables strong historical ranking for very stale history", () => {
  const result = rankDeal({
    product: product({
      priceCents: 800_000,
      originalPriceCents: 1_000_000,
      discountPercent: 20,
      onSale: true,
    }),
    historicalStats: historicalStats({
      historicalDiscountPercent: 20,
      freshness: { status: "very_stale", ageHours: 120, lastObservedAt: "2026-08-04T20:00:00.000Z" },
    }),
    now: NOW,
  });

  assert.equal(result.mode, "retailer_fallback");
  assert.equal(result.eligibility.reason, "very_stale_history_fallback");
  assert.ok(result.score <= DEAL_RANKING_THRESHOLDS.fallbackScoreCap);
});

test("awards the full proximity component at a meaningful historical low", () => {
  const result = rankDeal({
    product: product({ priceCents: 920_000 }),
    historicalStats: historicalStats({
      currentPriceCents: 920_000,
      medianPriceCents: 1_000_000,
      lowestPriceCents: 920_000,
      historicalDiscountPercent: 8,
      distanceFromLowestPercent: 0,
      confidence: "medium",
      dealVerdict: { code: "good", label: "Bonne affaire" },
    }),
    now: NOW,
  });

  assert.equal(result.mode, "historical");
  assert.equal(result.components.proximityToLow, 20);
  assert.equal(result.eligibility.isDeal, true);
});

test("does not rank a price above its historical median as a deal", () => {
  const result = rankDeal({
    product: product({ priceCents: 1_060_000 }),
    historicalStats: historicalStats({
      currentPriceCents: 1_060_000,
      historicalDiscountPercent: -6,
      distanceFromLowestPercent: 20,
      dealVerdict: { code: "expensive", label: "Plus cher que d'habitude" },
    }),
    now: NOW,
  });

  assert.equal(result.mode, "historical");
  assert.equal(result.eligibility.isDeal, false);
  assert.equal(result.components.historicalValue, 0);
});

test("keeps score bounds for extreme historical and fallback values", () => {
  const cases = [
    rankDeal({
      product: product({ priceCents: 1 }),
      historicalStats: historicalStats({
        currentPriceCents: 1,
        medianPriceCents: 999_999_999,
        historicalDiscountPercent: 9999,
        distanceFromLowestPercent: 0,
      }),
      now: NOW,
    }),
    rankDeal({
      product: product({ priceCents: 1, originalPriceCents: 999_999_999, discountPercent: 89 }),
      historicalStats: null,
      now: NOW,
    }),
  ];

  for (const result of cases) {
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  }
});

test("never returns NaN or Infinity for malformed optional values", () => {
  const result = rankDeal({
    product: product({
      priceCents: "not-a-price",
      originalPriceCents: Infinity,
      discountPercent: Number.NaN,
      scrapedAt: "invalid",
    }),
    historicalStats: historicalStats({
      currentPriceCents: null,
      medianPriceCents: Number.NaN,
      historicalDiscountPercent: Infinity,
      distanceFromLowestPercent: undefined,
    }),
    now: NOW,
  });

  assert.equal(Number.isFinite(result.score), true);
  assert.equal(result.eligibility.isDeal, false);
  for (const value of Object.values(result.components)) assert.equal(Number.isFinite(value), true);
});

test("claim assessment does not change the historical deal score", () => {
  const base = historicalStats();
  const representative = rankDeal({
    product: product(),
    historicalStats: { ...base, claimAssessment: { code: "representative", label: "Cohérente" } },
    now: NOW,
  });
  const exaggerated = rankDeal({
    product: product(),
    historicalStats: { ...base, claimAssessment: { code: "exaggerated", label: "Exagérée" } },
    now: NOW,
  });

  assert.equal(exaggerated.score, representative.score);
  assert.deepEqual(exaggerated.components, representative.components);
});

test("loads medians and statistics for all active products in one batch query", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE products_current (
      product_key TEXT PRIMARY KEY,
      price_cents INTEGER NOT NULL,
      original_price_cents INTEGER,
      discount_percent REAL,
      active INTEGER NOT NULL
    );
    CREATE TABLE product_daily_history (
      product_key TEXT NOT NULL,
      observed_date TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      observed_at TEXT NOT NULL
    );
    INSERT INTO products_current VALUES
      ('p1', 800, 1200, 33.3, 1),
      ('p2', 300, NULL, NULL, 1),
      ('inactive', 50, 100, 50, 0);
    INSERT INTO product_daily_history VALUES
      ('p1', '2026-08-01', 1000, '2026-08-01T12:00:00.000Z'),
      ('p1', '2026-08-02', 1200, '2026-08-02T12:00:00.000Z'),
      ('p1', '2026-08-03', 800, '2026-08-03T12:00:00.000Z'),
      ('p1', '2026-08-04', 800, '2026-08-04T12:00:00.000Z'),
      ('p2', '2026-08-01', 100, '2026-08-01T12:00:00.000Z'),
      ('p2', '2026-08-02', 200, '2026-08-02T12:00:00.000Z'),
      ('p2', '2026-08-03', 300, '2026-08-03T12:00:00.000Z'),
      ('inactive', '2026-08-03', 50, '2026-08-03T12:00:00.000Z');
  `);

  try {
    const result = loadHistoricalStatsBatch(database, {
      days: 90,
      now: new Date("2026-08-04T13:00:00.000Z"),
    });
    assert.equal(result.metrics.queryCount, 1);
    assert.equal(result.metrics.productsAggregated, 2);
    assert.equal(result.metrics.observationsRead, 7);
    assert.equal(result.statsByProductKey.get("p1").medianPriceCents, 900);
    assert.equal(result.statsByProductKey.get("p1").averagePriceCents, 950);
    assert.equal(result.statsByProductKey.get("p1").previousLowestPriceCents, 800);
    assert.equal(result.statsByProductKey.get("p2").medianPriceCents, 200);
    assert.equal(result.statsByProductKey.has("inactive"), false);
  } finally {
    database.close();
  }
});

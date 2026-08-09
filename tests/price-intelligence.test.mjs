import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPriceStats,
  historyConfidence,
  historyFreshness,
  medianPrice,
} from "../server/price-intelligence.mjs";

function historyAt(priceCents, count, extras = {}) {
  const startAt = new Date("2026-01-01T10:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    priceCents,
    observedDate: new Date(startAt.getTime() + index * 86400000).toISOString().slice(0, 10),
    observedAt: new Date(startAt.getTime() + index * 86400000).toISOString(),
    ...extras,
  }));
}

const TEST_NOW = "2026-01-30T12:00:00.000Z";

test("median resists a temporary price outlier", () => {
  assert.equal(medianPrice([8999, 8999, 9099, 8999, 9099, 15000, 8999]), 8999);
});

test("confidence follows the exact observation thresholds", () => {
  assert.equal(historyConfidence(6), "insufficient");
  assert.equal(historyConfidence(7), "medium");
  assert.equal(historyConfidence(29), "medium");
  assert.equal(historyConfidence(30), "high");
});

test("separates an exceptional deal from an exaggerated retailer claim", () => {
  const history = historyAt(1000000, 29);
  history.push({
    priceCents: 800000,
    observedDate: "2026-01-30",
    observedAt: "2026-01-30T10:00:00.000Z",
  });
  const stats = buildPriceStats({
    history,
    currentPriceCents: 800000,
    claimedOriginalPriceCents: 1200000,
    claimedDiscountPercent: 33.3,
    windowDays: 90,
    now: TEST_NOW,
  });

  assert.equal(stats.medianPriceCents, 1000000);
  assert.equal(stats.historicalDiscountPercent, 20);
  assert.equal(stats.claimedDiscountPercent, 33.3);
  assert.equal(stats.confidence, "high");
  assert.equal(stats.dealVerdict.code, "exceptional");
  assert.equal(stats.claimAssessment.code, "exaggerated");
  assert.deepEqual(stats.verdict, stats.dealVerdict);
});

test("keeps a normal price separate from an exaggerated claim", () => {
  const stats = buildPriceStats({
    history: historyAt(1000000, 30),
    currentPriceCents: 1000000,
    claimedOriginalPriceCents: 1200000,
    claimedDiscountPercent: 16.7,
    now: TEST_NOW,
  });

  assert.equal(stats.historicalDiscountPercent, 0);
  assert.equal(stats.dealVerdict.code, "normal");
  assert.equal(stats.claimAssessment.code, "exaggerated");
});

test("recognizes a good deal with a representative claim", () => {
  const history = historyAt(1000000, 28);
  history.push({
    priceCents: 900000,
    observedDate: "2026-01-29",
    observedAt: "2026-01-29T10:00:00.000Z",
  });
  history.push({
    priceCents: 920000,
    observedDate: "2026-01-30",
    observedAt: "2026-01-30T10:00:00.000Z",
  });
  const stats = buildPriceStats({
    history,
    currentPriceCents: 920000,
    claimedOriginalPriceCents: 1011000,
    claimedDiscountPercent: 9,
    now: TEST_NOW,
  });

  assert.equal(stats.historicalDiscountPercent, 8);
  assert.equal(stats.previousLowestPriceCents, 900000);
  assert.equal(stats.dealVerdict.code, "good");
  assert.equal(stats.claimAssessment.code, "representative");
});

test("insufficient history prevents a strong promotion verdict", () => {
  const stats = buildPriceStats({
    history: historyAt(920000, 3),
    currentPriceCents: 899000,
    claimedOriginalPriceCents: 1200000,
    claimedDiscountPercent: 25.1,
    now: "2026-01-03T12:00:00.000Z",
  });

  assert.equal(stats.confidence, "insufficient");
  assert.equal(stats.dealVerdict.code, "insufficient_history");
  assert.equal(stats.dealVerdict.label, "Pas encore assez de données");
  assert.equal(stats.claimAssessment.code, "unknown");
});

test("does not assess a retailer claim when no advertised discount exists", () => {
  const stats = buildPriceStats({
    history: historyAt(1000000, 30),
    currentPriceCents: 1000000,
    claimedOriginalPriceCents: null,
    claimedDiscountPercent: null,
    now: TEST_NOW,
  });

  assert.equal(stats.confidence, "high");
  assert.equal(stats.claimAssessment.code, "unknown");
});

test("reports fresh history within 24 hours", () => {
  assert.deepEqual(
    historyFreshness("2026-01-30T10:00:00.000Z", "2026-01-31T10:00:00.000Z"),
    { status: "fresh", ageHours: 24, lastObservedAt: "2026-01-30T10:00:00.000Z" },
  );
});

test("reports stale history after 24 hours and through 72 hours", () => {
  assert.deepEqual(
    historyFreshness("2026-01-30T10:00:00.000Z", "2026-02-02T10:00:00.000Z"),
    { status: "stale", ageHours: 72, lastObservedAt: "2026-01-30T10:00:00.000Z" },
  );
});

test("very stale history downgrades a strong deal verdict", () => {
  const stats = buildPriceStats({
    history: historyAt(1000000, 30),
    currentPriceCents: 800000,
    now: "2026-02-03T11:00:00.000Z",
  });

  assert.equal(stats.freshness.status, "very_stale");
  assert.equal(stats.freshness.ageHours, 97);
  assert.equal(stats.historicalDiscountPercent, 20);
  assert.equal(stats.dealVerdict.code, "insufficient_history");
  assert.equal(stats.dealVerdict.label, "Données trop anciennes pour confirmer");
});

test("reports unknown freshness when the latest timestamp is missing", () => {
  const history = historyAt(1000000, 7)
    .map(({ priceCents, observedDate }) => ({ priceCents, observedDate }));
  const stats = buildPriceStats({ history, currentPriceCents: 1000000, now: TEST_NOW });

  assert.deepEqual(stats.freshness, {
    status: "unknown",
    ageHours: null,
    lastObservedAt: null,
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPriceStats,
  historyConfidence,
  medianPrice,
} from "../server/price-intelligence.mjs";

function historyAt(priceCents, count, extras = {}) {
  return Array.from({ length: count }, (_, index) => ({
    priceCents,
    observedDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
    observedAt: `2026-01-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    ...extras,
  }));
}

test("median resists a temporary price outlier", () => {
  assert.equal(medianPrice([8999, 8999, 9099, 8999, 9099, 15000, 8999]), 8999);
});

test("confidence follows the exact observation thresholds", () => {
  assert.equal(historyConfidence(6), "insufficient");
  assert.equal(historyConfidence(7), "medium");
  assert.equal(historyConfidence(29), "medium");
  assert.equal(historyConfidence(30), "high");
});

test("detects a retailer discount that is not representative of observed prices", () => {
  const stats = buildPriceStats({
    history: historyAt(920000, 30),
    currentPriceCents: 899000,
    claimedOriginalPriceCents: 1200000,
    claimedDiscountPercent: 25.1,
    windowDays: 90,
  });

  assert.equal(stats.medianPriceCents, 920000);
  assert.equal(stats.historicalDiscountPercent, 2.3);
  assert.equal(stats.claimedDiscountPercent, 25.1);
  assert.equal(stats.confidence, "high");
  assert.equal(stats.verdict.code, "suspicious_promotion");
});

test("recognizes a genuine exceptional historical price", () => {
  const history = historyAt(1000000, 29);
  history.push({
    priceCents: 800000,
    observedDate: "2026-01-30",
    observedAt: "2026-01-30T10:00:00.000Z",
  });
  const stats = buildPriceStats({ history, currentPriceCents: 800000, windowDays: 90 });

  assert.equal(stats.historicalDiscountPercent, 20);
  assert.equal(stats.previousLowestPriceCents, 1000000);
  assert.equal(stats.verdict.code, "exceptional");
});

test("insufficient history prevents a strong promotion verdict", () => {
  const stats = buildPriceStats({
    history: historyAt(920000, 3),
    currentPriceCents: 899000,
    claimedOriginalPriceCents: 1200000,
    claimedDiscountPercent: 25.1,
  });

  assert.equal(stats.confidence, "insufficient");
  assert.equal(stats.verdict.code, "insufficient_history");
  assert.equal(stats.verdict.label, "Pas encore assez de données");
});

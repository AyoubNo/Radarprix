import assert from "node:assert/strict";
import test from "node:test";

import {
  confidenceLabel,
  createPriceChartModel,
  formatAdvertisedDiscount,
  formatHistoricalPercentage,
  formatMad,
  freshnessLabel,
  historicalDifferenceText,
} from "../app/components/price-intelligence-helpers.mjs";

test("formats MAD prices and advertised discounts for the product view", () => {
  assert.equal(formatMad(899000), "8 990 DH");
  assert.equal(formatMad(null), "—");
  assert.equal(formatAdvertisedDiscount(25.1), "−25,1 %");
  assert.equal(formatAdvertisedDiscount(null), "—");
});

test("formats historical differences with an understandable direction", () => {
  assert.equal(formatHistoricalPercentage(2.3), "−2,3 %");
  assert.equal(formatHistoricalPercentage(-5.4), "+5,4 %");
  assert.equal(historicalDifferenceText(2.3), "2,3 % sous le prix habituel");
  assert.equal(historicalDifferenceText(-5.4), "5,4 % plus cher que le prix habituel");
});

test("maps confidence and freshness to French transparency labels", () => {
  assert.equal(confidenceLabel("insufficient"), "Historique limité");
  assert.equal(confidenceLabel("medium"), "Historique intermédiaire");
  assert.equal(confidenceLabel("high"), "Historique solide");
  assert.equal(freshnessLabel({ status: "fresh", ageHours: 3 }), "Prix vérifié récemment");
  assert.equal(freshnessLabel({ status: "stale", ageHours: 48 }), "Dernier relevé il y a 48 heures");
  assert.equal(freshnessLabel({ status: "very_stale", ageHours: 96 }), "Données anciennes");
  assert.equal(freshnessLabel({ status: "unknown", ageHours: null }), "Date de vérification inconnue");
});

test("creates finite chart points when every observed price is identical", () => {
  const model = createPriceChartModel([
    { observedDate: "2026-08-01", priceCents: 100000 },
    { observedDate: "2026-08-02", priceCents: 100000 },
    { observedDate: "2026-08-03", priceCents: 100000 },
  ], 100000);

  assert.equal(model.points.length, 3);
  assert.ok(model.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.equal(new Set(model.points.map((point) => point.y)).size, 1);
  assert.ok(Number.isFinite(model.medianY));
});

test("returns an empty chart model for missing or invalid observations", () => {
  const model = createPriceChartModel([
    { observedDate: "invalid", priceCents: 100000 },
    { observedDate: "2026-08-01", priceCents: 0 },
  ], null);

  assert.deepEqual(model.points, []);
  assert.equal(model.path, "");
  assert.equal(model.medianY, null);
});

test("centers a single observation without division by zero", () => {
  const model = createPriceChartModel([
    { observedDate: "2026-08-01", priceCents: 899000 },
  ], 899000, { width: 720, height: 260 });

  assert.equal(model.points.length, 1);
  assert.equal(model.points[0].x, 380);
  assert.ok(Number.isFinite(model.points[0].y));
  assert.match(model.path, /^M /);
});

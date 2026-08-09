export const HISTORICAL_RANKING_WEIGHTS = Object.freeze({
  historicalValue: 40,
  proximityToLow: 20,
  historicalSavings: 15,
  availability: 10,
  freshness: 10,
  confidence: 5,
});

export const RETAILER_FALLBACK_WEIGHTS = Object.freeze({
  advertisedValue: 40,
  advertisedSavings: 20,
  availability: 10,
  freshness: 10,
});

export const DEAL_RANKING_THRESHOLDS = Object.freeze({
  historicalWindowDays: 90,
  minimumHistoricalDiscountPercent: 3,
  minimumNearLowDiscountPercent: 1,
  maximumNearLowDistancePercent: 5,
  maximumHistoricalValuePercent: 20,
  historicalSavingsCapMad: 5000,
  minimumFallbackDiscountPercent: 3,
  maximumFallbackDiscountPercent: 90,
  minimumFallbackSavingsCents: 1000,
  fallbackSavingsCapMad: 5000,
  fallbackScoreCap: 74,
  suspiciousFallbackDiscountPercent: 80,
  suspiciousFallbackPenalty: 12,
});

const EMPTY_COMPONENTS = Object.freeze({
  historicalValue: 0,
  proximityToLow: 0,
  historicalSavings: 0,
  availability: 0,
  freshness: 0,
  confidence: 0,
  advertisedValue: 0,
  advertisedSavings: 0,
  suspiciousClaimPenalty: 0,
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positivePrice(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? Math.round(number) : null;
}

function clamp(value, minimum, maximum) {
  const number = finiteNumber(value);
  if (number === null) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function roundedComponent(value) {
  return Number(clamp(value, 0, 100).toFixed(1));
}

function boundedScore(value, maximum = 100) {
  return Math.round(clamp(value, 0, maximum));
}

function availabilityScore(availability) {
  if (availability === "in_stock") return HISTORICAL_RANKING_WEIGHTS.availability;
  if (availability === "unknown") return 3;
  return 0;
}

function historicalFreshnessScore(freshness) {
  if (freshness?.status === "fresh") return HISTORICAL_RANKING_WEIGHTS.freshness;
  if (freshness?.status === "stale") return 5;
  return 0;
}

function currentOfferFreshnessScore(scrapedAt, now) {
  const scrapedTime = Date.parse(scrapedAt || "");
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(scrapedTime) || !Number.isFinite(nowTime)) return 2;
  const ageDays = Math.max(0, (nowTime - scrapedTime) / 86400000);
  return ageDays <= 2 ? 10 : ageDays <= 7 ? 6 : 2;
}

function confidenceScore(confidence) {
  if (confidence === "high") return HISTORICAL_RANKING_WEIGHTS.confidence;
  if (confidence === "medium") return 3;
  return 0;
}

function historicalValueScore(historicalDiscountPercent) {
  const discount = Math.max(0, finiteNumber(historicalDiscountPercent) || 0);
  return roundedComponent(
    (Math.min(discount, DEAL_RANKING_THRESHOLDS.maximumHistoricalValuePercent)
      / DEAL_RANKING_THRESHOLDS.maximumHistoricalValuePercent)
      * HISTORICAL_RANKING_WEIGHTS.historicalValue,
  );
}

function proximityToLowScore(distanceFromLowestPercent) {
  const distance = finiteNumber(distanceFromLowestPercent);
  if (distance === null || distance < 0 || distance > 10) return 0;
  if (distance <= 1) return 20;
  if (distance <= 3) return roundedComponent(20 - ((distance - 1) / 2) * 4);
  if (distance <= 5) return roundedComponent(16 - ((distance - 3) / 2) * 4);
  return roundedComponent(12 - ((distance - 5) / 5) * 12);
}

function nonlinearSavingsScore(savingsCents, capMad, maximum) {
  const savingsMad = Math.max(0, finiteNumber(savingsCents) || 0) / 100;
  if (savingsMad <= 0) return 0;
  const ratio = Math.min(savingsMad, capMad) / capMad;
  return roundedComponent(Math.sqrt(ratio) * maximum);
}

function advertisedMetadata(product) {
  const price = positivePrice(product?.priceCents);
  const original = positivePrice(product?.originalPriceCents);
  const savingsCents = price !== null && original !== null && original > price
    ? original - price
    : 0;
  const explicitDiscount = finiteNumber(product?.discountPercent);
  const discountPercent = explicitDiscount !== null
    ? explicitDiscount
    : original !== null && price !== null && original > 0
      ? ((original - price) / original) * 100
      : 0;
  return {
    priceCents: price,
    originalPriceCents: original,
    savingsCents,
    discountPercent: finiteNumber(discountPercent) || 0,
  };
}

function historicalEligibility(stats) {
  const discount = finiteNumber(stats?.historicalDiscountPercent);
  const distance = finiteNumber(stats?.distanceFromLowestPercent);
  const verdict = stats?.dealVerdict?.code;
  const meaningfulDiscount = discount !== null
    && discount >= DEAL_RANKING_THRESHOLDS.minimumHistoricalDiscountPercent;
  const meaningfullyNearLow = discount !== null
    && discount >= DEAL_RANKING_THRESHOLDS.minimumNearLowDiscountPercent
    && distance !== null
    && distance <= DEAL_RANKING_THRESHOLDS.maximumNearLowDistancePercent;
  const positiveVerdict = verdict === "good" || verdict === "exceptional";
  return {
    isDeal: Boolean(meaningfulDiscount || meaningfullyNearLow || positiveVerdict),
    reason: meaningfulDiscount
      ? "historical_discount"
      : meaningfullyNearLow
        ? "near_historical_low"
        : positiveVerdict
          ? "historical_verdict"
          : "normal_historical_price",
  };
}

function canUseHistoricalRanking(stats) {
  return (
    (stats?.confidence === "medium" || stats?.confidence === "high")
    && stats?.freshness?.status !== "very_stale"
    && stats?.freshness?.status !== "unknown"
  );
}

function rankHistorically(product, stats) {
  const currentPriceCents = positivePrice(product?.priceCents)
    ?? positivePrice(stats?.currentPriceCents);
  const medianPriceCents = positivePrice(stats?.medianPriceCents);
  const historicalSavingsCents = currentPriceCents !== null && medianPriceCents !== null
    ? Math.max(0, medianPriceCents - currentPriceCents)
    : 0;
  const components = {
    ...EMPTY_COMPONENTS,
    historicalValue: historicalValueScore(stats?.historicalDiscountPercent),
    proximityToLow: proximityToLowScore(stats?.distanceFromLowestPercent),
    historicalSavings: nonlinearSavingsScore(
      historicalSavingsCents,
      DEAL_RANKING_THRESHOLDS.historicalSavingsCapMad,
      HISTORICAL_RANKING_WEIGHTS.historicalSavings,
    ),
    availability: availabilityScore(product?.availability),
    freshness: historicalFreshnessScore(stats?.freshness),
    confidence: confidenceScore(stats?.confidence),
  };
  const eligibility = currentPriceCents === null
    ? { isDeal: false, reason: "invalid_current_price" }
    : historicalEligibility(stats);
  return {
    score: boundedScore(Object.values(components).reduce((total, value) => total + value, 0)),
    mode: "historical",
    components,
    eligibility,
    historicalSavingsCents,
  };
}

function rankWithRetailerFallback(product, stats, now) {
  const metadata = advertisedMetadata(product);
  const discount = metadata.discountPercent;
  const hasMeaningfulPromotion = (
    metadata.priceCents !== null
    && metadata.originalPriceCents !== null
    && metadata.originalPriceCents > metadata.priceCents
    && discount >= DEAL_RANKING_THRESHOLDS.minimumFallbackDiscountPercent
    && discount <= DEAL_RANKING_THRESHOLDS.maximumFallbackDiscountPercent
    && metadata.savingsCents >= DEAL_RANKING_THRESHOLDS.minimumFallbackSavingsCents
  );
  const suspiciousPenalty = discount > DEAL_RANKING_THRESHOLDS.suspiciousFallbackDiscountPercent
    ? DEAL_RANKING_THRESHOLDS.suspiciousFallbackPenalty
    : 0;
  const components = {
    ...EMPTY_COMPONENTS,
    availability: availabilityScore(product?.availability),
    freshness: currentOfferFreshnessScore(product?.scrapedAt, now),
    advertisedValue: roundedComponent(
      (Math.min(Math.max(0, discount), 50) / 50) * RETAILER_FALLBACK_WEIGHTS.advertisedValue,
    ),
    advertisedSavings: nonlinearSavingsScore(
      metadata.savingsCents,
      DEAL_RANKING_THRESHOLDS.fallbackSavingsCapMad,
      RETAILER_FALLBACK_WEIGHTS.advertisedSavings,
    ),
    suspiciousClaimPenalty: -suspiciousPenalty,
  };
  const rawScore = Object.values(components).reduce((total, value) => total + value, 0);
  const reason = stats?.freshness?.status === "very_stale"
    ? "very_stale_history_fallback"
    : stats?.confidence === "insufficient"
      ? "insufficient_history_fallback"
      : "missing_history_fallback";
  return {
    score: hasMeaningfulPromotion
      ? boundedScore(rawScore, DEAL_RANKING_THRESHOLDS.fallbackScoreCap)
      : 0,
    mode: "retailer_fallback",
    components,
    eligibility: {
      isDeal: hasMeaningfulPromotion,
      reason: hasMeaningfulPromotion ? reason : "no_meaningful_retailer_promotion",
    },
    historicalSavingsCents: 0,
  };
}

export function rankingQuality(score) {
  const bounded = boundedScore(score);
  if (bounded >= 85) return "Exceptionnelle";
  if (bounded >= 72) return "Excellente";
  if (bounded >= 60) return "Très bonne";
  return "Bonne";
}

export function rankDeal({ product = {}, historicalStats = null, now = new Date() } = {}) {
  if (canUseHistoricalRanking(historicalStats)) {
    return rankHistorically(product, historicalStats);
  }
  return rankWithRetailerFallback(product, historicalStats, now);
}

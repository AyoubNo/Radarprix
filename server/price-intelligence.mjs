export const DEFAULT_HISTORY_WINDOW_DAYS = 90;
export const MAX_HISTORY_WINDOW_DAYS = 365;

export const PRICE_INTELLIGENCE_THRESHOLDS = Object.freeze({
  minimumObservations: 7,
  highConfidenceObservations: 30,
  minimumMeaningfulClaimedDiscountPercent: 0,
  exaggeratedClaimedDiscountPercent: 15,
  exaggeratedClaimGapPoints: 10,
  exceptionalHistoricalDiscountPercent: 15,
  exceptionalLowestDistancePercent: 1,
  minimumExceptionalLowestDiscountPercent: 3,
  goodHistoricalDiscountPercent: 7,
  goodLowestDistancePercent: 5,
  minimumGoodLowestDiscountPercent: 1,
  expensiveHistoricalDiscountPercent: -5,
});

export const HISTORY_FRESHNESS_THRESHOLDS = Object.freeze({
  freshHours: 24,
  staleHours: 72,
});

const DEAL_VERDICTS = Object.freeze({
  insufficient_history: Object.freeze({
    code: "insufficient_history",
    label: "Pas encore assez de données",
  }),
  stale_history: Object.freeze({
    code: "insufficient_history",
    label: "Données trop anciennes pour confirmer",
  }),
  exceptional: Object.freeze({ code: "exceptional", label: "Prix exceptionnel" }),
  good: Object.freeze({ code: "good", label: "Bonne affaire" }),
  normal: Object.freeze({ code: "normal", label: "Prix habituel" }),
  expensive: Object.freeze({ code: "expensive", label: "Plus cher que d'habitude" }),
});

const CLAIM_ASSESSMENTS = Object.freeze({
  unknown: Object.freeze({
    code: "unknown",
    label: "Pas assez de données pour vérifier la remise affichée",
  }),
  representative: Object.freeze({
    code: "representative",
    label: "Remise cohérente avec l'historique",
  }),
  exaggerated: Object.freeze({
    code: "exaggerated",
    label: "Remise affichée supérieure à la baisse observée",
  }),
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function priceFrom(value) {
  const price = finiteNumber(typeof value === "object" && value !== null ? value.priceCents : value);
  return price !== null && price > 0 ? price : null;
}

function integerPrice(value) {
  const price = priceFrom(value);
  return price === null ? null : Math.round(price);
}

function roundPercent(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function observedAt(observation) {
  return observation?.observedAt || observation?.observedDate || null;
}

function compareObservations(left, right) {
  const leftValue = observedAt(left) || "";
  const rightValue = observedAt(right) || "";
  return leftValue.localeCompare(rightValue);
}

export function normalizeHistoryWindowDays(days = DEFAULT_HISTORY_WINDOW_DAYS) {
  if (days === null || days === undefined || days === "") return DEFAULT_HISTORY_WINDOW_DAYS;
  const value = Number(days);
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_WINDOW_DAYS;
  return Math.min(MAX_HISTORY_WINDOW_DAYS, Math.max(1, Math.floor(value)));
}

export function medianPrice(values = []) {
  const prices = values
    .map(priceFrom)
    .filter((price) => price !== null)
    .sort((left, right) => left - right);
  if (prices.length === 0) return null;
  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2 === 1) return Math.round(prices[middle]);
  return Math.round((prices[middle - 1] + prices[middle]) / 2);
}

export function historyConfidence(observations) {
  const count = Array.isArray(observations)
    ? observations.length
    : Math.max(0, Math.floor(finiteNumber(observations) || 0));
  if (count < PRICE_INTELLIGENCE_THRESHOLDS.minimumObservations) return "insufficient";
  if (count < PRICE_INTELLIGENCE_THRESHOLDS.highConfidenceObservations) return "medium";
  return "high";
}

export function historyFreshness(lastObservedAt, now = new Date()) {
  if (!lastObservedAt) {
    return { status: "unknown", ageHours: null, lastObservedAt: null };
  }
  const observedTime = new Date(lastObservedAt).getTime();
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(observedTime) || !Number.isFinite(nowTime)) {
    return { status: "unknown", ageHours: null, lastObservedAt: null };
  }

  const ageHoursValue = Math.max(0, (nowTime - observedTime) / (60 * 60 * 1000));
  const ageHours = roundPercent(ageHoursValue);
  const thresholds = HISTORY_FRESHNESS_THRESHOLDS;
  const status = ageHoursValue <= thresholds.freshHours
    ? "fresh"
    : ageHoursValue <= thresholds.staleHours
      ? "stale"
      : "very_stale";
  return {
    status,
    ageHours,
    lastObservedAt: typeof lastObservedAt === "string"
      ? lastObservedAt
      : new Date(observedTime).toISOString(),
  };
}

export function buildDealVerdict({
  observationsCount,
  historicalDiscountPercent,
  distanceFromLowestPercent,
  currentPriceCents,
  previousLowestPriceCents,
  freshness,
}) {
  const thresholds = PRICE_INTELLIGENCE_THRESHOLDS;
  if (historyConfidence(observationsCount) === "insufficient") {
    return { ...DEAL_VERDICTS.insufficient_history };
  }
  if (freshness?.status === "very_stale") {
    return { ...DEAL_VERDICTS.stale_history };
  }

  const historicalDiscount = finiteNumber(historicalDiscountPercent);
  const distanceFromLowest = finiteNumber(distanceFromLowestPercent);
  const currentPrice = integerPrice(currentPriceCents);
  const previousLowest = integerPrice(previousLowestPriceCents);
  const isMeaningfullyAtLowest = historicalDiscount !== null
    && historicalDiscount >= thresholds.minimumExceptionalLowestDiscountPercent
    && distanceFromLowest !== null
    && distanceFromLowest <= thresholds.exceptionalLowestDistancePercent
    && previousLowest !== null
    && currentPrice !== null
    && currentPrice <= previousLowest;
  if (
    (historicalDiscount !== null && historicalDiscount >= thresholds.exceptionalHistoricalDiscountPercent)
    || isMeaningfullyAtLowest
  ) {
    return { ...DEAL_VERDICTS.exceptional };
  }

  const isNearLowest = historicalDiscount !== null
    && historicalDiscount >= thresholds.minimumGoodLowestDiscountPercent
    && distanceFromLowest !== null
    && distanceFromLowest <= thresholds.goodLowestDistancePercent;
  if (
    (historicalDiscount !== null && historicalDiscount >= thresholds.goodHistoricalDiscountPercent)
    || isNearLowest
  ) {
    return { ...DEAL_VERDICTS.good };
  }

  if (historicalDiscount !== null && historicalDiscount <= thresholds.expensiveHistoricalDiscountPercent) {
    return { ...DEAL_VERDICTS.expensive };
  }
  return { ...DEAL_VERDICTS.normal };
}

export function assessDiscountClaim({
  observationsCount,
  claimedDiscountPercent,
  historicalDiscountPercent,
}) {
  const thresholds = PRICE_INTELLIGENCE_THRESHOLDS;
  const claimedDiscount = finiteNumber(claimedDiscountPercent);
  const historicalDiscount = finiteNumber(historicalDiscountPercent);
  if (
    historyConfidence(observationsCount) === "insufficient"
    || claimedDiscount === null
    || claimedDiscount <= thresholds.minimumMeaningfulClaimedDiscountPercent
    || historicalDiscount === null
  ) {
    return { ...CLAIM_ASSESSMENTS.unknown };
  }
  if (
    claimedDiscount >= thresholds.exaggeratedClaimedDiscountPercent
    && claimedDiscount - Math.max(0, historicalDiscount) >= thresholds.exaggeratedClaimGapPoints
  ) {
    return { ...CLAIM_ASSESSMENTS.exaggerated };
  }
  return { ...CLAIM_ASSESSMENTS.representative };
}

/** @deprecated Use buildDealVerdict(). Retailer claim credibility is assessed separately. */
export const priceVerdict = buildDealVerdict;

export function buildPriceStatsFromAggregates({
  windowDays = DEFAULT_HISTORY_WINDOW_DAYS,
  observationsCount = 0,
  currentPriceCents,
  medianPriceCents,
  averagePriceCents,
  lowestPriceCents,
  highestPriceCents,
  previousLowestPriceCents,
  claimedOriginalPriceCents,
  claimedDiscountPercent,
  firstObservedAt = null,
  lastObservedAt = null,
  freshnessObservedAt = lastObservedAt,
  now = new Date(),
} = {}) {
  const count = Math.max(0, Math.floor(finiteNumber(observationsCount) || 0));
  const currentPrice = integerPrice(currentPriceCents);
  const median = integerPrice(medianPriceCents);
  const average = integerPrice(averagePriceCents);
  const lowest = integerPrice(lowestPriceCents);
  const highest = integerPrice(highestPriceCents);
  const previousLowest = integerPrice(previousLowestPriceCents);
  const originalPrice = integerPrice(claimedOriginalPriceCents);
  let claimedDiscount = finiteNumber(claimedDiscountPercent);
  if (claimedDiscount === null && originalPrice !== null && currentPrice !== null && originalPrice > 0) {
    claimedDiscount = ((originalPrice - currentPrice) / originalPrice) * 100;
  }
  claimedDiscount = roundPercent(claimedDiscount);

  const historicalDiscount = median !== null && currentPrice !== null
    ? roundPercent(((median - currentPrice) / median) * 100)
    : null;
  const differenceFromAverage = average !== null && currentPrice !== null
    ? roundPercent(((currentPrice - average) / average) * 100)
    : null;
  const distanceFromLowest = lowest !== null && currentPrice !== null
    ? roundPercent(Math.max(0, ((currentPrice - lowest) / lowest) * 100))
    : null;
  const confidence = historyConfidence(count);
  const freshness = historyFreshness(freshnessObservedAt, now);
  const dealVerdict = buildDealVerdict({
    observationsCount: count,
    historicalDiscountPercent: historicalDiscount,
    distanceFromLowestPercent: distanceFromLowest,
    currentPriceCents: currentPrice,
    previousLowestPriceCents: previousLowest,
    freshness,
  });
  const claimAssessment = assessDiscountClaim({
    observationsCount: count,
    claimedDiscountPercent: claimedDiscount,
    historicalDiscountPercent: historicalDiscount,
  });

  return {
    windowDays: normalizeHistoryWindowDays(windowDays),
    observationsCount: count,
    currentPriceCents: currentPrice,
    medianPriceCents: median,
    averagePriceCents: average,
    lowestPriceCents: lowest,
    highestPriceCents: highest,
    previousLowestPriceCents: previousLowest,
    claimedOriginalPriceCents: originalPrice,
    claimedDiscountPercent: claimedDiscount,
    historicalDiscountPercent: historicalDiscount,
    differenceFromAveragePercent: differenceFromAverage,
    distanceFromLowestPercent: distanceFromLowest,
    confidence,
    dealVerdict,
    claimAssessment,
    freshness,
    // Deprecated compatibility alias. All deal-quality logic lives in buildDealVerdict().
    verdict: dealVerdict,
    firstObservedAt: firstObservedAt || null,
    lastObservedAt: lastObservedAt || null,
  };
}

export function buildPriceStats({
  history = [],
  windowDays = DEFAULT_HISTORY_WINDOW_DAYS,
  currentPriceCents,
  claimedOriginalPriceCents,
  claimedDiscountPercent,
  now = new Date(),
} = {}) {
  const observations = (Array.isArray(history) ? history : [])
    .filter((observation) => priceFrom(observation) !== null)
    .slice()
    .sort(compareObservations);
  const prices = observations.map((observation) => integerPrice(observation));
  const latestObservation = observations.at(-1) || null;
  const explicitCurrentPrice = integerPrice(currentPriceCents);
  const currentPrice = explicitCurrentPrice ?? integerPrice(latestObservation);
  const median = medianPrice(prices);
  const average = prices.length > 0
    ? Math.round(prices.reduce((total, price) => total + price, 0) / prices.length)
    : null;
  const lowest = prices.length > 0 ? Math.min(...prices) : null;
  const highest = prices.length > 0 ? Math.max(...prices) : null;

  const latestIsCurrent = latestObservation !== null
    && currentPrice !== null
    && integerPrice(latestObservation) === currentPrice;
  const previousPrices = latestIsCurrent ? prices.slice(0, -1) : prices;
  const previousLowest = previousPrices.length > 0 ? Math.min(...previousPrices) : null;

  const originalSource = claimedOriginalPriceCents === undefined
    ? latestObservation?.originalPriceCents
    : claimedOriginalPriceCents;
  const originalPrice = integerPrice(originalSource);
  const claimedSource = claimedDiscountPercent === undefined
    ? latestObservation?.discountPercent
    : claimedDiscountPercent;
  return buildPriceStatsFromAggregates({
    windowDays,
    observationsCount: observations.length,
    currentPriceCents: currentPrice,
    medianPriceCents: median,
    averagePriceCents: average,
    lowestPriceCents: lowest,
    highestPriceCents: highest,
    previousLowestPriceCents: previousLowest,
    claimedOriginalPriceCents: originalPrice,
    claimedDiscountPercent: claimedSource,
    firstObservedAt: observedAt(observations[0]) || null,
    lastObservedAt: observedAt(latestObservation) || null,
    freshnessObservedAt: latestObservation?.observedAt || null,
    now,
  });
}

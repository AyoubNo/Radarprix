export const DEFAULT_HISTORY_WINDOW_DAYS = 90;
export const MAX_HISTORY_WINDOW_DAYS = 365;

export const PRICE_INTELLIGENCE_THRESHOLDS = Object.freeze({
  minimumObservations: 7,
  highConfidenceObservations: 30,
  suspiciousClaimedDiscountPercent: 15,
  suspiciousDiscountGapPoints: 10,
  exceptionalHistoricalDiscountPercent: 15,
  exceptionalLowestDistancePercent: 1,
  goodHistoricalDiscountPercent: 7,
  goodLowestDistancePercent: 5,
  expensiveHistoricalDiscountPercent: -5,
});

const VERDICTS = Object.freeze({
  insufficient_history: Object.freeze({
    code: "insufficient_history",
    label: "Pas encore assez de données",
  }),
  exceptional: Object.freeze({ code: "exceptional", label: "Prix exceptionnel" }),
  good: Object.freeze({ code: "good", label: "Bonne affaire" }),
  normal: Object.freeze({ code: "normal", label: "Prix habituel" }),
  expensive: Object.freeze({ code: "expensive", label: "Plus cher que d'habitude" }),
  suspicious_promotion: Object.freeze({
    code: "suspicious_promotion",
    label: "Remise affichée peu représentative du prix habituel",
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

export function priceVerdict({
  observationsCount,
  claimedDiscountPercent,
  historicalDiscountPercent,
  distanceFromLowestPercent,
  currentPriceCents,
  previousLowestPriceCents,
}) {
  const thresholds = PRICE_INTELLIGENCE_THRESHOLDS;
  if (historyConfidence(observationsCount) === "insufficient") {
    return { ...VERDICTS.insufficient_history };
  }

  const claimedDiscount = finiteNumber(claimedDiscountPercent);
  const historicalDiscount = finiteNumber(historicalDiscountPercent);
  const distanceFromLowest = finiteNumber(distanceFromLowestPercent);
  if (
    claimedDiscount !== null
    && claimedDiscount >= thresholds.suspiciousClaimedDiscountPercent
    && claimedDiscount - Math.max(0, historicalDiscount || 0) >= thresholds.suspiciousDiscountGapPoints
  ) {
    return { ...VERDICTS.suspicious_promotion };
  }

  const currentPrice = integerPrice(currentPriceCents);
  const previousLowest = integerPrice(previousLowestPriceCents);
  const isMeaningfullyAtLowest = historicalDiscount !== null
    && historicalDiscount > 0
    && distanceFromLowest !== null
    && distanceFromLowest <= thresholds.exceptionalLowestDistancePercent
    && previousLowest !== null
    && currentPrice !== null
    && currentPrice <= previousLowest;
  if (
    (historicalDiscount !== null && historicalDiscount >= thresholds.exceptionalHistoricalDiscountPercent)
    || isMeaningfullyAtLowest
  ) {
    return { ...VERDICTS.exceptional };
  }

  const isNearLowest = historicalDiscount !== null
    && historicalDiscount > 0
    && distanceFromLowest !== null
    && distanceFromLowest <= thresholds.goodLowestDistancePercent;
  if (
    (historicalDiscount !== null && historicalDiscount >= thresholds.goodHistoricalDiscountPercent)
    || isNearLowest
  ) {
    return { ...VERDICTS.good };
  }

  if (historicalDiscount !== null && historicalDiscount <= thresholds.expensiveHistoricalDiscountPercent) {
    return { ...VERDICTS.expensive };
  }
  return { ...VERDICTS.normal };
}

export function buildPriceStats({
  history = [],
  windowDays = DEFAULT_HISTORY_WINDOW_DAYS,
  currentPriceCents,
  claimedOriginalPriceCents,
  claimedDiscountPercent,
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
  let claimedDiscount = finiteNumber(claimedSource);
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
  const confidence = historyConfidence(observations.length);
  const verdict = priceVerdict({
    observationsCount: observations.length,
    claimedDiscountPercent: claimedDiscount,
    historicalDiscountPercent: historicalDiscount,
    distanceFromLowestPercent: distanceFromLowest,
    currentPriceCents: currentPrice,
    previousLowestPriceCents: previousLowest,
  });

  return {
    windowDays: normalizeHistoryWindowDays(windowDays),
    observationsCount: observations.length,
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
    verdict,
    firstObservedAt: observedAt(observations[0]) || null,
    lastObservedAt: observedAt(latestObservation) || null,
  };
}

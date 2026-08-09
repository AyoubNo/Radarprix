const madNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const percentageNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedCoordinate(value) {
  return Math.round(value * 100) / 100;
}

/** @param {number | null | undefined} priceCents */
export function formatMad(priceCents) {
  const value = finiteNumber(priceCents);
  return value === null ? "—" : `${madNumber.format(Math.round(value) / 100)} DH`;
}

/** @param {number | null | undefined} discountPercent */
export function formatAdvertisedDiscount(discountPercent) {
  const value = finiteNumber(discountPercent);
  if (value === null || value <= 0) return "—";
  return `−${percentageNumber.format(Math.abs(value))} %`;
}

/** @param {number | null | undefined} historicalDiscountPercent */
export function formatHistoricalPercentage(historicalDiscountPercent) {
  const value = finiteNumber(historicalDiscountPercent);
  if (value === null) return "—";
  if (value === 0) return "0 %";
  const sign = value > 0 ? "−" : "+";
  return `${sign}${percentageNumber.format(Math.abs(value))} %`;
}

/** @param {number | null | undefined} historicalDiscountPercent */
export function historicalDifferenceText(historicalDiscountPercent) {
  const value = finiteNumber(historicalDiscountPercent);
  if (value === null) return "Comparaison historique indisponible";
  if (value > 0) return `${percentageNumber.format(value)} % sous le prix habituel`;
  if (value < 0) return `${percentageNumber.format(Math.abs(value))} % plus cher que le prix habituel`;
  return "Au niveau du prix habituel";
}

/** @param {string | null | undefined} confidence */
export function confidenceLabel(confidence) {
  return {
    insufficient: "Historique limité",
    medium: "Historique intermédiaire",
    high: "Historique solide",
  }[confidence] || "Niveau d’historique inconnu";
}

/** @param {{ status: string; ageHours: number | null } | null | undefined} freshness */
export function freshnessLabel(freshness) {
  if (!freshness || freshness.status === "unknown") return "Date de vérification inconnue";
  if (freshness.status === "fresh") return "Prix vérifié récemment";
  if (freshness.status === "very_stale") return "Données anciennes";
  const age = finiteNumber(freshness.ageHours);
  if (age === null) return "Dernier relevé ancien";
  const roundedAge = Math.max(1, Math.round(age));
  return `Dernier relevé il y a ${roundedAge} heure${roundedAge > 1 ? "s" : ""}`;
}

/** @param {string | null | undefined} value */
export function formatFrenchDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * @param {Array<{ observedDate?: string; priceCents?: number }>} history
 * @param {number | null | undefined} medianPriceCents
 * @param {{ width?: number; height?: number }} options
 */
export function createPriceChartModel(history = [], medianPriceCents = null, options = {}) {
  const width = Math.max(240, finiteNumber(options.width) || 720);
  const height = Math.max(160, finiteNumber(options.height) || 260);
  const padding = { left: 58, right: 18, top: 22, bottom: 42 };
  const observations = (Array.isArray(history) ? history : [])
    .map((observation) => {
      const priceCents = finiteNumber(observation?.priceCents);
      const timestamp = Date.parse(observation?.observedDate || "");
      if (priceCents === null || priceCents <= 0 || !Number.isFinite(timestamp)) return null;
      return {
        observedDate: observation.observedDate,
        priceCents: Math.round(priceCents),
        timestamp,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (observations.length === 0) {
    return {
      width,
      height,
      padding,
      points: [],
      path: "",
      medianY: null,
      minPriceCents: null,
      maxPriceCents: null,
    };
  }

  const median = finiteNumber(medianPriceCents);
  const domainPrices = observations.map((observation) => observation.priceCents);
  if (median !== null && median > 0) domainPrices.push(median);
  let domainMin = Math.min(...domainPrices);
  let domainMax = Math.max(...domainPrices);
  const minPriceCents = Math.min(...observations.map((observation) => observation.priceCents));
  const maxPriceCents = Math.max(...observations.map((observation) => observation.priceCents));
  if (domainMin === domainMax) {
    const breathingRoom = Math.max(1, domainMin * 0.05);
    domainMin -= breathingRoom;
    domainMax += breathingRoom;
  }

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const firstTime = observations[0].timestamp;
  const lastTime = observations.at(-1).timestamp;
  const timeRange = lastTime - firstTime;
  const priceRange = domainMax - domainMin;
  const yForPrice = (price) => padding.top + ((domainMax - price) / priceRange) * plotHeight;
  const points = observations.map((observation, index) => {
    const x = observations.length === 1
      ? padding.left + plotWidth / 2
      : timeRange > 0
        ? padding.left + ((observation.timestamp - firstTime) / timeRange) * plotWidth
        : padding.left + (index / (observations.length - 1)) * plotWidth;
    return {
      ...observation,
      x: roundedCoordinate(x),
      y: roundedCoordinate(yForPrice(observation.priceCents)),
    };
  });

  return {
    width,
    height,
    padding,
    points,
    path: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "),
    medianY: median !== null && median > 0 ? roundedCoordinate(yForPrice(median)) : null,
    minPriceCents,
    maxPriceCents,
  };
}

import { resolveSiteOrigin } from "./runtime-config.mjs";

const MAX_SLUG_LENGTH = 80;
const configuredProductionFlag = process.env.PRIXRADAR_RUNTIME_PRODUCTION;
const bundledSiteEnvironment = {
  NODE_ENV: configuredProductionFlag === undefined
    ? process.env.NODE_ENV
    : configuredProductionFlag === "true" ? "production" : "development",
  PRIXRADAR_SITE_URL: process.env.PRIXRADAR_SITE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positivePrice(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? Math.round(number) : null;
}

function trimText(value, maximum) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function formatMad(priceCents) {
  const price = positivePrice(priceCents);
  if (price === null) return null;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(price / 100)} DH`;
}

function formatPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Math.abs(number));
}

export function productSlug(name, maximumLength = MAX_SLUG_LENGTH) {
  const maximum = Math.min(120, Math.max(24, Number(maximumLength) || MAX_SLUG_LENGTH));
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maximum)
    .replace(/-+$/g, "");
  return slug || "produit";
}

export function normalizeLogicalProductId(value) {
  const id = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return id.length >= 8 && id.length <= 32 ? id : null;
}

export function productPath(logicalProductId, name) {
  const id = normalizeLogicalProductId(logicalProductId);
  if (!id) throw new TypeError("A valid logical product ID is required");
  return `/produit/${id}/${productSlug(name)}`;
}

export function siteOrigin(environment) {
  return resolveSiteOrigin(environment || bundledSiteEnvironment);
}

export function absoluteProductUrl(detail, origin = siteOrigin()) {
  return new URL(detail.canonicalPath || productPath(detail.id, detail.name), `${origin}/`).href;
}

export function isSeoReadyProduct(detail) {
  const offers = Array.isArray(detail?.offers) ? detail.offers : [];
  const hasCurrentOffer = offers.some((offer) => positivePrice(offer?.priceCents) !== null);
  const hasIdentity = Boolean(normalizeLogicalProductId(detail?.id));
  const hasUsefulName = String(detail?.name || "").trim().length >= 4;
  const observations = Math.max(0, Number(detail?.stats?.observationsCount) || 0);
  const hasOriginalValue = observations >= 7
    || offers.length >= 2
    || detail?.ranking?.mode === "historical";
  return hasIdentity && hasUsefulName && hasCurrentOffer && hasOriginalValue;
}

export function buildHistoricalExplanation(detail) {
  const stats = detail?.stats || {};
  const current = formatMad(stats.currentPriceCents ?? detail?.bestOffer?.priceCents);
  const median = formatMad(stats.medianPriceCents);
  const discount = finiteNumber(stats.historicalDiscountPercent);
  const distance = finiteNumber(stats.distanceFromLowestPercent);
  const observations = Math.max(0, Math.floor(Number(stats.observationsCount) || 0));
  const windowDays = Math.max(1, Math.floor(Number(stats.windowDays) || 90));
  const sentences = [];

  if (observations === 0) {
    sentences.push("PrixRadar commence à suivre ce produit et ne dispose pas encore d’un historique exploitable.");
  } else {
    sentences.push(`PrixRadar a observé ce produit ${observations} fois sur les ${windowDays} derniers jours.`);
  }
  if (median) sentences.push(`Son prix habituel, calculé à partir de la médiane observée, est de ${median}.`);
  if (current && discount !== null) {
    const direction = discount > 0 ? "inférieur" : discount < 0 ? "supérieur" : "identique";
    const comparison = discount === 0
      ? `Le prix actuel de ${current} est identique à ce niveau.`
      : `Le prix actuel de ${current} est environ ${formatPercent(discount)}% ${direction} à ce niveau.`;
    sentences.push(comparison);
  }
  if (distance !== null && distance >= 0 && stats.lowestPriceCents) {
    sentences.push(`Il se situe à ${formatPercent(distance)}% du plus bas prix observé sur la période.`);
  }
  if (stats.dealVerdict?.label) sentences.push(`PrixRadar classe actuellement ce prix comme « ${stats.dealVerdict.label} ».`);
  return sentences.join(" ");
}

export function buildProductMetadata(detail, origin = siteOrigin()) {
  const rawName = String(detail?.name || "Produit").replace(/\s+/g, " ").trim();
  const descriptiveSuffix = " : prix Maroc et historique | PrixRadar";
  const compactSuffix = " : prix au Maroc | PrixRadar";
  const titleSuffix = rawName.length + descriptiveSuffix.length <= 65 ? descriptiveSuffix : compactSuffix;
  const titleName = trimText(rawName, 65 - titleSuffix.length);
  const name = trimText(rawName, 48);
  const current = formatMad(detail?.bestOffer?.priceCents);
  const offerCount = Math.max(1, Array.isArray(detail?.offers) ? detail.offers.length : 1);
  const title = `${titleName}${titleSuffix}`;
  const pricePhrase = current ? ` Son prix actuel commence à ${current}.` : "";
  const description = trimText(
    `Comparez le prix de ${name} au Maroc.${pricePhrase} Consultez son prix habituel, son historique et ${offerCount} offre${offerCount > 1 ? "s" : ""} disponible${offerCount > 1 ? "s" : ""}.`,
    160,
  );
  const canonical = absoluteProductUrl(detail, origin);
  const productImage = detail?.imageUrl && /^https?:\/\//i.test(detail.imageUrl)
    ? detail.imageUrl
    : new URL("/favicon.svg", `${origin}/`).href;
  return {
    title,
    description,
    canonical,
    image: productImage,
    robots: isSeoReadyProduct(detail) ? "index, follow" : "noindex, follow",
  };
}

function schemaAvailability(value) {
  if (value === "in_stock") return "https://schema.org/InStock";
  if (value === "out_of_stock") return "https://schema.org/OutOfStock";
  return "https://schema.org/LimitedAvailability";
}

export function buildProductStructuredData(detail, origin = siteOrigin()) {
  const offers = (Array.isArray(detail?.offers) ? detail.offers : [])
    .map((offer) => ({ ...offer, priceCents: positivePrice(offer?.priceCents) }))
    .filter((offer) => offer.priceCents !== null);
  if (!detail?.name || offers.length === 0) return null;
  const prices = offers.map((offer) => offer.priceCents / 100);
  const canonical = absoluteProductUrl(detail, origin);
  const structuredOffer = offers.length === 1
    ? {
      "@type": "Offer",
      price: prices[0],
      priceCurrency: "MAD",
      availability: schemaAvailability(offers[0].availability),
      url: offers[0].productUrl || canonical,
      seller: offers[0].site ? { "@type": "Organization", name: offers[0].site } : undefined,
    }
    : {
      "@type": "AggregateOffer",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      priceCurrency: "MAD",
      offerCount: offers.length,
    };
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.name,
    description: buildHistoricalExplanation(detail),
    category: detail.category || undefined,
    image: detail.imageUrl || undefined,
    url: canonical,
    offers: structuredOffer,
  };
  return JSON.parse(JSON.stringify(product));
}

export function buildBreadcrumbStructuredData(detail, origin = siteOrigin()) {
  const canonical = absoluteProductUrl(detail, origin);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: detail.universeLabel || detail.category || "Produits", item: `${origin}/#classement` },
      { "@type": "ListItem", position: 3, name: detail.name, item: canonical },
    ],
  };
}

import { cache } from "react";
import type { ProductDetail, ProductIndexEntry } from "./components/product-detail-types";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { resolveInternalApiOrigin } from "../server/runtime-config.mjs";

const configuredProductionFlag = process.env.PRIXRADAR_RUNTIME_PRODUCTION;
const bundledInternalApiEnvironment = {
  NODE_ENV: configuredProductionFlag === undefined
    ? process.env.NODE_ENV
    : configuredProductionFlag === "true" ? "production" : "development",
  PRIXRADAR_API_INTERNAL_URL: process.env.PRIXRADAR_API_INTERNAL_URL,
};

function apiOrigin() {
  return resolveInternalApiOrigin(bundledInternalApiEnvironment);
}

function isProductDetail(value: unknown): value is ProductDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<ProductDetail>;
  return typeof detail.id === "string"
    && typeof detail.name === "string"
    && Array.isArray(detail.offers)
    && Boolean(detail.bestOffer)
    && Boolean(detail.stats);
}

export const loadProductDetail = cache(async (id: string, days = 90): Promise<ProductDetail | null> => {
  const safeId = String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (safeId.length < 8 || safeId.length > 32) return null;
  const response = await fetchWithTimeout(`${apiOrigin()}/api/product/${safeId}?days=${days}`, {
    next: { revalidate: 300 },
    timeoutMs: 5_000,
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Product data is temporarily unavailable");
  const payload: unknown = await response.json();
  if (!isProductDetail(payload)) throw new Error("Product API returned an invalid response");
  return payload;
});

export async function loadProductIndex(): Promise<ProductIndexEntry[]> {
  const response = await fetchWithTimeout(`${apiOrigin()}/api/product-index`, {
    next: { revalidate: 300 },
    timeoutMs: 8_000,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Product index is temporarily unavailable");
  const payload = await response.json() as { products?: ProductIndexEntry[] };
  return Array.isArray(payload.products) ? payload.products : [];
}

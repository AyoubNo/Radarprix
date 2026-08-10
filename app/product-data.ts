import { cache } from "react";
import type { ProductDetail, ProductIndexEntry } from "./components/product-detail-types";

function apiOrigin() {
  const candidate = process.env.PRIXRADAR_API_INTERNAL_URL || "http://127.0.0.1:3500";
  try {
    return new URL(candidate).origin;
  } catch {
    return "http://127.0.0.1:3500";
  }
}

export const loadProductDetail = cache(async (id: string, days = 90): Promise<ProductDetail | null> => {
  const safeId = String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (safeId.length < 8 || safeId.length > 32) return null;
  const response = await fetch(`${apiOrigin()}/api/product/${safeId}?days=${days}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Product API returned ${response.status}`);
  return response.json() as Promise<ProductDetail>;
});

export async function loadProductIndex(): Promise<ProductIndexEntry[]> {
  const response = await fetch(`${apiOrigin()}/api/product-index`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Product index API returned ${response.status}`);
  const payload = await response.json() as { products?: ProductIndexEntry[] };
  return Array.isArray(payload.products) ? payload.products : [];
}

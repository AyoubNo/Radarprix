import type { MetadataRoute } from "next";
import { loadProductIndex } from "./product-data";
import { siteOrigin } from "../server/product-seo.mjs";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const products = await loadProductIndex();
  return [
    { url: `${origin}/`, changeFrequency: "daily", priority: 1 },
    ...products.slice(0, 50_000).map((product) => ({
      url: new URL(product.path, `${origin}/`).href,
      lastModified: product.lastModified ? new Date(product.lastModified) : undefined,
      changeFrequency: "daily" as const,
      priority: .8,
    })),
  ];
}

import type { MetadataRoute } from "next";
import { siteOrigin } from "../server/product-seo.mjs";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${origin}/sitemap.xml`,
  };
}

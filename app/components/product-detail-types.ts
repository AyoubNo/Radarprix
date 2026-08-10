import type {
  ClaimAssessment,
  DealVerdict,
  PriceHistoryObservation,
  ProductPriceStats,
} from "./ProductIntelligenceModal";

export type MerchantOffer = {
  key: string;
  productKey: string;
  site: string;
  name: string;
  priceCents: number;
  originalPriceCents: number | null;
  discountPercent: number | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  productUrl: string;
  imageUrl: string | null;
  imageProxyUrl: string | null;
  scrapedAt: string | null;
  updatedAt: string | null;
};

export type ProductDetail = {
  id: string;
  slug: string;
  canonicalPath: string;
  name: string;
  category: string;
  universe: "pc" | "home";
  universeLabel: string;
  imageUrl: string | null;
  imageProxyUrl: string | null;
  bestOffer: MerchantOffer;
  offers: MerchantOffer[];
  stats: ProductPriceStats;
  history: PriceHistoryObservation[];
  historySource: { productKey: string; site: string };
  ranking: {
    score: number;
    mode: "historical" | "retailer_fallback";
  };
  dealVerdict: DealVerdict;
  claimAssessment: ClaimAssessment;
  lastModified: string | null;
  seoReady: boolean;
};

export type ProductIndexEntry = {
  id: string;
  slug: string;
  path: string;
  lastModified: string | null;
};

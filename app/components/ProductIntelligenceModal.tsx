"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  CircleCheck,
  Clock3,
  ExternalLink,
  Flame,
  GitCompareArrows,
  Info,
  PackageSearch,
  ShieldCheck,
  Store,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  confidenceLabel,
  createPriceChartModel,
  formatAdvertisedDiscount,
  formatFrenchDateTime,
  formatHistoricalPercentage,
  formatMad,
  freshnessLabel,
  historicalDifferenceText,
} from "./price-intelligence-helpers.mjs";
import styles from "./ProductIntelligenceModal.module.css";

export type PriceHistoryObservation = {
  observedDate: string;
  priceCents: number;
  originalPriceCents: number | null;
  discountPercent: number | null;
  availability: string;
  observedAt: string;
};

export type DealVerdict = {
  code: "insufficient_history" | "exceptional" | "good" | "normal" | "expensive";
  label: string;
};

export type ClaimAssessment = {
  code: "unknown" | "representative" | "exaggerated";
  label: string;
};

export type PriceFreshness = {
  status: "fresh" | "stale" | "very_stale" | "unknown";
  ageHours: number | null;
  lastObservedAt: string | null;
};

export type ProductPriceStats = {
  windowDays: number;
  observationsCount: number;
  currentPriceCents: number | null;
  medianPriceCents: number | null;
  averagePriceCents: number | null;
  lowestPriceCents: number | null;
  highestPriceCents: number | null;
  previousLowestPriceCents: number | null;
  claimedOriginalPriceCents: number | null;
  claimedDiscountPercent: number | null;
  historicalDiscountPercent: number | null;
  differenceFromAveragePercent: number | null;
  distanceFromLowestPercent: number | null;
  confidence: "insufficient" | "medium" | "high";
  dealVerdict: DealVerdict;
  claimAssessment: ClaimAssessment;
  freshness: PriceFreshness;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
};

export type PriceHistoryResponse = {
  product: {
    productKey: string;
    site: string;
    name: string;
    category: string;
    productUrl: string;
    imageUrl: string | null;
  };
  stats: ProductPriceStats;
  history: PriceHistoryObservation[];
};

export type ProductIntelligenceDeal = {
  site: string;
  name: string;
  category: string;
  priceCents: number;
  originalPriceCents: number | null;
  discountPercent: number | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  productUrl: string;
  imageUrl: string | null;
  imageProxyUrl: string | null;
  merchantCount: number;
};

type HistoryPeriod = 30 | 90 | 180 | 365;

type ChartPoint = {
  observedDate: string;
  priceCents: number;
  timestamp: number;
  x: number;
  y: number;
};

type PriceChartModel = {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
  points: ChartPoint[];
  path: string;
  medianY: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
};

const PERIODS: Array<{ days: HistoryPeriod; label: string }> = [
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
  { days: 180, label: "180 jours" },
  { days: 365, label: "1 an" },
];

function ProductImage({ deal }: { deal: ProductIntelligenceDeal }) {
  const sources = [deal.imageProxyUrl, deal.imageUrl]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const [sourceIndex, setSourceIndex] = useState(0);
  if (!sources.length || sourceIndex >= sources.length) {
    return <span className={styles.imageFallback}><PackageSearch size={46} /><small>Image indisponible</small></span>;
  }
  return (
    // Retailer images use a proxy-first fallback chain that is not compatible with next/image loaders.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={sources[sourceIndex]}
      src={sources[sourceIndex]}
      alt={deal.name}
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}

function Availability({ value }: { value: ProductIntelligenceDeal["availability"] }) {
  const label = value === "in_stock" ? "En stock" : value === "out_of_stock" ? "En rupture" : "Disponibilité à vérifier";
  return (
    <span className={`${styles.availability} ${value === "in_stock" ? styles.inStock : value === "out_of_stock" ? styles.outOfStock : styles.unknownStock}`}>
      {value === "in_stock" && <CircleCheck size={14} />} {label}
    </span>
  );
}

function VerdictIcon({ code }: { code: DealVerdict["code"] }) {
  if (code === "exceptional") return <Flame size={24} aria-hidden="true" />;
  if (code === "good") return <BadgeCheck size={24} aria-hidden="true" />;
  if (code === "expensive") return <TrendingUp size={24} aria-hidden="true" />;
  return <Info size={24} aria-hidden="true" />;
}

function verdictClass(code: DealVerdict["code"]) {
  if (code === "exceptional") return styles.verdictExceptional;
  if (code === "good") return styles.verdictGood;
  if (code === "expensive") return styles.verdictExpensive;
  if (code === "insufficient_history") return styles.verdictCautious;
  return styles.verdictNormal;
}

function chartDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date)
    : "—";
}

export function PriceHistoryChart({
  history,
  medianPriceCents,
}: {
  history: PriceHistoryObservation[];
  medianPriceCents: number | null;
}) {
  const model = createPriceChartModel(history, medianPriceCents) as PriceChartModel;
  if (model.points.length === 0) {
    return <div className={styles.chartEmpty}><BarChart3 size={26} /><span>Aucun relevé exploitable pour ce graphique.</span></div>;
  }

  const firstPoint = model.points[0];
  const currentPoint = model.points.at(-1);
  const summary = `${model.points.length} relevé${model.points.length > 1 ? "s" : ""}. Prix compris entre ${formatMad(model.minPriceCents)} et ${formatMad(model.maxPriceCents)}.`;
  const plotBottom = model.height - model.padding.bottom;
  return (
    <figure className={styles.chartFigure}>
      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={`Évolution du prix. ${summary}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{summary}</title>
        {[model.padding.top, model.padding.top + (plotBottom - model.padding.top) / 2, plotBottom].map((y) => (
          <line key={y} x1={model.padding.left} x2={model.width - model.padding.right} y1={y} y2={y} className={styles.chartGrid} />
        ))}
        {model.medianY !== null && (
          <>
            <line x1={model.padding.left} x2={model.width - model.padding.right} y1={model.medianY} y2={model.medianY} className={styles.medianLine} />
            <text x={model.padding.left + 7} y={Math.max(14, model.medianY - 7)} className={styles.medianLabel}>Prix habituel</text>
          </>
        )}
        <path d={model.path} className={styles.pricePath} />
        {model.points.length <= 60 && model.points.map((point) => (
          <circle key={`${point.observedDate}-${point.priceCents}`} cx={point.x} cy={point.y} r="3" className={styles.pricePoint} />
        ))}
        {currentPoint && (
          <>
            <circle cx={currentPoint.x} cy={currentPoint.y} r="6" className={styles.currentPoint} />
            <text x={Math.max(model.padding.left, currentPoint.x - 50)} y={Math.max(15, currentPoint.y - 12)} className={styles.currentLabel}>Prix actuel</text>
          </>
        )}
        <text x="4" y={model.padding.top + 4} className={styles.axisLabel}>{formatMad(model.maxPriceCents)}</text>
        <text x="4" y={plotBottom + 4} className={styles.axisLabel}>{formatMad(model.minPriceCents)}</text>
        <text x={model.padding.left} y={model.height - 13} className={styles.dateLabel}>{chartDate(firstPoint.observedDate)}</text>
        {currentPoint && <text x={model.width - model.padding.right} y={model.height - 13} textAnchor="end" className={styles.dateLabel}>{chartDate(currentPoint.observedDate)}</text>}
      </svg>
      <figcaption>{summary} La ligne pointillée représente la médiane observée.</figcaption>
    </figure>
  );
}

function IntelligenceSkeleton() {
  return (
    <div className={styles.intelligenceSkeleton} role="status">
      <span>Analyse de l’historique…</span>
      <div className={styles.skeletonVerdict}></div>
      <div className={styles.skeletonCards}>{Array.from({ length: 4 }).map((_, index) => <i key={index}></i>)}</div>
      <div className={styles.skeletonChart}></div>
    </div>
  );
}

function IntelligenceContent({ data }: { data: PriceHistoryResponse }) {
  const { stats, history } = data;
  const advertisedDiscount = stats.claimedDiscountPercent;
  const lastObserved = formatFrenchDateTime(stats.freshness.lastObservedAt);
  return (
    <div className={styles.intelligenceContent}>
      <section className={`${styles.verdict} ${verdictClass(stats.dealVerdict.code)}`} aria-label={`Verdict PrixRadar : ${stats.dealVerdict.label}`}>
        <span className={styles.verdictBrand}>PrixRadar</span>
        <div><VerdictIcon code={stats.dealVerdict.code} /><h3>{stats.dealVerdict.label}</h3></div>
        <p>Verdict calculé à partir du prix habituel observé, pas du prix barré affiché par le marchand.</p>
      </section>

      {stats.freshness.status === "very_stale" && (
        <div className={styles.staleWarning} role="alert">
          <AlertTriangle size={18} />
          <span>Les données disponibles sont trop anciennes pour confirmer le niveau actuel du prix.</span>
        </div>
      )}
      {stats.observationsCount < 7 && (
        <div className={styles.historyCaution}>
          <Info size={17} />
          <span>PrixRadar collecte encore des relevés pour établir un historique fiable.</span>
        </div>
      )}

      <section className={styles.discountSection} aria-labelledby="discount-comparison-title">
        <div className={styles.sectionHeading}>
          <div><span>Comprendre la promotion</span><h3 id="discount-comparison-title">Affiché par le marchand vs observé par PrixRadar</h3></div>
        </div>
        <div className={styles.discountGrid}>
          <article>
            <span>Remise affichée</span>
            <strong>{formatAdvertisedDiscount(advertisedDiscount)}</strong>
            <small>Calculée depuis le prix barré du marchand</small>
          </article>
          <article className={styles.historicalDiscount}>
            <span>Baisse vs prix habituel</span>
            <strong>{formatHistoricalPercentage(stats.historicalDiscountPercent)}</strong>
            <small>{historicalDifferenceText(stats.historicalDiscountPercent)}</small>
          </article>
        </div>
        <div className={`${styles.claimAssessment} ${styles[`claim_${stats.claimAssessment.code}`]}`}>
          <ShieldCheck size={18} />
          <div><span>Crédibilité de la remise affichée</span><b>{stats.claimAssessment.label}</b></div>
        </div>
      </section>

      <section aria-labelledby="historical-stats-title">
        <div className={styles.sectionHeading}>
          <div><span>Les repères utiles</span><h3 id="historical-stats-title">Prix observés sur {stats.windowDays} jours</h3></div>
        </div>
        <div className={styles.statsGrid}>
          <article className={styles.currentStat}><span>Prix actuel</span><strong>{formatMad(stats.currentPriceCents)}</strong><small>Chez {data.product.site}</small></article>
          <article className={styles.usualStat}><span>Prix habituel</span><strong>{formatMad(stats.medianPriceCents)}</strong><small>Médiane observée</small></article>
          <article><span>Plus bas observé</span><strong>{formatMad(stats.lowestPriceCents)}</strong><small>Sur la période</small></article>
          <article><span>Plus haut observé</span><strong>{formatMad(stats.highestPriceCents)}</strong><small>Sur la période</small></article>
          <article className={styles.averageStat}><span>Prix moyen</span><strong>{formatMad(stats.averagePriceCents)}</strong><small>Indicateur secondaire</small></article>
        </div>
      </section>

      <section className={styles.transparencySection} aria-labelledby="transparency-title">
        <div className={styles.sectionHeading}>
          <div><span>Transparence</span><h3 id="transparency-title">Ce qui soutient cette analyse</h3></div>
        </div>
        <div className={styles.transparencyGrid}>
          <article><BarChart3 size={20} /><div><strong>{stats.observationsCount} relevé{stats.observationsCount > 1 ? "s" : ""} disponible{stats.observationsCount > 1 ? "s" : ""}</strong><span>{confidenceLabel(stats.confidence)}</span></div></article>
          <article><Clock3 size={20} /><div><strong>{freshnessLabel(stats.freshness)}</strong><span>{lastObserved ? `Dernier relevé : ${lastObserved}` : "Aucune date précise disponible"}</span></div></article>
        </div>
      </section>

      <section aria-labelledby="history-chart-title">
        <div className={styles.sectionHeading}>
          <div><span>Évolution</span><h3 id="history-chart-title">Historique du prix</h3></div>
        </div>
        <PriceHistoryChart history={history} medianPriceCents={stats.medianPriceCents} />
      </section>
    </div>
  );
}

export function ProductIntelligenceModal({
  deal,
  onClose,
  onCompare,
}: {
  deal: ProductIntelligenceDeal;
  onClose: () => void;
  onCompare?: () => void;
}) {
  const [period, setPeriod] = useState<HistoryPeriod>(90);
  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = "product-intelligence-heading";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      site: deal.site,
      productUrl: deal.productUrl,
      days: String(period),
    });
    fetch(`/api/history?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Historique indisponible (${response.status})`);
        return response.json() as Promise<PriceHistoryResponse>;
      })
      .then((payload) => setData(payload))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Historique temporairement indisponible");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [deal.productUrl, deal.site, period]);

  function changePeriod(nextPeriod: HistoryPeriod) {
    if (nextPeriod === period) return;
    setLoading(true);
    setError("");
    setData(null);
    setPeriod(nextPeriod);
  }

  const displayedOriginalPrice = data?.stats.claimedOriginalPriceCents ?? deal.originalPriceCents;
  const displayedDiscount = data?.stats.claimedDiscountPercent ?? deal.discountPercent;
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="product-intelligence-modal"
      >
        <button ref={closeButton} className={styles.closeButton} onClick={onClose} aria-label="Fermer l’analyse PrixRadar"><X size={20} /></button>
        <header className={styles.productHeader}>
          <div className={styles.productImage}><ProductImage deal={deal} /></div>
          <div className={styles.productSummary}>
            <div className={styles.productMeta}><span><Store size={14} /> {deal.site}</span><span>{deal.category || "Autres"}</span></div>
            <h2 id={headingId}>{deal.name}</h2>
            <Availability value={deal.availability} />
            <div className={styles.headerPrice}>
              <strong>{formatMad(deal.priceCents)}</strong>
              {displayedOriginalPrice !== null && displayedOriginalPrice > deal.priceCents && <del>{formatMad(displayedOriginalPrice)}</del>}
              {displayedDiscount !== null && displayedDiscount > 0 && <span>{formatAdvertisedDiscount(displayedDiscount)} affiché</span>}
            </div>
            <div className={styles.modalActions}>
              <a className={styles.primaryCta} href={deal.productUrl} target="_blank" rel="noreferrer">Voir l’offre chez {deal.site} <ExternalLink size={16} /></a>
              {deal.merchantCount > 1 && onCompare && (
                <button className={styles.compareAction} onClick={onCompare}><GitCompareArrows size={16} /> Comparer les prix de {deal.merchantCount} magasins</button>
              )}
            </div>
          </div>
        </header>

        <div className={styles.historyPanel} aria-live="polite" aria-busy={loading}>
          <div className={styles.historyToolbar}>
            <div><TrendingDown size={19} /><div><span>Historique PrixRadar</span><strong>Choisir la période analysée</strong></div></div>
            <div className={styles.periodSelector} role="group" aria-label="Période de l’historique">
              {PERIODS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className={period === option.days ? styles.activePeriod : ""}
                  aria-pressed={period === option.days}
                  onClick={() => changePeriod(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {loading && <IntelligenceSkeleton />}
          {!loading && error && (
            <div className={styles.historyError} role="status"><AlertTriangle size={20} /><div><b>{error}</b><span>Le prix et le lien marchand restent disponibles ci-dessus.</span></div></div>
          )}
          {!loading && data && <IntelligenceContent data={data} />}
        </div>
      </section>
    </div>
  );
}

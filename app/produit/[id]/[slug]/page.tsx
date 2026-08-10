import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  BarChart3,
  ChevronRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  Radar,
  ShieldCheck,
  Store,
} from "lucide-react";
import { ProductHistoryPanel } from "../../../components/ProductHistoryPanel";
import { loadProductDetail } from "../../../product-data";
import {
  buildBreadcrumbStructuredData,
  buildHistoricalExplanation,
  buildProductMetadata,
  buildProductStructuredData,
  siteOrigin,
} from "../../../../server/product-seo.mjs";
import styles from "./ProductPage.module.css";
import { ProductPageImage } from "./ProductPageImage";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string; slug: string }> };

const money = new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function formatMad(value: number | null | undefined) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? money.format(Number(value) / 100) : "—";
}

function formatPercent(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? `${percent.format(Math.abs(Number(value)))}%` : "—";
}

function formatHistoricalDifference(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "—";
  const difference = Number(value);
  if (difference > 0) return `−${percent.format(difference)}%`;
  if (difference < 0) return `+${percent.format(Math.abs(difference))}%`;
  return "0%";
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-MA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function availabilityLabel(value: string) {
  if (value === "in_stock") return "En stock";
  if (value === "out_of_stock") return "En rupture";
  return "Disponibilité à vérifier";
}

function freshnessText(status: string, checkedAt: string | null) {
  if (status === "fresh") return checkedAt ? `Prix vérifié récemment · ${checkedAt}` : "Prix vérifié récemment";
  if (status === "stale") return checkedAt ? `Dernier relevé ${checkedAt} · prix à revérifier` : "Prix à revérifier";
  if (status === "very_stale") return checkedAt ? `Données anciennes · dernier relevé ${checkedAt}` : "Données anciennes";
  return checkedAt ? `Dernier relevé ${checkedAt}` : "Date du dernier relevé indisponible";
}

function confidenceText(value: string) {
  if (value === "high") return "Historique solide";
  if (value === "medium") return "Historique intermédiaire";
  return "Historique limité";
}

function jsonLd(value: unknown) {
  return { __html: JSON.stringify(value).replace(/</g, "\\u003c") };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadProductDetail(id, 90);
  if (!detail) {
    return { title: "Produit introuvable | PrixRadar", robots: { index: false, follow: false } };
  }
  const productMetadata = buildProductMetadata(detail, siteOrigin());
  return {
    metadataBase: new URL(siteOrigin()),
    title: productMetadata.title,
    description: productMetadata.description,
    alternates: { canonical: productMetadata.canonical },
    robots: detail.seoReady ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: "website",
      locale: "fr_MA",
      siteName: "PrixRadar Maroc",
      title: productMetadata.title,
      description: productMetadata.description,
      url: productMetadata.canonical,
      images: productMetadata.image ? [{ url: productMetadata.image, alt: detail.name }] : undefined,
    },
    twitter: {
      card: productMetadata.image ? "summary_large_image" : "summary",
      title: productMetadata.title,
      description: productMetadata.description,
      images: productMetadata.image ? [productMetadata.image] : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { id, slug } = await params;
  const detail = await loadProductDetail(id, 90);
  if (!detail) notFound();
  if (id !== detail.id || slug !== detail.slug) permanentRedirect(detail.canonicalPath);

  const structuredProduct = buildProductStructuredData(detail, siteOrigin());
  const breadcrumbData = buildBreadcrumbStructuredData(detail, siteOrigin());
  const historicalExplanation = buildHistoricalExplanation(detail);
  const freshness = formatDate(detail.stats.freshness.lastObservedAt || detail.lastModified);
  const freshnessStatus = detail.stats.freshness.status;
  const advertisedDiscount = detail.stats.claimedDiscountPercent;
  const historicalDiscount = detail.stats.historicalDiscountPercent;

  return (
    <div className={styles.page}>
      {structuredProduct && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredProduct)} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbData)} />
      <nav className={styles.topbar} aria-label="Navigation principale">
        <Link className={styles.brand} href="/"><Radar size={22} /><span>PrixRadar <b>Maroc</b></span></Link>
        <Link href="/#classement">Voir le classement</Link>
      </nav>
      <main className={styles.main}>
        <nav className={styles.breadcrumbs} aria-label="Fil d’Ariane">
          <Link href="/">Accueil</Link><ChevronRight size={13} />
          <Link href={`/?universe=${detail.universe}#classement`}>{detail.universeLabel}</Link><ChevronRight size={13} />
          <span aria-current="page">{detail.name}</span>
        </nav>

        <article>
          <header className={styles.hero}>
            <div className={styles.image}>
              <ProductPageImage name={detail.name} imageUrl={detail.imageUrl} imageProxyUrl={detail.imageProxyUrl} />
            </div>
            <div className={styles.summary}>
              <p className={styles.eyebrow}>Prix, historique et comparaison au Maroc</p>
              <h1>{detail.name}</h1>
              <p className={styles.category}>{detail.category} · {detail.universeLabel}</p>
              <span className={`${styles.availability} ${detail.bestOffer.availability === "in_stock" ? "" : styles.out}`}>
                {detail.bestOffer.availability === "in_stock" && <CircleCheck size={16} />} {availabilityLabel(detail.bestOffer.availability)}
              </span>
              <div className={styles.priceBlock}>
                <strong>{formatMad(detail.bestOffer.priceCents)}</strong>
                {detail.bestOffer.originalPriceCents && detail.bestOffer.originalPriceCents > detail.bestOffer.priceCents
                  ? <del>{formatMad(detail.bestOffer.originalPriceCents)}</del> : null}
                {advertisedDiscount && advertisedDiscount > 0 ? <span>−{formatPercent(advertisedDiscount)} affiché</span> : null}
              </div>
              <p className={styles.merchant}>Meilleure offre actuelle chez <strong>{detail.bestOffer.site}</strong> · {detail.offers.length} offre{detail.offers.length > 1 ? "s" : ""} comparée{detail.offers.length > 1 ? "s" : ""}</p>
              <div className={styles.verdict}><ShieldCheck size={24} /><div><span>Verdict historique PrixRadar</span><strong>{detail.dealVerdict.label}</strong></div></div>
              <a className={styles.cta} href={detail.bestOffer.productUrl} target="_blank" rel="noreferrer sponsored">
                Voir l’offre chez {detail.bestOffer.site} <ExternalLink size={17} />
              </a>
              <p className={`${styles.freshness} ${freshnessStatus === "stale" || freshnessStatus === "very_stale" ? styles.freshnessWarning : ""}`}>{freshnessText(freshnessStatus, freshness)}</p>
            </div>
          </header>

          <section className={styles.section} aria-labelledby="historical-summary">
            <div className={styles.sectionHeading}><p>Repères historiques</p><h2 id="historical-summary">Ce prix face à son historique</h2></div>
            <div className={styles.historicalIntro}>
              <div className={styles.stat}><span>Prix actuel</span><strong>{formatMad(detail.stats.currentPriceCents)}</strong><small>Meilleure offre suivie</small></div>
              <div className={`${styles.stat} ${styles.usual}`}><span>Prix habituel</span><strong>{formatMad(detail.stats.medianPriceCents)}</strong><small>Médiane réellement observée</small></div>
              <div className={styles.stat}><span>Plus bas observé</span><strong>{formatMad(detail.stats.lowestPriceCents)}</strong><small>Sur {detail.stats.windowDays} jours</small></div>
              <div className={styles.stat}><span>Plus haut observé</span><strong>{formatMad(detail.stats.highestPriceCents)}</strong><small>Sur {detail.stats.windowDays} jours</small></div>
              <div className={styles.stat}><span>Prix moyen</span><strong>{formatMad(detail.stats.averagePriceCents)}</strong><small>Indicateur secondaire</small></div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="price-analysis">
            <div className={styles.sectionHeading}><p>Analyse transparente</p><h2 id="price-analysis">Promotion annoncée et valeur observée</h2></div>
            <div className={styles.analysisGrid}>
              <div className={styles.analysisCard}>
                <h3>La remise remise en contexte</h3>
                <div className={styles.comparison}>
                  <div><span>Remise affichée</span><strong>{formatPercent(advertisedDiscount)}</strong></div>
                  <div><span>Baisse vs prix habituel</span><strong>{formatHistoricalDifference(historicalDiscount)}</strong></div>
                </div>
                <p className={styles.assessment}><ShieldCheck size={19} /> Crédibilité de la remise : <strong>{detail.claimAssessment.label}</strong></p>
              </div>
              <div className={styles.analysisCard}>
                <h3>Qualité des données</h3>
                <div className={styles.evidence}>
                  <div><BarChart3 size={20} /><span><strong>{confidenceText(detail.stats.confidence)}</strong>{detail.stats.observationsCount} relevé{detail.stats.observationsCount > 1 ? "s" : ""}</span></div>
                  <div><Clock3 size={20} /><span><strong>{freshness || "Date inconnue"}</strong>Dernière observation disponible</span></div>
                </div>
                <p className={styles.explanation}>{historicalExplanation}</p>
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="history-chart">
            <div className={styles.sectionHeading}><p>Évolution du prix</p><h2 id="history-chart">Historique sur 30 jours à 1 an</h2></div>
            <ProductHistoryPanel product={detail} />
          </section>

          <section className={styles.section} aria-labelledby="merchant-offers">
            <div className={styles.sectionHeading}><p>Comparaison actuelle</p><h2 id="merchant-offers">Offres disponibles chez les marchands</h2></div>
            <div className={styles.offers} role="table" aria-label={`Offres pour ${detail.name}`}>
              <div className={styles.offerHeader} role="row"><span>Enseigne</span><span>Prix</span><span>Disponibilité</span><span>Dernière vérification</span><span>Accès</span></div>
              {detail.offers.map((offer) => (
                <div className={styles.offer} role="row" key={offer.productKey}>
                  <div role="cell"><strong>{offer.site}</strong><small>{offer.discountPercent && offer.discountPercent > 0 ? `−${formatPercent(offer.discountPercent)} affiché` : "Prix suivi par PrixRadar"}</small></div>
                  <div className={styles.offerPrice} role="cell"><strong>{formatMad(offer.priceCents)}</strong>{offer.originalPriceCents && offer.originalPriceCents > offer.priceCents ? <del>{formatMad(offer.originalPriceCents)}</del> : null}</div>
                  <span className={`${styles.stock} ${offer.availability === "in_stock" ? "" : styles.out}`} role="cell">{availabilityLabel(offer.availability)}</span>
                  <small role="cell">{formatDate(offer.scrapedAt || offer.updatedAt) || "Date inconnue"}</small>
                  <a href={offer.productUrl} target="_blank" rel="noreferrer sponsored" role="cell">Voir chez {offer.site} <ExternalLink size={14} /></a>
                </div>
              ))}
            </div>
            <Link className={styles.categoryLink} href={`/?universe=${detail.universe}#classement`}><Store size={16} /> Voir les autres affaires {detail.universeLabel} <ChevronRight size={15} /></Link>
          </section>
        </article>

        <aside className={styles.disclaimer}>PrixRadar compare des prix collectés auprès de marchands marocains. Les prix, stocks et frais éventuels peuvent évoluer : vérifiez toujours les conditions finales sur le site du marchand.</aside>
      </main>
    </div>
  );
}

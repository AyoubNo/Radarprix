"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  GitCompareArrows,
  Info,
  PackageSearch,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  Tags,
  Trophy,
  X,
} from "lucide-react";

type Deal = {
  key: string;
  rank: number;
  universe: "pc" | "home";
  universeLabel: string;
  site: string;
  name: string;
  category: string;
  priceCents: number;
  originalPriceCents: number;
  savingsCents: number;
  discountPercent: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
  productUrl: string;
  imageProxyUrl: string | null;
  score: number;
  quality: string;
  merchantCount: number;
  bestPriceCents: number;
  comparisons: ComparisonOffer[];
};

type ComparisonOffer = {
  key: string;
  universe: "pc" | "home";
  universeLabel: string;
  site: string;
  name: string;
  category: string;
  priceCents: number;
  originalPriceCents: number | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  productUrl: string;
  imageProxyUrl: string | null;
  confidence?: number;
};

type DealsResponse = {
  deals: Deal[];
  total: number;
  page: number;
  totalPages: number;
  options: { sites: string[]; categories: string[] };
  stats: { analyzed: number; inStock: number; stores: number; maxSavings: number; updatedAt: number };
  warnings: string[];
};

const emptyData: DealsResponse = {
  deals: [],
  total: 0,
  page: 1,
  totalPages: 1,
  options: { sites: [], categories: [] },
  stats: { analyzed: 0, inStock: 0, stores: 0, maxSavings: 0, updatedAt: 0 },
  warnings: [],
};

const money = new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("fr-MA");

function DealImage({ deal, onOpen, eager = false }: { deal: Deal; onOpen: () => void; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <button className="product-image" onClick={onOpen} aria-label={`Agrandir l’image de ${deal.name}`}>
      {deal.imageProxyUrl && !failed ? (
        <img src={deal.imageProxyUrl} alt={deal.name} loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} />
      ) : (
        <span className="image-fallback"><PackageSearch size={34} /><small>Image indisponible</small></span>
      )}
    </button>
  );
}

function DealCard({ deal, featured = false, onOpen, onCompare }: { deal: Deal; featured?: boolean; onOpen: () => void; onCompare: () => void }) {
  return (
    <article className={`deal-card ${featured ? "featured" : ""}`}>
      <div className="image-wrap">
        <DealImage deal={deal} onOpen={onOpen} eager={featured} />
        <span className="rank-badge">#{deal.rank}</span>
        <span className="discount-badge">−{Math.round(deal.discountPercent)}%</span>
      </div>
      <div className="deal-body">
        <div className="deal-meta">
          <span className={`universe-dot ${deal.universe}`}>{deal.universeLabel}</span>
          <span>{deal.site}</span>
        </div>
        <button className="deal-title" onClick={onOpen}>{deal.name}</button>
        <span className="category-label">{deal.category || "Autres"}</span>
        <div className="price-row">
          <div><strong>{money.format(deal.priceCents / 100)}</strong><del>{money.format(deal.originalPriceCents / 100)}</del></div>
          <div className="score-chip" title="Score calculé selon la remise, l’économie, le stock et la fraîcheur">
            <b>{deal.score}</b><span>/100</span>
          </div>
        </div>
        <div className="saving-row">
          <span><Sparkles size={15} /> Vous économisez <b>{money.format(deal.savingsCents / 100)}</b></span>
          <span className={`stock ${deal.availability}`}>
            {deal.availability === "in_stock" ? <><CircleCheck size={14} /> En stock</> : "Rupture"}
          </span>
        </div>
        {deal.merchantCount > 1 && (
          <button className="multi-store-button" onClick={onCompare}>
            <span><Store size={16} /> Vendu par <b>{deal.merchantCount} magasins</b></span>
            <span>Comparer <GitCompareArrows size={15} /></span>
          </button>
        )}
        <div className="card-footer">
          <span className={`quality q-${deal.quality.toLowerCase().replace(" ", "-")}`}>{deal.quality}</span>
          <a href={deal.productUrl} target="_blank" rel="noreferrer">Voir l’offre <ExternalLink size={15} /></a>
        </div>
      </div>
    </article>
  );
}

function ComparisonModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const offers: ComparisonOffer[] = [deal, ...deal.comparisons].sort((left, right) => {
    const stockDifference = (left.availability === "in_stock" ? 0 : 1) - (right.availability === "in_stock" ? 0 : 1);
    return stockDifference || left.priceCents - right.priceCents;
  });
  const availableOffers = offers.filter((offer) => offer.availability === "in_stock");
  const bestPrice = Math.min(...(availableOffers.length ? availableOffers : offers).map((offer) => offer.priceCents));
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Comparer ${deal.name}`}>
        <button className="modal-close" onClick={onClose} title="Fermer"><X size={20} /></button>
        <div className="compare-heading">
          <div className="compare-product-image">{deal.imageProxyUrl ? <img src={deal.imageProxyUrl} alt="" /> : <PackageSearch size={28} />}</div>
          <div><p><GitCompareArrows size={15} /> Comparaison multi-magasins</p><h3>{deal.name}</h3><span>{deal.merchantCount} enseignes détectées pour ce même produit</span></div>
        </div>
        <div className="compare-list">
          {offers.map((offer) => {
            const isBest = offer.priceCents === bestPrice && offer.availability === "in_stock";
            return (
              <div className={`compare-offer ${isBest ? "best" : ""}`} key={offer.key}>
                <div className="merchant-name"><Store size={17} /><div><b>{offer.site}</b><span className={`stock ${offer.availability}`}>{offer.availability === "in_stock" ? "En stock" : offer.availability === "out_of_stock" ? "Rupture" : "À vérifier"}</span></div></div>
                <div className="compare-price"><b>{money.format(offer.priceCents / 100)}</b>{isBest ? <span>Meilleur prix</span> : offer.availability === "in_stock" ? <small>+ {money.format((offer.priceCents - bestPrice) / 100)}</small> : null}</div>
                <a href={offer.productUrl} target="_blank" rel="noreferrer" title={`Voir chez ${offer.site}`}>Voir l’offre <ExternalLink size={15} /></a>
              </div>
            );
          })}
        </div>
        <p className="compare-note"><Info size={15} /> Les correspondances reposent sur le nom et la référence du modèle. Vérifiez les caractéristiques finales chez le marchand.</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DealsResponse>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [universe, setUniverse] = useState("all");
  const [site, setSite] = useState("all");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("in_stock");
  const [budget, setBudget] = useState(":");
  const [minDiscount, setMinDiscount] = useState("0");
  const [sort, setSort] = useState("score_desc");
  const [page, setPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [comparing, setComparing] = useState<Deal | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (hasLoaded.current) setPageLoading(true);
    else setLoading(true);
    setError("");
    const [minPrice, maxPrice] = budget.split(":");
    const params = new URLSearchParams({ q: query, universe, site, category, availability, minPrice, maxPrice, minDiscount, sort, page: String(page), limit: "24" });
    fetch(`/api/deals?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Erreur ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        hasLoaded.current = true;
      })
      .catch((reason) => {
        if (active && reason?.name !== "AbortError") setError(reason?.message || "Impossible de charger les affaires.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setPageLoading(false);
        }
      });
    return () => { active = false; controller.abort(); };
  }, [query, universe, site, category, availability, budget, minDiscount, sort, page, reloadKey]);

  const topDeals = useMemo(() => data.page === 1 && sort === "score_desc" ? data.deals.slice(0, 3) : [], [data.deals, data.page, sort]);
  const resultDeals = topDeals.length ? data.deals.slice(3) : data.deals;

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function changeUniverse(value: string) {
    setUniverse(value);
    setSite("all");
    setCategory("all");
    setPage(1);
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La mise à jour a échoué.");
    } finally {
      setRefreshing(false);
    }
  }

  function resetFilters() {
    setDraft(""); setQuery(""); setUniverse("all"); setSite("all"); setCategory("all");
    setAvailability("in_stock"); setBudget(":"); setMinDiscount("0"); setSort("score_desc"); setPage(1);
  }

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top"><span className="brand-mark"><Radar size={22} /></span><span>PrixRadar <b>Maroc</b></span></a>
        <div className="nav-status"><span></span>Données locales actualisées</div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-glow one"></div><div className="hero-glow two"></div>
        <div className="hero-copy">
          <p className="eyebrow"><Trophy size={16} /> Palmarès automatique multi-marchés</p>
          <h1>Les vraies bonnes affaires,<br /><em>classées pour vous.</em></h1>
          <p>PrixRadar analyse les promotions de 7 enseignes marocaines et fait remonter les offres qui combinent vraie remise, économie importante et disponibilité.</p>
          <div className="hero-actions">
            <a href="#classement" className="primary-action">Explorer le classement <ChevronRight size={18} /></a>
            <button className="refresh-button" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={17} className={refreshing ? "spin" : ""} /> {refreshing ? "Analyse en cours…" : "Actualiser les données"}
            </button>
          </div>
        </div>
        <aside className="score-explainer">
          <div className="score-orbit"><span>94</span><small>Score deal</small></div>
          <div><p>Notre score transparent</p><h2>4 signaux, un classement</h2></div>
          <ul>
            <li><span>50%</span> Remise réelle</li>
            <li><span>24%</span> Économie en MAD</li>
            <li><span>18%</span> Produit en stock</li>
            <li><span>8%</span> Fraîcheur du relevé</li>
          </ul>
        </aside>
      </header>

      <section className="stats-strip">
        <div><Tags size={19} /><span><b>{number.format(data.stats.analyzed)}</b> promotions analysées</span></div>
        <div><CircleCheck size={19} /><span><b>{number.format(data.stats.inStock)}</b> offres en stock</span></div>
        <div><Store size={19} /><span><b>{data.stats.stores}</b> enseignes comparées</span></div>
        <div><Sparkles size={19} /><span>Jusqu’à <b>{money.format(data.stats.maxSavings / 100)}</b> d’économie</span></div>
      </section>

      <section className="workspace" id="classement">
        <div className="section-heading">
          <div><p className="section-kicker">Classement en direct</p><h2>{universe === "pc" ? "Bonnes affaires PC & Gaming" : universe === "home" ? "Bonnes affaires Maison & Électroménager" : "Les meilleures affaires du moment"}</h2></div>
          <p className="last-update">Mise à jour {data.stats.updatedAt ? new Date(data.stats.updatedAt).toLocaleString("fr-MA", { dateStyle: "medium", timeStyle: "short" }) : "en cours…"}</p>
        </div>

        <div className="universe-tabs" role="group" aria-label="Univers">
          {[{ value: "all", label: "Toutes les affaires" }, { value: "pc", label: "PC & Gaming" }, { value: "home", label: "Maison & Électroménager" }].map((item) => (
            <button key={item.value} className={universe === item.value ? "active" : ""} onClick={() => changeUniverse(item.value)}>{item.label}</button>
          ))}
        </div>

        <div className="filter-panel">
          <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setPage(1); }}>
            <Search size={19} />
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Rechercher un produit, une marque…" />
            {draft && <button type="button" className="clear-search" onClick={() => { setDraft(""); setQuery(""); }} title="Effacer"><X size={16} /></button>}
            <button type="submit" className="search-submit">Rechercher</button>
          </form>
          <div className="filter-grid">
            <label><span>Budget</span><select value={budget} onChange={(event) => changeFilter(setBudget, event.target.value)}><option value=":">Tous les budgets</option><option value=":500">Moins de 500 MAD</option><option value="500:1000">500 à 1 000 MAD</option><option value="1000:3000">1 000 à 3 000 MAD</option><option value="3000:10000">3 000 à 10 000 MAD</option><option value="10000:">Plus de 10 000 MAD</option></select></label>
            <label><span>Enseigne</span><select value={site} onChange={(event) => changeFilter(setSite, event.target.value)}><option value="all">Toutes les enseignes</option>{data.options.sites.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Catégorie</span><select value={category} onChange={(event) => changeFilter(setCategory, event.target.value)}><option value="all">Toutes les catégories</option>{data.options.categories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Disponibilité</span><select value={availability} onChange={(event) => changeFilter(setAvailability, event.target.value)}><option value="in_stock">En stock seulement</option><option value="all">Tous les produits</option><option value="out_of_stock">En rupture</option></select></label>
            <label><span>Remise minimum</span><select value={minDiscount} onChange={(event) => changeFilter(setMinDiscount, event.target.value)}><option value="0">Toutes les remises</option><option value="10">10% et plus</option><option value="20">20% et plus</option><option value="30">30% et plus</option><option value="40">40% et plus</option></select></label>
            <label><span>Trier par</span><select value={sort} onChange={(event) => changeFilter(setSort, event.target.value)}><option value="score_desc">Meilleur score</option><option value="discount_desc">Plus forte remise</option><option value="savings_desc">Plus grande économie</option><option value="price_asc">Prix le plus bas</option></select></label>
          </div>
        </div>

        {data.warnings.length > 0 && <div className="notice warning"><AlertTriangle size={18} /><span>{data.warnings.join(" · ")}</span></div>}
        {error && <div className="notice error"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => setReloadKey((value) => value + 1)}>Réessayer</button></div>}

        {topDeals.length > 0 && !loading && (
          <div className={`podium ${pageLoading ? "is-updating" : ""}`} aria-busy={pageLoading}>
            {topDeals.map((deal) => <DealCard key={deal.key} deal={deal} featured onOpen={() => setSelected(deal)} onCompare={() => setComparing(deal)} />)}
          </div>
        )}

        <div className="results-head">
          <p><b>{number.format(data.total)}</b> affaire{data.total > 1 ? "s" : ""} trouvée{data.total > 1 ? "s" : ""}</p>
          <span><ArrowDownWideNarrow size={16} /> Classement recalculé selon vos filtres</span>
        </div>

        {loading ? (
          <div className="loading-grid">{Array.from({ length: 6 }).map((_, index) => <div className="skeleton-card" key={index}><span></span><i></i><i></i><i></i></div>)}</div>
        ) : data.deals.length ? (
          <div className={`deal-grid ${pageLoading ? "is-updating" : ""}`} aria-busy={pageLoading}>{resultDeals.map((deal) => <DealCard key={deal.key} deal={deal} onOpen={() => setSelected(deal)} onCompare={() => setComparing(deal)} />)}</div>
        ) : !error && (
          <div className="empty-state"><PackageSearch size={44} /><h3>Aucune affaire ne correspond</h3><p>Essayez d’élargir les filtres ou de rechercher un autre produit.</p><button onClick={resetFilters}>Réinitialiser les filtres</button></div>
        )}

        {data.totalPages > 1 && !loading && (
          <div className="pagination">
            <button title="Page précédente" disabled={page <= 1 || pageLoading} onClick={() => { setPage((value) => Math.max(1, value - 1)); scrollTo({ top: 560, behavior: "smooth" }); }}><ChevronLeft size={18} /></button>
            <span>{pageLoading ? <><RefreshCw size={14} className="spin" /> Chargement rapide…</> : <>Page <b>{data.page}</b> sur {data.totalPages}</>}</span>
            <button title="Page suivante" disabled={page >= data.totalPages || pageLoading} onClick={() => { setPage((value) => Math.min(data.totalPages, value + 1)); scrollTo({ top: 560, behavior: "smooth" }); }}><ChevronRight size={18} /></button>
          </div>
        )}

        <div className="method-note"><Info size={18} /><p><b>Comment lire le score ?</b> Une forte remise ne suffit pas. PrixRadar valorise aussi l’économie réelle, la disponibilité et la fraîcheur du relevé. Les remises supérieures à 90%, les prix nuls et les incohérences sont automatiquement écartés.</p></div>
      </section>

      <footer><div className="brand"><span className="brand-mark"><Radar size={20} /></span><span>PrixRadar <b>Maroc</b></span></div><p>Comparateur local indépendant · Les prix peuvent évoluer sur le site marchand.</p></footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="image-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={selected.name}>
            <button className="modal-close" onClick={() => setSelected(null)} title="Fermer"><X size={20} /></button>
            <div className="modal-image">{selected.imageProxyUrl ? <img src={selected.imageProxyUrl} alt={selected.name} /> : <PackageSearch size={50} />}</div>
            <div className="modal-copy"><span>{selected.site} · {selected.category}</span><h3>{selected.name}</h3><div><b>{money.format(selected.priceCents / 100)}</b><del>{money.format(selected.originalPriceCents / 100)}</del><em>−{Math.round(selected.discountPercent)}%</em></div><a href={selected.productUrl} target="_blank" rel="noreferrer">Voir l’offre chez {selected.site} <ExternalLink size={16} /></a></div>
          </div>
        </div>
      )}
      {comparing && <ComparisonModal deal={comparing} onClose={() => setComparing(null)} />}
    </main>
  );
}

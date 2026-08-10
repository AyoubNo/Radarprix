"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, TrendingDown } from "lucide-react";
import { PriceHistoryChart } from "./ProductIntelligenceModal";
import type { ProductDetail } from "./product-detail-types";
import styles from "./ProductHistoryPanel.module.css";
import { publicApiUrl } from "../api-client";

type HistoryPeriod = 30 | 90 | 180 | 365;

const periods: Array<{ days: HistoryPeriod; label: string }> = [
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
  { days: 180, label: "180 jours" },
  { days: 365, label: "1 an" },
];

export function ProductHistoryPanel({ product }: { product: ProductDetail }) {
  const [period, setPeriod] = useState<HistoryPeriod>(90);
  const [detail, setDetail] = useState(product);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function changePeriod(days: HistoryPeriod) {
    if (days === period) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPeriod(days);
    setLoading(true);
    setError("");
    fetch(publicApiUrl(`/api/product/${encodeURIComponent(product.id)}?days=${days}`), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Historique indisponible (${response.status})`);
        return response.json() as Promise<ProductDetail>;
      })
      .then(setDetail)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("L’historique est temporairement indisponible.");
      })
      .finally(() => {
        if (activeRequest.current === controller) setLoading(false);
      });
  }

  return (
    <div className={styles.panel} aria-live="polite" aria-busy={loading}>
      <div className={styles.toolbar}>
        <div className={styles.heading}>
          <TrendingDown size={21} aria-hidden="true" />
          <div><span>Historique PrixRadar</span><strong>Choisir la période analysée</strong></div>
        </div>
        <div className={styles.periods} role="group" aria-label="Période de l’historique">
          {periods.map((option) => (
            <button
              key={option.days}
              type="button"
              className={period === option.days ? styles.active : ""}
              aria-pressed={period === option.days}
              onClick={() => changePeriod(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.body}>
        {loading ? (
          <div className={styles.loading} role="status"><LoaderCircle size={28} /><span>Recalcul de l’historique…</span></div>
        ) : error ? (
          <div className={styles.error} role="status"><AlertTriangle size={26} /><span>{error}</span></div>
        ) : (
          <>
            <PriceHistoryChart history={detail.history} medianPriceCents={detail.stats.medianPriceCents} />
            <p className={styles.summary}>
              {detail.stats.observationsCount} relevé{detail.stats.observationsCount > 1 ? "s" : ""} sur {detail.stats.windowDays} jours.
              Le prix habituel correspond à la médiane des prix réellement observés.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

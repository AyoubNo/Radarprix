"use client";

import { useState } from "react";
import { PackageSearch } from "lucide-react";

export function ProductPageImage({
  name,
  imageUrl,
  imageProxyUrl,
}: {
  name: string;
  imageUrl: string | null;
  imageProxyUrl: string | null;
}) {
  const sources = [imageUrl, imageProxyUrl]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  if (!sources.length || sourceIndex >= sources.length) {
    return <span><PackageSearch size={48} />Image indisponible</span>;
  }

  return (
    <>
      <span aria-hidden={loaded} style={{ gridArea: "1 / 1", visibility: loaded ? "hidden" : "visible" }}>
        <PackageSearch size={42} />Image en cours de chargement
      </span>
      {/* Merchant images need a runtime fallback chain and cannot use a fixed Next image loader. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={sources[sourceIndex]}
        src={sources[sourceIndex]}
        alt={name}
        width="560"
        height="420"
        fetchPriority="high"
        referrerPolicy="no-referrer"
        style={{ gridArea: "1 / 1", opacity: loaded ? 1 : 0 }}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setSourceIndex((current) => current + 1);
        }}
      />
    </>
  );
}

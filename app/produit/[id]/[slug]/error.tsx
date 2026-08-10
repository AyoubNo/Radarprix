"use client";

import Link from "next/link";

export default function ProductPageError({ reset }: { reset: () => void }) {
  return (
    <main style={{ maxWidth: 760, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>Données temporairement indisponibles</h1>
      <p>PrixRadar ne peut pas vérifier ce produit pour le moment. Aucun prix de remplacement n’a été inventé.</p>
      <button type="button" onClick={reset}>Réessayer</button>{" "}
      <Link href="/">Revenir au classement</Link>
    </main>
  );
}

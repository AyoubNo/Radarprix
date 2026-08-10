import { PackageSearch, Radar } from "lucide-react";
import Link from "next/link";

export default function ProductNotFound() {
  return (
    <main style={{ minHeight: "100vh", padding: "40px 20px", display: "grid", placeContent: "center", justifyItems: "center", gap: 14, color: "#263248", background: "#f5f6f8", textAlign: "center" }}>
      <Radar size={28} color="#2449b5" />
      <PackageSearch size={54} color="#8d97a7" />
      <h1 style={{ margin: 0 }}>Produit introuvable</h1>
      <p style={{ maxWidth: 480, margin: 0, color: "#6b7689", lineHeight: 1.6 }}>Cette référence n’est plus disponible ou son adresse est incorrecte.</p>
      <Link href="/#classement" style={{ marginTop: 8, padding: "12px 17px", borderRadius: 9, color: "#fff", background: "#2449b5", fontWeight: 800, textDecoration: "none" }}>Retour au classement PrixRadar</Link>
    </main>
  );
}

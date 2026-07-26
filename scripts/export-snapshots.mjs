import { refreshIntegratedCatalog } from "../server/catalog-store.mjs";

console.log("Actualisation autonome des sept enseignes...");
const result = await refreshIntegratedCatalog();

for (const snapshot of Object.values(result.snapshots)) {
  const successful = snapshot.results.filter((item) => item.ok);
  const failed = snapshot.results.filter((item) => !item.ok);
  console.log(`${snapshot.universe}: ${snapshot.products.length} produits sauvegardés`);
  for (const item of successful) {
    console.log(`  ✓ ${item.source.site}: ${item.products.length} produits`);
  }
  for (const item of failed) {
    console.warn(`  ! ${item.source.site}: ${item.error}`);
  }
}

if (result.warnings.length) {
  console.warn("Certaines enseignes ont conservé leurs données précédentes :");
  for (const warning of result.warnings) console.warn(`  - ${warning}`);
}

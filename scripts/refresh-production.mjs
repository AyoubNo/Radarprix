import { beginIntegratedCatalogRefresh, getPublicCollectionState } from "../server/catalog-store.mjs";

if (process.env.NODE_ENV === "production" && !process.env.PRIXRADAR_DATA_DIR && !process.env.PRIXRADAR_DB_PATH) {
  console.error("Production refresh failed: missing PRIXRADAR_DATA_DIR or PRIXRADAR_DB_PATH");
  process.exitCode = 1;
} else {
  const started = beginIntegratedCatalogRefresh();
  if (started.status === "already_running") {
    console.error("Collection skipped: another collection is already running.");
    process.exitCode = 2;
  } else {
    try {
      await started.completion;
      const state = getPublicCollectionState();
      console.log(JSON.stringify({ event: "scheduled_collection_completed", ...state }));
      process.exitCode = state.storesSucceeded > 0 ? 0 : 1;
    } catch (error) {
      console.error(`Scheduled collection failed: ${error?.message || String(error)}`);
      process.exitCode = 1;
    }
  }
}

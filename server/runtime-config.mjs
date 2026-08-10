import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_SITE_ORIGIN = "http://localhost:3220";
const LOCAL_API_ORIGIN = "http://127.0.0.1:3500";

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function parseOrigin(name, value, { production = false } = {}) {
  if (!value) throw new Error(`Missing ${name}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: expected an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Invalid ${name}: expected an HTTP(S) URL`);
  }
  if (production && isLoopbackHostname(url.hostname)) {
    throw new Error(`Invalid ${name}: localhost is not allowed in production`);
  }
  return url.origin;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid ${name}: expected an integer between 1 and 65535`);
  }
  return parsed;
}

export function isProduction(environment = process.env) {
  return environment.NODE_ENV === "production";
}

export function resolveSiteOrigin(environment = process.env) {
  const production = isProduction(environment);
  const candidate = environment.PRIXRADAR_SITE_URL || environment.NEXT_PUBLIC_SITE_URL;
  return parseOrigin("PRIXRADAR_SITE_URL", candidate || (production ? null : LOCAL_SITE_ORIGIN), { production });
}

export function resolveInternalApiOrigin(environment = process.env) {
  const production = isProduction(environment);
  const candidate = environment.PRIXRADAR_API_INTERNAL_URL;
  return parseOrigin(
    "PRIXRADAR_API_INTERNAL_URL",
    candidate || (production ? null : LOCAL_API_ORIGIN),
    { production },
  );
}

export function resolvePublicApiOrigin(environment = process.env) {
  const production = isProduction(environment);
  const candidate = environment.NEXT_PUBLIC_PRIXRADAR_API_URL;
  if (!candidate && !production) return "";
  return parseOrigin("NEXT_PUBLIC_PRIXRADAR_API_URL", candidate, { production });
}

export function resolveDataPaths(environment = process.env) {
  const configuredDatabasePath = String(environment.PRIXRADAR_DB_PATH || "").trim();
  const configuredDataDirectory = String(environment.PRIXRADAR_DATA_DIR || "").trim();
  const databasePath = configuredDatabasePath
    ? path.resolve(configuredDatabasePath)
    : path.join(configuredDataDirectory ? path.resolve(configuredDataDirectory) : path.join(projectRoot, "data"), "radarprix.sqlite.db");
  return {
    projectRoot,
    bundledSnapshotDirectory: path.join(projectRoot, "data"),
    dataDirectory: path.dirname(databasePath),
    databasePath,
  };
}

export function getApiRuntimeConfig(environment = process.env) {
  const production = isProduction(environment);
  const refreshSecret = String(environment.PRIXRADAR_REFRESH_SECRET || "");
  if (production && !refreshSecret) throw new Error("Missing PRIXRADAR_REFRESH_SECRET");
  if (production && !environment.PRIXRADAR_DATA_DIR && !environment.PRIXRADAR_DB_PATH) {
    throw new Error("Missing PRIXRADAR_DATA_DIR or PRIXRADAR_DB_PATH");
  }
  const siteOrigin = resolveSiteOrigin(environment);
  return {
    production,
    host: String(environment.PRIXRADAR_API_HOST || (production ? "0.0.0.0" : "127.0.0.1")),
    port: positiveInteger(environment.PRIXRADAR_API_PORT || environment.PORT, 3500, "API port"),
    refreshSecret,
    siteOrigin,
    startupCollection: environment.PRIXRADAR_STARTUP_COLLECTION !== "false",
    shutdownGraceMs: Math.max(1_000, Number(environment.PRIXRADAR_SHUTDOWN_GRACE_MS) || 25_000),
  };
}

export function validateWebRuntimeConfig(environment = process.env) {
  return {
    production: isProduction(environment),
    siteOrigin: resolveSiteOrigin(environment),
    internalApiOrigin: resolveInternalApiOrigin(environment),
    publicApiOrigin: resolvePublicApiOrigin(environment),
  };
}

export function publicRuntimeConfig(environment = process.env) {
  return {
    siteOrigin: resolveSiteOrigin(environment),
    publicApiOrigin: resolvePublicApiOrigin(environment),
    manualRefreshEnabled: !isProduction(environment)
      && environment.NEXT_PUBLIC_PRIXRADAR_ENABLE_MANUAL_REFRESH !== "false",
  };
}

export const LOCAL_DEFAULTS = Object.freeze({
  siteOrigin: LOCAL_SITE_ORIGIN,
  internalApiOrigin: LOCAL_API_ORIGIN,
});

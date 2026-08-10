import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { authorizeRefresh } from "../server/refresh-auth.mjs";
import { tryAcquireCollectionLock } from "../server/collection-lock.mjs";
import {
  getApiRuntimeConfig,
  publicRuntimeConfig,
  resolveDataPaths,
  resolveInternalApiOrigin,
  resolveSiteOrigin,
  validateWebRuntimeConfig,
} from "../server/runtime-config.mjs";
import { isDailyCollectionDueAt } from "../server/database.mjs";
import { createPrixRadarServer } from "../server/api-server.mjs";

function productionEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    PRIXRADAR_SITE_URL: "https://prixradar.example",
    PRIXRADAR_API_INTERNAL_URL: "https://api.internal.example",
    NEXT_PUBLIC_PRIXRADAR_API_URL: "https://api.example",
    PRIXRADAR_DATA_DIR: path.join(os.tmpdir(), "prixradar-production-test"),
    PRIXRADAR_REFRESH_SECRET: "test-secret-that-is-not-real",
    ...overrides,
  };
}

test("refresh authentication rejects missing, malformed, and incorrect credentials", () => {
  assert.equal(authorizeRefresh(undefined, "expected-secret").status, 401);
  assert.equal(authorizeRefresh("Basic abc", "expected-secret").status, 401);
  assert.equal(authorizeRefresh("Bearer wrong", "expected-secret").status, 403);
  assert.equal(authorizeRefresh("Bearer expected-secret", "expected-secret").ok, true);
  assert.equal(authorizeRefresh("Bearer anything", "").status, 503);
});

test("production configuration fails clearly instead of falling back to localhost", () => {
  assert.throws(() => getApiRuntimeConfig({ NODE_ENV: "production" }), /PRIXRADAR_REFRESH_SECRET/);
  assert.throws(
    () => getApiRuntimeConfig({ NODE_ENV: "production", PRIXRADAR_REFRESH_SECRET: "secret" }),
    /PRIXRADAR_DATA_DIR|PRIXRADAR_DB_PATH/,
  );
  assert.throws(() => resolveSiteOrigin({ NODE_ENV: "production" }), /PRIXRADAR_SITE_URL/);
  assert.throws(
    () => resolveSiteOrigin({ NODE_ENV: "production", PRIXRADAR_SITE_URL: "http://localhost:3220" }),
    /localhost is not allowed/,
  );
  assert.throws(
    () => resolveInternalApiOrigin({ NODE_ENV: "production", PRIXRADAR_API_INTERNAL_URL: "http://127.0.0.1:3500" }),
    /localhost is not allowed/,
  );
  assert.deepEqual(validateWebRuntimeConfig(productionEnvironment()), {
    production: true,
    siteOrigin: "https://prixradar.example",
    internalApiOrigin: "https://api.internal.example",
    publicApiOrigin: "https://api.example",
  });
});

test("configured SQLite directory is resolved independently from application snapshots", () => {
  const configured = path.join(os.tmpdir(), "prixradar-mounted-data");
  const paths = resolveDataPaths({ PRIXRADAR_DATA_DIR: configured });
  assert.equal(paths.databasePath, path.join(configured, "radarprix.sqlite.db"));
  assert.equal(paths.dataDirectory, configured);
  assert.notEqual(paths.bundledSnapshotDirectory, configured);
});

test("public runtime configuration never exposes the refresh secret", () => {
  const serialized = JSON.stringify(publicRuntimeConfig({
    PRIXRADAR_REFRESH_SECRET: "never-public",
    PRIXRADAR_SITE_URL: "https://prixradar.example",
    NEXT_PUBLIC_PRIXRADAR_API_URL: "https://api.example",
  }));
  assert.doesNotMatch(serialized, /never-public|REFRESH_SECRET/);
});

test("collection lock rejects concurrent work and can be reacquired after release", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prixradar-lock-"));
  const lockPath = path.join(directory, "collector.lock");
  try {
    const first = tryAcquireCollectionLock({ lockPath });
    const second = tryAcquireCollectionLock({ lockPath });
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    first.release();
    const third = tryAcquireCollectionLock({ lockPath });
    assert.equal(third.acquired, true);
    third.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Morocco calendar dates drive daily collection boundaries", () => {
  const afterMidnightInMorocco = new Date("2026-08-10T23:30:00.000Z");
  assert.equal(isDailyCollectionDueAt("2026-08-10T23:05:00.000Z", afterMidnightInMorocco), false);
  assert.equal(isDailyCollectionDueAt("2026-08-10T22:30:00.000Z", afterMidnightInMorocco), true);
});

async function withApi(overrides, callback) {
  const config = getApiRuntimeConfig(productionEnvironment({
    PRIXRADAR_API_PORT: "3500",
    PRIXRADAR_STARTUP_COLLECTION: "false",
  }));
  const server = createPrixRadarServer({ config, ...overrides });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint is lightweight, sanitized, and reports database failure", async () => {
  await withApi({
    checkDatabase: () => true,
    getCollectionState: () => ({ status: "idle", lastSuccessfulAt: "2026-08-10T08:14:00.000Z" }),
  }, async (origin) => {
    const response = await fetch(`${origin}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.database, "ok");
    assert.equal("databasePath" in payload, false);
  });

  await withApi({
    checkDatabase: () => { throw new Error("C:\\private\\radarprix.sqlite.db"); },
    getCollectionState: () => ({ status: "idle", lastSuccessfulAt: null }),
  }, async (origin) => {
    const response = await fetch(`${origin}/api/health`);
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.doesNotMatch(body, /private|sqlite\.db/);
  });
});

test("admin refresh requires a valid bearer secret and rejects concurrent refreshes", async () => {
  let active = false;
  let calls = 0;
  let finish;
  const completion = new Promise((resolve) => { finish = resolve; });
  const beginCollection = () => {
    if (active) return { status: "already_running", completion };
    active = true;
    calls += 1;
    return { status: "started", completion };
  };
  await withApi({
    beginCollection,
    getCollectionState: () => ({ status: active ? "running" : "idle", lastSuccessfulAt: null }),
  }, async (origin) => {
    const missing = await fetch(`${origin}/api/admin/refresh`, { method: "POST" });
    const invalid = await fetch(`${origin}/api/admin/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer incorrect" },
    });
    const valid = await fetch(`${origin}/api/admin/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret-that-is-not-real" },
    });
    const concurrent = await fetch(`${origin}/api/admin/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret-that-is-not-real" },
    });
    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 403);
    assert.equal(valid.status, 202);
    assert.equal((await valid.json()).status, "started");
    assert.equal(concurrent.status, 409);
    assert.equal((await concurrent.json()).status, "already_running");
    assert.equal(calls, 1);
    finish({ warnings: [] });
  });
});

test("production removes the legacy public refresh route and uses explicit CORS", async () => {
  await withApi({}, async (origin) => {
    const legacy = await fetch(`${origin}/api/refresh`, { method: "POST" });
    assert.equal(legacy.status, 404);
    const allowed = await fetch(`${origin}/api/health`, { headers: { origin: "https://prixradar.example" } });
    const denied = await fetch(`${origin}/api/health`, { headers: { origin: "https://attacker.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://prixradar.example");
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

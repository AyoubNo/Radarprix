import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "prixradar-production-runtime-"));
const baseEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  PRIXRADAR_SITE_URL: "https://example.test",
  PRIXRADAR_DATA_DIR: dataDirectory,
  PRIXRADAR_REFRESH_SECRET: "runtime-validation-secret-only",
  PRIXRADAR_API_HOST: "127.0.0.1",
  PRIXRADAR_STARTUP_COLLECTION: "false",
  PRIXRADAR_SHUTDOWN_GRACE_MS: "5000",
};

async function waitForDeals(origin) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/deals?limit=12`);
      if (response.ok) {
        const payload = await response.json();
        if (payload.total > 0) return payload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error("API did not expose product data in time");
}

async function runApi(port) {
  const child = spawn(process.execPath, ["--no-warnings", path.join(root, "server", "api-server.mjs")], {
    cwd: root,
    env: { ...baseEnvironment, PRIXRADAR_API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deals = await waitForDeals(origin);
    const health = await fetch(`${origin}/api/health`);
    const anonymousRefresh = await fetch(`${origin}/api/admin/refresh`, { method: "POST" });
    if (!health.ok) throw new Error(`Health returned ${health.status}`);
    if (anonymousRefresh.status !== 401) throw new Error(`Anonymous refresh returned ${anonymousRefresh.status}`);
    return { child, origin, total: deals.total, logs: () => logs };
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n${logs}`);
  }
}

async function stopApi(child) {
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill(), 10_000);
  await once(child, "exit");
  clearTimeout(timeout);
}

try {
  const first = await runApi(35_51);
  await stopApi(first.child);
  const databasePath = path.join(dataDirectory, "radarprix.sqlite.db");
  if (!existsSync(databasePath)) throw new Error("Configured SQLite database was not created");

  const second = await runApi(35_52);
  await stopApi(second.child);
  if (second.total !== first.total) {
    throw new Error(`Product count changed after restart (${first.total} -> ${second.total})`);
  }
  console.log(JSON.stringify({
    status: "ok",
    firstProductCount: first.total,
    secondProductCount: second.total,
    databasePreserved: true,
    anonymousRefreshRejected: true,
  }));
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}

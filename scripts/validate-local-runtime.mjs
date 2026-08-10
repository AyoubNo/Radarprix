import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "prixradar-local-runtime-"));
const webOrigin = "http://127.0.0.1:3620";
const apiOrigin = "http://127.0.0.1:3621";
const browserCandidates = [
  process.env.CHROMIUM_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = browserCandidates.find(existsSync);
if (!executablePath) throw new Error("No Chromium-compatible browser was found for local validation");

const child = spawn(process.execPath, [path.join(root, "scripts", "dev.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PRIXRADAR_HOST: "127.0.0.1",
    PRIXRADAR_WEB_PORT: "3620",
    PRIXRADAR_API_PORT: "3621",
    PRIXRADAR_API_INTERNAL_URL: apiOrigin,
    PRIXRADAR_SITE_URL: webOrigin,
    PRIXRADAR_DATA_DIR: dataDirectory,
    PRIXRADAR_STARTUP_COLLECTION: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function waitForUrl(url) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

let browser;
try {
  await Promise.all([waitForUrl(`${apiOrigin}/api/health`), waitForUrl(webOrigin)]);
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(webOrigin, { waitUntil: "networkidle0", timeout: 90_000 });
  await page.waitForSelector(".deal-card", { timeout: 60_000 });

  const refreshButtonVisible = await page.$eval(".refresh-button", (element) => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const firstProduct = await page.$eval("a.deal-title", (element) => ({
    name: element.textContent?.trim() || "",
    path: element.getAttribute("href") || "",
  }));
  if (!refreshButtonVisible || !firstProduct.path.startsWith("/produit/")) {
    throw new Error("Homepage controls or product links are missing");
  }

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("maxPrice=500") && response.status() === 200),
    page.select(".filter-grid select", ":500"),
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("maxPrice=") && !response.url().includes("maxPrice=500") && response.status() === 200),
    page.select(".filter-grid select", ":"),
  ]);
  await page.waitForSelector(".deal-card", { timeout: 30_000 });

  await page.click(".card-actions button");
  await page.waitForSelector('[aria-label="Fermer l’analyse PrixRadar"]', { timeout: 15_000 });
  await page.click('[aria-label="Fermer l’analyse PrixRadar"]');

  const searchTerm = firstProduct.name.split(/\s+/).find((token) => token.length >= 4) || firstProduct.name;
  await page.type('input[placeholder="Rechercher un produit, une marque…"]', searchTerm);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/deals?") && response.status() === 200),
    page.click(".search-submit"),
  ]);
  await page.waitForSelector(".deal-card", { timeout: 30_000 });

  await page.goto(new URL(firstProduct.path, webOrigin).href, { waitUntil: "networkidle0", timeout: 60_000 });
  const productHeading = await page.$eval("h1", (element) => element.textContent?.trim() || "");
  const structuredDataCount = await page.$$eval('script[type="application/ld+json"]', (elements) => elements.length);
  if (!productHeading || structuredDataCount < 2) throw new Error("Product page SSR content is incomplete");

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (horizontalOverflow > 1) throw new Error(`Mobile page overflows horizontally by ${horizontalOverflow}px`);

  const id = firstProduct.path.split("/")[2];
  const productResponse = await fetch(`${apiOrigin}/api/product/${id}`);
  if (!productResponse.ok) throw new Error(`/api/product returned ${productResponse.status}`);
  const product = await productResponse.json();
  const historyUrl = new URL("/api/history", apiOrigin);
  historyUrl.searchParams.set("productKey", product.bestOffer.productKey);
  const [historyResponse, sitemapResponse] = await Promise.all([
    fetch(historyUrl),
    fetch(`${webOrigin}/sitemap.xml`),
  ]);
  if (!historyResponse.ok || !sitemapResponse.ok) {
    throw new Error(`History/sitemap validation failed (${historyResponse.status}/${sitemapResponse.status})`);
  }
  const sitemap = await sitemapResponse.text();
  if (!sitemap.includes("/produit/")) throw new Error("Sitemap contains no product URLs");

  console.log(JSON.stringify({
    status: "ok",
    homepage: true,
    search: true,
    filters: true,
    ranking: true,
    productModal: true,
    productPage: true,
    historyApi: true,
    productApi: true,
    sitemap: true,
    developmentRefreshVisible: refreshButtonVisible,
    mobileOverflowPx: horizontalOverflow,
    browserConsoleErrors: browserErrors.length,
  }));
} catch (error) {
  throw new Error(`${error.message}\n${logs}`);
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) {
    const timeout = setTimeout(() => child.kill(), 10_000);
    await once(child, "exit");
    clearTimeout(timeout);
  }
  rmSync(dataDirectory, { recursive: true, force: true });
}

import { mkdir, writeFile } from "node:fs/promises";

const sources = [
  { key: "pc", api: "http://127.0.0.1:3300" },
  { key: "home", api: "http://127.0.0.1:3400" },
];
const outputDirectory = new URL("../data/", import.meta.url);

function compact(product) {
  return {
    id: product.id,
    site: product.site,
    name: product.name,
    category: product.category,
    priceCents: product.priceCents,
    originalPriceCents: product.originalPriceCents,
    onSale: product.onSale,
    discountPercent: product.discountPercent,
    availability: product.availability,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    scrapedAt: product.scrapedAt,
  };
}

async function fetchPage(source, page) {
  const response = await fetch(`${source.api}/api/products?sort=name_asc&limit=200&page=${page}`);
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status}`);
  return response.json();
}

await mkdir(outputDirectory, { recursive: true });
for (const source of sources) {
  const first = await fetchPage(source, 1);
  const products = [...first.products];
  for (let page = 2; page <= first.totalPages; page += 8) {
    const pages = Array.from({ length: Math.min(8, first.totalPages - page + 1) }, (_, index) => page + index);
    const results = await Promise.all(pages.map((value) => fetchPage(source, value)));
    for (const result of results) products.push(...result.products);
  }
  const snapshot = { exportedAt: new Date().toISOString(), products: products.map(compact) };
  await writeFile(new URL(`${source.key}-products.json`, outputDirectory), JSON.stringify(snapshot));
  console.log(`${source.key}: ${products.length} produits exportés`);
}

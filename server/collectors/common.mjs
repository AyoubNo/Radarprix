export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 PrixRadar-Maroc/1.0";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.7",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": USER_AGENT,
        ...(options.headers || {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout || 45_000),
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response;
  } catch (error) {
    if (attempt >= (options.attempts || 5)) throw error;
    await sleep(1500 * attempt);
    return request(url, options, attempt + 1);
  }
}

export async function fetchText(url, options = {}) {
  return (await request(url, options)).text();
}

export async function fetchJson(url, options = {}) {
  const response = await request(url, options);
  return { data: await response.json(), headers: response.headers };
}

export function decodeHtml(value = "") {
  return String(value)
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function textContent(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "));
}

export function attr(html, name) {
  return String(html).match(new RegExp(`${name}=["']([^"']*)["']`, "i"))?.[1] || null;
}

export function parsePriceCents(raw) {
  if (raw == null || raw === "") return null;
  let value = String(raw).replace(/[^\d.,]/g, "");
  if (!value) return null;
  if (value.includes(",") && value.includes(".")) {
    value = value.lastIndexOf(",") > value.lastIndexOf(".")
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  } else if (value.includes(",")) {
    value = value.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function productNameFromUrl(url) {
  const slug = String(url).split("/").pop()?.replace(/\.html(?:\?.*)?$/, "") || "Produit";
  return decodeHtml(
    slug.replace(/^p?\d+-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
  );
}

export function parseAvailability(card) {
  const plain = textContent(card).toLowerCase();
  if (/rupture|hors stock|épuisé|epuise|indisponible|out.of.stock|unavailable/.test(plain)) {
    return "out_of_stock";
  }
  if (/en stock|produit en stock|disponible|available/.test(plain)) return "in_stock";
  if (/<button[^>]*class=["'][^"']*tocart[^"']*["'][^>]*disabled/i.test(card)
      || /<button[^>]*disabled[^>]*class=["'][^"']*tocart/i.test(card)
      || /add-to-cart[^>]*(?:disabled|out-of-stock)/i.test(card)) return "out_of_stock";
  if (/data-role=["']tocart-form["']/i.test(card)) return "in_stock";
  return "unknown";
}


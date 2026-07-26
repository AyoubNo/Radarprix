import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlHomeSources } from "./collectors/home.mjs";
import { crawlPcSources } from "./collectors/pc.mjs";
import {
  countProducts,
  finishCollectionRun,
  getUniverseUpdatedAt,
  listProducts,
  startCollectionRun,
  syncUniverse,
} from "./database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, "data");
const snapshotFiles = {
  pc: path.join(dataDirectory, "pc-products.json"),
  home: path.join(dataDirectory, "home-products.json"),
};

const PC_CATEGORY_RULES = [
  ["Sacs & protections", /(sac a dos|sacoche|backpack|bagpack|cartable|laptop bag|housse|sleeve|mallette)/],
  ["Câbles & adaptateurs", /(cable|cordon|adaptateur|adapter|convertisseur|hub usb|station d accueil|docking|chargeur|charger)/],
  ["Bureaux gaming", /(bureau gaming|gaming desk|skilldesk|deskooze|nova desk|white desk|z desk)/],
  ["Chaises gaming", /(chaise|fauteuil|gaming chair|noblechairs|skillchairs|dxracer)/],
  ["Impression", /(imprimante|printer|scanner|deskjet|laserjet|officejet|toner|cartouche)/],
  ["Onduleurs & énergie", /(onduleur|\bups\b|power bank|batterie externe|multiprise|parasurtenseur|power station)/],
  ["Streaming & création", /(webcam|camera web|web camera|stream deck|capture card|video capture|carte d acquisition|green screen|fond vert)/],
  ["Photo & vidéo", /(appareil photo|cinema camera|digital camera|objectif|lens |trepied|tripod|gimbal|softbox)/],
  ["Supports & ergonomie", /(support (pc|ecran|moniteur|ordinateur|casque)|laptop stand|monitor arm|bras (ecran|moniteur)|repose pied|footrest)/],
  ["Éclairage & RGB", /(ring light|light strip|led strip|ruban led|lighting node|smart lighting|eclairage rgb|panneau led)/],
  ["Figurines & goodies", /(figurine|funko|pop!)/],
  ["Serveurs & NAS", /((serveur|server) (nas|rack|tour)|network attached storage|\bnas\b)/],
  ["Réalité virtuelle", /(realite virtuelle|virtual reality|casque vr|meta quest|oculus|playstation vr|ps vr)/],
  ["Claviers", /(clavier|keyboard|keypad)/],
  ["Souris & tapis", /(mouse ?pad|tapis.*souris|tapis gaming|souris|mouse|bungee)/],
  ["Casques & audio", /(casque|headset|headphone|ecouteur|earbuds|microphone|speaker|enceinte|haut parleur|soundbar)/],
  ["Manettes & simulation", /(manette|controller|gamepad|dualsense|dualshock|joystick|volant|racing wheel|flight stick)/],
  ["Consoles & jeux", /(playstation|\bps[345]\b|xbox|nintendo|switch oled|jeu (ps|xbox)|gaming console)/],
  ["PC portables", /(vivobook|zenbook|macbook|ideapad|thinkpad|aspire|nitro|victus|omen|latitude|inspiron|vostro|probook|elitebook|legion|katana|loq|rog zephyrus|rog strix|tuf gaming|laptop|notebook|pc portable)/],
  ["PC de bureau", /(pc gamer|pc gaming|ordinateur de bureau|ordinateur bureau|desktop|workstation|mini ?pc|all in one)/],
  ["Cartes mères", /(carte mere|motherboard|mainboard|chipset|\b(a520|a620|b450|b550|b650|b840|x570|x670|x870|h610|h710|b660|b760|z690|z790|z890)\b)/],
  ["Cartes graphiques", /(carte graphique|graphics card|\bgpu\b|\bvga\b|geforce|radeon|\brtx ?[0-9]|\bgtx ?[0-9]|intel arc|\brx ?[0-9])/],
  ["Processeurs", /(processeur|processor|\bcpu\b|ryzen|core i[3579]|core ultra|celeron|pentium|xeon|threadripper|athlon)/],
  ["Mémoire RAM", /(memoire vive|\bmemory\b|\bram\b|ddr[345]|so-?dimm|\bdimm\b)/],
  ["Stockage", /(\bssd\b|nvme|disque dur|hard drive|\bhdd\b|stockage|storage|cle usb|flash drive|carte memoire|micro ?sd)/],
  ["Ecrans", /(ecran|moniteur|monitor|display|\baoc\b|viewsonic|benq|iiyama)/],
  ["Boîtiers", /(boitier|computer case|pc case|chassis|tower case|masterbox|masterframe|lancool|nzxt h[0-9])/],
  ["Alimentations", /(alimentation|power supply|\bpsu\b|80 plus|\b[0-9]{3,4}w\b)/],
  ["Refroidissement", /(refroidissement|cooling|water ?cooling|ventirad|cpu cooler|\baio\b|ventilateur|case fan|coreliquid|masterliquid|thermal paste|pate thermique)/],
  ["Réseau", /(routeur|router|switch reseau|network|wifi|wi-fi|ethernet|access point|point d acces|repetiteur)/],
  ["Mobiles & tablettes", /(smartphone|telephone|phone|tablette|tablet|smartwatch|montre connectee)/],
];

const HOME_CATEGORY_RULES = [
  ["Réfrigérateurs & congélateurs", /(refrigerateur|frigo|congelateur|refrigeration|combine|side by side)/],
  ["Lave-vaisselle", /(lave ?vaisselle|dishwasher)/],
  ["Lavage & séchage", /(lave ?linge|machine a laver|seche ?linge|lavante sechante|lavage|sechage)/],
  ["Cuisson & fours", /(four|micro ?onde|cuisiniere|table de cuisson|plaque|hotte|cuisson|gaziniere)/],
  ["Climatisation & chauffage", /(climatiseur|climatisation|chauffage|chauffe ?eau|radiateur|ventilateur|humidificateur|deshumidificateur)/],
  ["Aspirateurs & entretien", /(aspirateur|nettoyeur|balai vapeur|entretien des sols|karcher|vacuum)/],
  ["Petit électroménager", /(cafetiere|machine a cafe|nespresso|expresso|friteuse|air fryer|bouilloire|grille ?pain|toaster|blender|mixeur|hachoir|robot de cuisine|robot patissier|presse agrume|centrifugeuse|cuiseur|petit electromenager)/],
  ["Téléviseurs & vidéoprojecteurs", /(televiseur|television|\btv\b|smart tv|tv led|oled|qled|video projecteur|videoprojecteur)/],
  ["Audio & Hi-Fi", /(barre de son|soundbar|home cinema|enceinte|haut parleur|casque|ecouteur|audio|hifi|hi-fi|radio|jbl|sonos)/],
  ["Smartphones & tablettes", /(smartphone|telephone|\bgsm\b|iphone|galaxy [as][0-9]|tablette|tablet|ipad|montre connectee|smartwatch)/],
  ["Informatique", /(ordinateur|pc portable|laptop|notebook|imprimante|scanner|moniteur|ecran pc|clavier|souris|routeur|stockage|\bssd\b)/],
  ["Gaming & consoles", /(playstation|xbox|nintendo|console|manette|controller|gaming|jeu video)/],
  ["Photo & vidéo", /(appareil photo|camera|objectif|lens|trepied|photo|video)/],
  ["Beauté & bien-être", /(beaute|bien etre|maquillage|parfum|soin|shampoing|mascara|gloss|rouge a levres|coiffure|rasoir|epilateur|seche cheveux)/],
  ["Livres & culture", /(livre|roman|manga|bande dessinee|papeterie|culture)/],
  ["Jouets & enfants", /(jouet|puzzle|lego|enfant|bebe|peluche)/],
  ["Mode & lifestyle", /(mode|vetement|chaussure|sac a main|bijou|montre|lunette|lifestyle)/],
  ["Maison & mobilier", /(meuble|mobilier|bureau|chaise|fauteuil|maison|decoration|linge de maison|rangement|literie)/],
];

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyCategory(product, universe) {
  const searchable = normalize(`${product.name || ""} ${product.sourceCategory || ""} ${product.productUrl || ""}`);
  const rules = universe === "pc" ? PC_CATEGORY_RULES : HOME_CATEGORY_RULES;
  return rules.find(([, pattern]) => pattern.test(searchable))?.[0] || "Accessoires & autres";
}

function stableId(site, product) {
  if (product.externalId) return String(product.externalId);
  return createHash("sha1").update(`${site}|${product.productUrl}`).digest("hex").slice(0, 16);
}

function normalizeProduct(product, site, universe, previous) {
  const priceCents = Number(product.priceCents);
  if (!Number.isFinite(priceCents) || priceCents <= 0 || !product.productUrl || !product.name) return null;
  const candidateOriginal = Number(product.originalPriceCents);
  const originalPriceCents = Number.isFinite(candidateOriginal) && candidateOriginal > priceCents
    ? candidateOriginal
    : null;
  const savingsCents = originalPriceCents ? originalPriceCents - priceCents : 0;
  return {
    id: previous?.id || stableId(site, product),
    site,
    name: String(product.name).trim(),
    category: previous?.category || classifyCategory(product, universe),
    priceCents,
    originalPriceCents,
    onSale: originalPriceCents !== null,
    discountPercent: originalPriceCents ? Math.round((savingsCents * 1000) / originalPriceCents) / 10 : null,
    availability: ["in_stock", "out_of_stock", "unknown"].includes(product.availability)
      ? product.availability
      : previous?.availability || "unknown",
    productUrl: product.productUrl,
    imageUrl: product.imageUrl || previous?.imageUrl || null,
    scrapedAt: product.scrapedAt || new Date().toISOString(),
  };
}

export async function readSnapshot(universe) {
  if (countProducts(universe) === 0) {
    const file = snapshotFiles[universe];
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    const products = Array.isArray(snapshot.products) ? snapshot.products : [];
    if (products.length) {
      syncUniverse(universe, products, {
        observedAt: snapshot.exportedAt || new Date().toISOString(),
      });
    }
  }
  return {
    exportedAt: getUniverseUpdatedAt(universe),
    products: listProducts(universe),
  };
}

async function writeSnapshot(universe, products, options = {}) {
  await mkdir(dataDirectory, { recursive: true });
  const file = snapshotFiles[universe];
  const temporary = `${file}.tmp`;
  const exportedAt = new Date().toISOString();
  const snapshot = { exportedAt, products };
  await writeFile(temporary, JSON.stringify(snapshot));
  try {
    await rename(temporary, file);
  } catch {
    await rm(file, { force: true });
    await rename(temporary, file);
  }
  syncUniverse(universe, products, {
    observedAt: exportedAt,
    observedSites: options.observedSites,
  });
  return snapshot;
}

let activeRefresh = null;
let collectionProgress = { running: false, startedAt: null, sites: {} };

export function getCollectionProgress() {
  return collectionProgress;
}

async function refreshUniverse(universe, crawl) {
  const current = await readSnapshot(universe);
  const currentBySite = new Map();
  for (const product of current.products) {
    if (!currentBySite.has(product.site)) currentBySite.set(product.site, []);
    currentBySite.get(product.site).push(product);
  }

  const results = await crawl((state) => {
    collectionProgress.sites[state.site] = state;
  });
  const warnings = [];
  const observedSites = [];

  for (const result of results) {
    const site = result.source.site;
    if (!result.ok) {
      warnings.push(`${site}: ${result.error}; anciennes données conservées`);
      continue;
    }
    const previousByUrl = new Map(
      (currentBySite.get(site) || []).map((product) => [product.productUrl, product]),
    );
    const normalized = result.products
      .map((product) => normalizeProduct(product, site, universe, previousByUrl.get(product.productUrl)))
      .filter(Boolean);
    if (!normalized.length) {
      warnings.push(`${site}: résultat vide; anciennes données conservées`);
      continue;
    }
    currentBySite.set(site, normalized);
    observedSites.push(site);
  }

  const products = [...currentBySite.values()]
    .flat()
    .sort((left, right) => left.site.localeCompare(right.site, "fr") || left.name.localeCompare(right.name, "fr"));
  const snapshot = await writeSnapshot(universe, products, { observedSites });
  return { universe, products, exportedAt: snapshot.exportedAt, results, warnings, observedSites };
}

export function refreshIntegratedCatalog() {
  if (activeRefresh) return activeRefresh;
  collectionProgress = { running: true, startedAt: new Date().toISOString(), sites: {} };
  const run = startCollectionRun();
  activeRefresh = (async () => {
    try {
      const pc = await refreshUniverse("pc", crawlPcSources);
      const home = await refreshUniverse("home", crawlHomeSources);
      const warnings = [...pc.warnings, ...home.warnings];
      const productsObserved = [...pc.results, ...home.results]
        .filter((result) => result.ok)
        .reduce((total, result) => total + result.products.length, 0);
      const status = warnings.length ? "partial" : "done";
      finishCollectionRun(run.id, status, {
        productsObserved,
        warnings,
        sites: collectionProgress.sites,
      });
      collectionProgress = {
        ...collectionProgress,
        running: false,
        finishedAt: new Date().toISOString(),
        warnings,
      };
      return { snapshots: { pc, home }, warnings };
    } catch (error) {
      finishCollectionRun(run.id, "error", {
        error: error?.message || String(error),
        sites: collectionProgress.sites,
      });
      collectionProgress = {
        ...collectionProgress,
        running: false,
        finishedAt: new Date().toISOString(),
        error: error?.message || String(error),
      };
      throw error;
    }
  })().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

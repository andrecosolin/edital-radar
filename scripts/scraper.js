/**
 * scraper.js — Edital Radar
 * Sources: gov.br (RSS 1.0), FINEP (HTML), BNDES (HTML), CNPq (HTML), FAPESP (RSS 2.0)
 * Results saved as JSON in /data/<today>.json
 *
 * Requirements: Node 18+ (built-in fetch), cheerio, fast-xml-parser
 *   npm install cheerio fast-xml-parser
 *
 * Note on SEBRAE: https://www.sebrae.com.br/sites/PortalSebrae/ufs/rss returns 404
 * and the SEBRAE portal consistently blocks scrapers. FAPESP (Agência FAPESP RSS)
 * is used as the working public-funder RSS source in its place.
 */

import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
mkdirSync(DATA_DIR, { recursive: true });

const TODAY = new Date().toISOString().slice(0, 10);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; EditalRadarBot/1.0; +https://github.com/seu-usuario/edital-radar)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

const KEYWORD_RE =
  /edital|chamada|financiamento|sele[cç][aã]o\s+p[uú]blica|fomento/i;

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: "__cdata",
  isArray: (name) => name === "item" || name === "entry",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(text = "") {
  if (text === null || text === undefined) return "";
  if (typeof text !== "string") text = String(text);
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isValidUrl(url) {
  return typeof url === "string" && url.startsWith("http");
}

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`  [WARN] ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`  [WARN] ${url} → ${err.message}`);
    return null;
  }
}

function log(source, count) {
  console.log(`  [${source}] ${count} opportunities found`);
}

/**
 * Parse RSS 2.0, RSS 1.0/RDF, or Atom feeds.
 * Returns flat array of { title, description, url }.
 */
function parseFeed(xml) {
  const parsed = XML_PARSER.parse(xml);

  // RSS 2.0
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) {
    return rssItems.map((it) => ({
      title: clean(it.title?.__cdata ?? it.title ?? ""),
      description: clean(it.description?.__cdata ?? it.description ?? ""),
      url: clean(it.link?.__cdata ?? it.link ?? ""),
    }));
  }

  // RSS 1.0 / RDF — gov.br uses this; fast-xml-parser roots it under "rdf:RDF"
  const rdfItems = parsed?.["rdf:RDF"]?.item;
  if (rdfItems) {
    return rdfItems.map((it) => ({
      title: clean(it.title ?? ""),
      description: clean(it.description ?? ""),
      url: clean(it.link ?? it["@_rdf:about"] ?? ""),
    }));
  }

  // Atom
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries) {
    return atomEntries.map((en) => {
      const link =
        en.link?.["@_href"] ??
        (Array.isArray(en.link) ? en.link[0]?.["@_href"] : "") ??
        "";
      return {
        title: clean(en.title?.__cdata ?? en.title ?? ""),
        description: clean(
          en.summary?.__cdata ?? en.summary ??
          en.content?.__cdata ?? en.content ?? ""
        ),
        url: clean(link),
      };
    });
  }

  return [];
}

// ---------------------------------------------------------------------------
// Source: gov.br — RSS 1.0/RDF thematic category feeds
// ---------------------------------------------------------------------------
// The main /noticias/RSS returns only category index pages with empty content.
// These sub-feeds return actual articles.

const GOVBR_FEEDS = [
  "https://www.gov.br/pt-br/noticias/financas-impostos-e-gestao-publica/RSS",
  "https://www.gov.br/pt-br/noticias/educacao-e-pesquisa/RSS",
  "https://www.gov.br/pt-br/noticias/assistencia-social/RSS",
  "https://www.gov.br/pt-br/noticias/ciencia-e-tecnologia/RSS",
  "https://www.gov.br/pt-br/noticias/meio-ambiente-e-clima/RSS",
];

async function scrapeGovBr() {
  const source = "gov.br";
  console.log(`\nScraping ${source} (RSS 1.0 — ${GOVBR_FEEDS.length} feeds) …`);

  const seen = new Set();
  const opportunities = [];
  const results = await Promise.all(GOVBR_FEEDS.map((url) => get(url)));

  for (const xml of results) {
    if (!xml) continue;
    for (const { title, description, url } of parseFeed(xml)) {
      if (!title || !isValidUrl(url) || seen.has(url)) continue;
      if (!KEYWORD_RE.test(`${title} ${description}`)) continue;
      seen.add(url);
      opportunities.push({ source, title, description, url });
    }
  }

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: FINEP — HTML table scrape
// ---------------------------------------------------------------------------

const FINEP_URL = "https://www.finep.gov.br/chamadas-publicas";

async function scrapeFinep() {
  const source = "FINEP";
  console.log(`\nScraping ${source} (HTML) …`);
  const html = await get(FINEP_URL);
  if (!html) { log(source, 0); return []; }

  const $ = load(html);
  const opportunities = [];

  const rows = $("table tbody tr");
  if (rows.length) {
    rows.each((_, row) => {
      const cols = $(row).find("td");
      if (!cols.length) return;
      const linkEl = $(row).find("a").first();
      const title = clean(linkEl.text() || cols.first().text());
      let link = linkEl.attr("href") || "";
      if (link && !link.startsWith("http")) link = "https://www.finep.gov.br" + link;
      const deadline = cols.length > 1 ? clean(cols.last().text()) : "";
      if (title && isValidUrl(link))
        opportunities.push({ source, title, description: deadline ? `Prazo: ${deadline}` : "", url: link });
    });
  } else {
    $("div.item, li.chamada, article").each((_, el) => {
      const titleEl = $(el).find("h2, h3, a").first();
      const title = clean(titleEl.text());
      const linkEl = $(el).find("a").first();
      let link = linkEl.attr("href") || "";
      if (link && !link.startsWith("http")) link = "https://www.finep.gov.br" + link;
      const desc = clean($(el).find("p").first().text());
      if (title && isValidUrl(link))
        opportunities.push({ source, title, description: desc, url: link });
    });
  }

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: BNDES — static HTML page with keyword + URL filter
// ---------------------------------------------------------------------------
// WebSphere portal routes (/wps/portal/...) return a 1 KB JS shell.
// This legacy static page has server-rendered content.

const BNDES_URL =
  "https://www.bndes.gov.br/SiteBNDES/bndes/bndes_pt/Institucional/chamadas_abertas.html";

async function scrapeBndes() {
  const source = "BNDES";
  console.log(`\nScraping ${source} (HTML static page) …`);
  const html = await get(BNDES_URL);
  if (!html) { log(source, 0); return []; }

  const $ = load(html);
  const opportunities = [];
  const seen = new Set();

  $("figure, article, div.chamada, div.card, li.chamada").each((_, el) => {
    const linkEl = $(el).find("a").first();
    let link = linkEl.attr("href") || "";
    if (link && !link.startsWith("http")) link = "https://www.bndes.gov.br" + link;

    const titleEl = $(el).find("figcaption, h2, h3, h4, strong").first();
    const title = clean(titleEl.text() || linkEl.text());

    if (!title || seen.has(title)) return;
    if (!KEYWORD_RE.test(title)) return;       // ← keyword filter
    if (!isValidUrl(link)) return;              // ← require valid URL

    seen.add(title);
    opportunities.push({ source, title, description: clean($(el).find("p").first().text()), url: link });
  });

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: CNPq — HTML scrape of open submissions page
// ---------------------------------------------------------------------------
// /chamadas/abertas-para-submissao lists currently open calls as <a> tags
// with hrefs under /cnpq/pt-br/chamadas/todas-as-chamadas/...
// Social-share links (Facebook, Twitter, etc.) share the same pattern but
// their text is "Compartilhe por …" — filtered out by length/keyword checks.

const CNPQ_URL = "https://www.gov.br/cnpq/pt-br/chamadas/abertas-para-submissao";

async function scrapeCnpq() {
  const source = "CNPq";
  console.log(`\nScraping ${source} (HTML) …`);
  const html = await get(CNPQ_URL);
  if (!html) { log(source, 0); return []; }

  const $ = load(html);
  const opportunities = [];
  const seen = new Set();

  // Only anchors that point to the individual chamada detail pages
  $('a[href*="/cnpq/pt-br/chamadas/todas-as-chamadas/"]').each((_, el) => {
    const title = clean($(el).text());
    const link = $(el).attr("href") || "";

    if (!title || title.length < 15 || seen.has(link)) return;
    // Skip social-share wrappers (they duplicate hrefs with different text)
    if (/compartilhe|facebook|twitter|linkedin|whatsapp|copiar/i.test(title)) return;

    seen.add(link);
    opportunities.push({ source, title, description: "", url: link });
  });

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: FAPESP — RSS 2.0 (replaces SEBRAE whose RSS URL returns 404)
// ---------------------------------------------------------------------------

const FAPESP_RSS = "https://agencia.fapesp.br/rss/";

async function scrapeFapesp() {
  const source = "FAPESP";
  console.log(`\nScraping ${source} (RSS 2.0) …`);
  const xml = await get(FAPESP_RSS);
  if (!xml) { log(source, 0); return []; }

  const items = parseFeed(xml);
  const opportunities = items
    .filter(({ title, description, url }) =>
      isValidUrl(url) && KEYWORD_RE.test(`${title} ${description}`)
    )
    .map(({ title, description, url }) => ({ source, title, description, url }));

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`=== Edital Radar — ${TODAY} ===`);

  const [govbr, finep, bndes, cnpq, fapesp] = await Promise.all([
    scrapeGovBr(),
    scrapeFinep(),
    scrapeBndes(),
    scrapeCnpq(),
    scrapeFapesp(),
  ]);

  const all = [...govbr, ...finep, ...bndes, ...cnpq, ...fapesp].map((opp) => ({
    ...opp,
    scraped_date: TODAY,
  }));

  const outPath = resolve(DATA_DIR, `${TODAY}.json`);
  writeFileSync(outPath, JSON.stringify(all, null, 2), "utf-8");

  console.log(`\n===== RESULTS =====`);
  console.log(`  gov.br : ${govbr.length}`);
  console.log(`  FINEP  : ${finep.length}`);
  console.log(`  BNDES  : ${bndes.length}`);
  console.log(`  CNPq   : ${cnpq.length}`);
  console.log(`  FAPESP : ${fapesp.length}`);
  console.log(`  TOTAL  : ${all.length}`);
  console.log(`  Saved  : ${outPath}`);
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});

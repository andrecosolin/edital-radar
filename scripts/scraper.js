/**
 * scraper.js — Edital Radar
 * Sources: gov.br (RSS 1.0), FINEP (HTML), BNDES (HTML), CNPq (HTML), FAPESP (RSS 2.0),
 *          EMBRAPII (RSS), FAPERJ (RSS), FAPEMIG (Nuxt payload), Araucária (sitemap)
 * Results saved as JSON in /data/<today>.json
 *
 * Requirements: Node 18+ (built-in fetch), cheerio, fast-xml-parser
 *   npm install cheerio fast-xml-parser
 *
 * Note on SEBRAE: portal consistently blocks all automated requests (timeout).
 * Skipped intentionally — no public RSS or scrapable listing available.
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

// Titles matching this pattern are noise: closed/administrative notices
const NOISE_RE =
  /resultado|retifica[cç][aã]o|preliminar|credenciamento|divulga[cç][aã]o|homologa[cç][aã]o/i;

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

const MONTH_MAP = {
  janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4,
  junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

/**
 * Parse a deadline string into a Date object.
 * Handles "DD/MM/YYYY", "DD/MM/YY", and "DD de mês de YYYY".
 * Returns null if the format isn't recognised.
 */
function parseDeadlineDate(str) {
  if (!str) return null;

  // DD/MM/YYYY or DD/MM/YY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let [, d, m, y] = slashMatch.map(Number);
    if (y < 100) y += 2000;
    return new Date(y, m - 1, d);
  }

  // DD de mês de YYYY  (e.g. "30 de setembro de 2026")
  const longMatch = str.match(/^(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?$/i);
  if (longMatch) {
    const d = parseInt(longMatch[1], 10);
    const m = MONTH_MAP[longMatch[2].toLowerCase()];
    const y = longMatch[3] ? parseInt(longMatch[3], 10) : new Date().getFullYear();
    if (m === undefined) return null;
    return new Date(y, m, d);
  }

  return null;
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
// Source: FINEP — HTML table scrape + per-chamada detail fetch
// ---------------------------------------------------------------------------

const FINEP_URL = "https://www.finep.gov.br/chamadas-publicas";

/**
 * Fetch a single FINEP chamada page and extract situacao, deadline, budget, target_audience.
 * Labels and values share the same parent element, e.g.:
 *   <p>Situacão: Aberta</p>
 *   <p>Orçamento da chamada: R$ 300 milhões</p>
 */
async function fetchFinepDetails(url) {
  const html = await get(url);
  if (!html) return { situacao: "", deadline: "", budget: "", target_audience: "" };

  const $ = load(html);

  function extractAfterLabel(labelText) {
    let value = "";
    $("*").each((_, el) => {
      const ownText = $(el).clone().children().remove().end().text().trim();
      if (ownText === labelText) {
        const parentText = clean($(el).parent().text());
        value = parentText.replace(labelText, "").trim();
        return false; // break
      }
    });
    return value;
  }

  // "Situacão:" uses a variant encoding — match both ç and c+combining cedilla
  const situacao = extractAfterLabel("Situacão:") || extractAfterLabel("Situação:");

  return {
    situacao,
    deadline: extractAfterLabel("Prazo para envio de propostas até:"),
    budget: extractAfterLabel("Orçamento da chamada:"),
    target_audience: extractAfterLabel("Público-alvo:"),
  };
}

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
      if (title && isValidUrl(link))
        opportunities.push({ source, title, description: "", url: link });
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

  // Enrich each chamada with situacao, deadline, budget, target_audience in parallel
  console.log(`  Fetching details for ${opportunities.length} FINEP chamadas …`);
  const details = await Promise.all(opportunities.map(({ url }) => fetchFinepDetails(url)));
  const enriched = opportunities.map((opp, i) => ({ ...opp, ...details[i] }));

  // Discard closed chamadas immediately
  const open = enriched.filter((opp) => !/encerrada/i.test(opp.situacao));
  const closedCount = enriched.length - open.length;
  if (closedCount > 0) console.log(`  Discarded ${closedCount} FINEP chamada(s) with Situação=Encerrada`);

  log(source, open.length);
  return open;
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
    if (/compartilhe|facebook|twitter|linkedin|whatsapp|copiar/i.test(title)) return;
    if (NOISE_RE.test(title)) return;

    seen.add(link);
    opportunities.push({ source, title, description: "", url: link });
  });

  // Fetch each chamada detail page to extract deadline
  if (opportunities.length) {
    console.log(`  Fetching deadlines for ${opportunities.length} CNPq chamadas …`);
    const deadlines = await Promise.all(opportunities.map(({ url }) => fetchDeadline(url)));
    for (let i = 0; i < opportunities.length; i++) {
      opportunities[i].deadline = deadlines[i];
    }
  }

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
// Source: EMBRAPII — HTML transparencia page, chamadas section
// ---------------------------------------------------------------------------
// RSS feed returned the full history (2016-present) with no status markers.
// The transparencia page has data-year attributes per item — only take 2025-2026.

const EMBRAPII_TRANSP = "https://embrapii.org.br/transparencia/";

async function scrapeEmbrapii() {
  const source = "EMBRAPII";
  console.log(`\nScraping ${source} (transparencia HTML) …`);
  const html = await get(EMBRAPII_TRANSP);
  if (!html) { log(source, 0); return []; }

  const $ = load(html);
  const opportunities = [];
  const seen = new Set();

  // Items carry data-year="YYYY" — restrict to recent years only
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 1; // current year and previous year

  $("#chamadas .single-item-listagem").each((_, el) => {
    const year = parseInt($(el).attr("data-year") || "0", 10);
    if (year < minYear) return;

    const linkEl = $(el).find("a.title-single-item-listagem");
    const title = clean(linkEl.text());
    const url = linkEl.attr("href") || "";

    if (!title || !isValidUrl(url) || seen.has(url)) return;
    if (NOISE_RE.test(title)) return;

    seen.add(url);
    opportunities.push({ source, title, description: "", url });
  });

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: FAPERJ — RSS 2.0 news feed, keyword-filtered
// ---------------------------------------------------------------------------
// FAPERJ's portal is JS-rendered; their /rss.php is the only public feed.
// Items are news articles — edital announcements appear here filtered by keyword.

const FAPERJ_RSS = "https://faperj.br/rss.php";

async function scrapeFaperj() {
  const source = "FAPERJ";
  console.log(`\nScraping ${source} (RSS + status check) …`);
  const xml = await get(FAPERJ_RSS);
  if (!xml) { log(source, 0); return []; }

  const items = parseFeed(xml)
    .filter(({ title, description, url }) =>
      isValidUrl(url) &&
      KEYWORD_RE.test(`${title} ${description}`) &&
      !NOISE_RE.test(title)
    );

  if (!items.length) { log(source, 0); return []; }

  // Fetch each page to confirm it's still open
  console.log(`  Checking status for ${items.length} FAPERJ candidates …`);
  const results = await Promise.all(
    items.map(async ({ title, description, url }) => {
      const html = await get(url);
      if (!html) return null;
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      // Must mention "aberta" somewhere on the page
      if (!/aberta/i.test(text)) return null;
      const dm = DEADLINE_RE.exec(text);
      const deadline = dm ? clean(dm[1]) : "";
      return { source, title, description, url, deadline };
    })
  );

  const opportunities = results.filter(Boolean);
  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: FAPEMIG — Nuxt payload JSON
// ---------------------------------------------------------------------------
// fapemig.br is a Nuxt 3 app. The open-chamadas page embeds a _payload.json
// link in its HTML; that JSON array contains title+slug pairs for all open calls.

const FAPEMIG_PAGE = "https://fapemig.br/oportunidades/chamadas-e-editais?status=aberta";

async function scrapeFapemig() {
  const source = "FAPEMIG";
  console.log(`\nScraping ${source} (Nuxt payload) …`);

  const html = await get(FAPEMIG_PAGE);
  if (!html) { log(source, 0); return []; }

  const payloadMatch = html.match(/href="([^"]*_payload\.json[^"]*)"/);
  if (!payloadMatch) {
    console.warn("  [WARN] FAPEMIG: could not find _payload.json link");
    log(source, 0); return [];
  }

  const payloadUrl = "https://fapemig.br" + payloadMatch[1];
  const payloadText = await get(payloadUrl);
  if (!payloadText) { log(source, 0); return []; }

  let data;
  try { data = JSON.parse(payloadText); } catch {
    console.warn("  [WARN] FAPEMIG: payload JSON parse failed");
    log(source, 0); return [];
  }

  const opportunities = [];
  const seen = new Set();

  for (let i = 0; i < data.length - 1; i++) {
    const title = data[i];
    const slug  = data[i + 1];
    if (typeof title !== "string" || typeof slug !== "string") continue;

    // Title: chamada/edital keyword + year (avoids category names)
    const isTitle = title.length > 15 && title.length < 200 &&
                    KEYWORD_RE.test(title) && /20\d{2}/.test(title);
    // Slug: lowercase + hyphens only, no spaces
    const isSlug  = /^[a-z0-9][a-z0-9-]+$/.test(slug) && slug.includes("-") && slug.length > 10;

    if (isTitle && isSlug && !seen.has(slug)) {
      seen.add(slug);
      opportunities.push({
        source,
        title,
        description: "",
        url: "https://fapemig.br/oportunidades/chamadas-e-editais/" + slug,
      });
    }
  }

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Source: Fundação Araucária (FAPPR) — /Programas-Abertos page
// ---------------------------------------------------------------------------
// This page explicitly lists all currently open programs (CP, PI, PA, PMI).
// Each program is an H3 heading like "CP 09/26: Interconexões Catalunha"
// followed by a description paragraph that may contain a deadline.
// Items without a parseable deadline are discarded per quality requirements.

const ARAUCARIA_URL = "https://www.fappr.pr.gov.br/Programas-Abertos";

async function scrapeAraucaria() {
  const source = "Araucária";
  console.log(`\nScraping ${source} (Programas-Abertos) …`);

  const html = await get(ARAUCARIA_URL);
  if (!html) { log(source, 0); return []; }

  const $ = load(html);
  const opportunities = [];
  const seen = new Set();

  $("h3").each((_, h3El) => {
    const rawTitle = clean($(h3El).text());
    // Must start with CP/PI/PA/PMI + number (e.g. "CP 09/26:", "PI 03/26:")
    if (!/^(CP|PI|PA|PMI)\s+\d/i.test(rawTitle)) return;
    if (NOISE_RE.test(rawTitle)) return;
    if (seen.has(rawTitle)) return;

    // Collect sibling text until the next H3
    let siblingText = "";
    let node = $(h3El).next();
    while (node.length && node[0].name !== "h3") {
      siblingText += " " + node.text();
      node = node.next();
    }

    const dm = DEADLINE_RE.exec(siblingText.replace(/\s+/g, " "));
    const deadline = dm ? clean(dm[1]) : "";
    if (!deadline) return; // discard items without a confirmed deadline

    seen.add(rawTitle);
    opportunities.push({
      source,
      title: rawTitle,
      description: clean(siblingText).slice(0, 300),
      url: ARAUCARIA_URL,
      deadline,
    });
  });

  log(source, opportunities.length);
  return opportunities;
}

// ---------------------------------------------------------------------------
// Deadline extraction — fetch each edital page and look for a date
// ---------------------------------------------------------------------------

const MONTHS =
  "janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";

const DEADLINE_RE = new RegExp(
  // trigger keyword
  "(?:prazo|inscri[cç][oõ]es?\\s+at[eé]|submiss[aã]o\\s+at[eé]|encerramento|data[\\s\\-]limite)" +
  // up to 150 chars of anything (non-greedy)
  "[\\s\\S]{0,150}?" +
  // date: "DD de mês de YYYY" or "DD/MM/YYYY" or "DD/MM/YY"
  `(\\d{1,2}\\s+de\\s+(?:${MONTHS})(?:\\s+de\\s+\\d{2,4})?|\\d{1,2}/\\d{1,2}/\\d{2,4})`,
  "i"
);

async function fetchDeadline(url) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Strip tags and collapse whitespace for clean text search
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = DEADLINE_RE.exec(text);
    return m ? clean(m[1]) : "";
  } catch {
    return "";
  }
}

async function enrichWithDeadlines(opportunities) {
  // These sources already set deadlines during scraping — skip re-fetching
  const alreadyEnriched = new Set(["FINEP", "Araucária", "CNPq", "FAPERJ"]);
  const toFetch = opportunities.map((opp) =>
    alreadyEnriched.has(opp.source) ? Promise.resolve("") : fetchDeadline(opp.url)
  );
  const nonEnriched = opportunities.filter((o) => !alreadyEnriched.has(o.source)).length;
  if (nonEnriched > 0) console.log(`\nFetching deadlines for ${nonEnriched} opportunities …`);
  const deadlines = await Promise.all(toFetch);
  return opportunities.map((opp, i) => ({
    ...opp,
    deadline: opp.deadline !== undefined ? opp.deadline : deadlines[i],
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`=== Edital Radar — ${TODAY} ===`);

  const [govbr, finep, bndes, cnpq, fapesp, embrapii, faperj, fapemig, araucaria] =
    await Promise.all([
      scrapeGovBr(),
      scrapeFinep(),
      scrapeBndes(),
      scrapeCnpq(),
      scrapeFapesp(),
      scrapeEmbrapii(),
      scrapeFaperj(),
      scrapeFapemig(),
      scrapeAraucaria(),
    ]);

  const raw = [
    ...govbr, ...finep, ...bndes, ...cnpq, ...fapesp,
    ...embrapii, ...faperj, ...fapemig, ...araucaria,
  ].map((opp) => ({ ...opp, scraped_date: TODAY }));

  // Global noise filter — remove closed/administrative notices from any source
  const merged = raw.filter((opp) => !NOISE_RE.test(opp.title));
  const noiseRemoved = raw.length - merged.length;
  if (noiseRemoved > 0) console.log(`\n  Global noise filter removed ${noiseRemoved} item(s)`);

  const enriched = await enrichWithDeadlines(merged);

  // Filter out items with a known deadline that has already passed
  const todayDate = new Date(TODAY);
  const active = enriched.filter((opp) => {
    if (!opp.deadline) return true; // no deadline info — keep it
    const parsed = parseDeadlineDate(opp.deadline);
    if (!parsed) return true; // couldn't parse — keep it
    return parsed >= todayDate;
  });

  const expiredCount = enriched.length - active.length;
  if (expiredCount > 0)
    console.log(`\n  Filtered out ${expiredCount} item(s) with expired deadlines`);

  const outPath = resolve(DATA_DIR, `${TODAY}.json`);
  writeFileSync(outPath, JSON.stringify(active, null, 2), "utf-8");

  console.log(`\n===== RESULTS =====`);
  console.log(`  gov.br    : ${govbr.length}`);
  console.log(`  FINEP     : ${finep.length}`);
  console.log(`  BNDES     : ${bndes.length}`);
  console.log(`  CNPq      : ${cnpq.length}`);
  console.log(`  FAPESP    : ${fapesp.length}`);
  console.log(`  EMBRAPII  : ${embrapii.length}`);
  console.log(`  FAPERJ    : ${faperj.length}`);
  console.log(`  FAPEMIG   : ${fapemig.length}`);
  console.log(`  Araucária : ${araucaria.length}`);
  console.log(`  SEBRAE    : 0 (blocked)`);
  console.log(`  ----------`);
  console.log(`  Raw total       : ${enriched.length}`);
  console.log(`  After filtering : ${active.length}`);
  console.log(`  Saved           : ${outPath}`);
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});

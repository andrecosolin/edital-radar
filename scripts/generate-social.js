/**
 * generate-social.js — Edital Radar
 * Reads the latest scraped data, calls Claude to generate Instagram
 * feed posts and stories, and saves to /social/<date>.json.
 *
 * Usage: node scripts/generate-social.js
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR    = resolve(__dirname, "../data");
const SOCIAL_DIR  = resolve(__dirname, "../social");
mkdirSync(SOCIAL_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Find the most recent data file (same logic as generate-newsletter.js)
// ---------------------------------------------------------------------------

function getLatestDataFile() {
  const files = readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  if (!files.length) throw new Error("No data files found in /data");

  const latest = files[files.length - 1];
  console.log(`Using data file: ${latest}`);
  return { path: resolve(DATA_DIR, latest), date: latest.replace(".json", "") };
}

function filterOpportunities(records) {
  return records.filter(({ url }) => {
    if (!url || typeof url !== "string") return false;
    if (!url.startsWith("http")) return false;
    if (url.toLowerCase().endsWith(".pdf")) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Você é social media manager do Edital Radar, newsletter sobre financiamento público para startups e pesquisadores brasileiros.
Crie posts para Instagram que gerem curiosidade e levem ao cadastro na newsletter. Tom direto, sem corporativês, sem hashtags genéricas.
Nunca use travessão. Escreva como pessoa, não como marca.`;

function buildUserMessage(opportunities, date) {
  return `Gere o conteúdo de Instagram do Edital Radar para ${date}.

Baseie-se nas oportunidades abaixo:
${JSON.stringify(opportunities, null, 2)}

Retorne um JSON válido com exatamente esta estrutura:
{
  "feed_posts": [
    {
      "source": "<nome da fonte, ex: FINEP>",
      "title": "<título curto do edital>",
      "post": "<texto completo do post>"
    }
  ],
  "stories": [
    {
      "text": "<texto do story>"
    }
  ]
}

Regras para feed_posts (um por oportunidade):
- Primeira linha: fato impactante sobre o edital (ex: "A FINEP tem R$ 300 milhões disponíveis para empresas do agronegócio.")
- Corpo: 2-3 linhas explicando quem pode se inscrever e por que vale
- CTA final: "Link na bio para receber todo edital assim toda semana."
- 5 hashtags específicas do nicho (ex: #finep #fomento #startupbrasil)
- Nunca use travessão

Regras para stories (exatamente 3):
- Formato: "Você sabia que [fato]? Cadastra na newsletter. Link na bio."
- Curtos, urgentes, baseados em editais diferentes
- Nunca use travessão

Retorne APENAS o JSON. Sem texto antes ou depois. Sem markdown code fences.`;
}

// ---------------------------------------------------------------------------
// Call Claude
// ---------------------------------------------------------------------------

async function generateSocial(opportunities, date) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");

  const client = new Anthropic({ apiKey });

  console.log(`\nCalling Claude (${opportunities.length} opportunities) …`);

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(opportunities, date) }],
  });

  // Extract text block (thinking blocks are separate)
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text block");

  const raw = textBlock.text.trim();
  const jsonText = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Claude returned invalid JSON: ${err.message}\n\nRaw:\n${raw}`);
  }

  if (!Array.isArray(result.feed_posts)) throw new Error("Missing feed_posts array");
  if (!Array.isArray(result.stories))    throw new Error("Missing stories array");

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { path, date } = getLatestDataFile();

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const opportunities = filterOpportunities(raw);

  console.log(`Records: ${raw.length} total → ${opportunities.length} after filter`);

  if (!opportunities.length) {
    console.log("No opportunities to post about. Exiting.");
    return;
  }

  const result = await generateSocial(opportunities, date);

  const outPath = resolve(SOCIAL_DIR, `${date}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\nSaved to: ${outPath}`);

  // ---------------------------------------------------------------------------
  // Print all generated posts
  // ---------------------------------------------------------------------------

  console.log(`\n${"=".repeat(60)}`);
  console.log(`FEED POSTS (${result.feed_posts.length})`);
  console.log("=".repeat(60));

  result.feed_posts.forEach((p, i) => {
    console.log(`\n--- Post ${i + 1} [${p.source}] ${p.title} ---`);
    console.log(p.post);
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`STORIES (${result.stories.length})`);
  console.log("=".repeat(60));

  result.stories.forEach((s, i) => {
    console.log(`\n--- Story ${i + 1} ---`);
    console.log(s.text);
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. ${result.feed_posts.length} feed posts + ${result.stories.length} stories.`);
}

main().catch((err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

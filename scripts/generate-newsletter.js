/**
 * generate-newsletter.js — Edital Radar
 * Reads the latest scraped data, calls Claude to generate a structured
 * newsletter digest, and saves the result to /newsletter/<date>.json.
 *
 * Requirements: @anthropic-ai/sdk dotenv
 *   npm install @anthropic-ai/sdk dotenv
 *
 * Usage: node scripts/generate-newsletter.js
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const NEWSLETTER_DIR = resolve(__dirname, "../newsletter");
mkdirSync(NEWSLETTER_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Find the most recent data file
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

// ---------------------------------------------------------------------------
// Filter opportunities
// ---------------------------------------------------------------------------

function filterOpportunities(records) {
  return records.filter(({ url }) => {
    if (!url || typeof url !== "string") return false;
    if (!url.startsWith("http")) return false;
    if (url.toLowerCase().endsWith(".pdf")) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Generate newsletter via Claude — outputs structured JSON array
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Você é editor de uma newsletter chamada Edital Radar, voltada para pesquisadores, startups e pequenas empresas brasileiras. Seu tom é direto, útil e sem enrolação. Escreva em português brasileiro.

Para cada oportunidade fornecida, retorne um objeto JSON com exatamente estes campos:
- "title": título da chamada (string, em português se possível)
- "source": copie exatamente o campo "source" do input (string)
- "deadline": copie exatamente o campo "deadline" do input. Se estiver vazio (""), mantenha vazio. Nunca invente prazo, nunca escreva "consulte o edital".
- "budget": copie exatamente o campo "budget" do input. Se estiver vazio ou ausente, use "".
- "target_audience": copie exatamente o campo "target_audience" do input. Se estiver vazio ou ausente, use "".
- "description": um parágrafo curto (2-4 frases) explicando o que é a oportunidade, por que vale atenção e quem deveria se inscrever (string)
- "url": copie exatamente o campo "url" do input (string)

Regras de exibição (aplique na "description" e nos campos acima):
- Se "budget" não estiver vazio, mencione o orçamento na description como informação de destaque.
- Nunca mostre campos vazios no texto final.

Retorne APENAS um array JSON válido contendo todos os objetos. Sem texto antes ou depois. Sem markdown code fences. Sem comentários.`;

async function generateNewsletter(opportunities, date) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");

  const client = new Anthropic({ apiKey });

  const userMessage = `Gere os itens da edição de ${date} do Edital Radar com base nas oportunidades abaixo.

${JSON.stringify(opportunities, null, 2)}`;

  console.log(`\nCalling Claude (${opportunities.length} opportunities) …`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = response.content[0].text.trim();

  // Strip code fences if Claude added them despite instructions
  const jsonText = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let items;
  try {
    items = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Claude returned invalid JSON: ${err.message}\n\nRaw output:\n${raw}`);
  }

  if (!Array.isArray(items)) throw new Error("Claude did not return a JSON array");

  return items;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { path, date } = getLatestDataFile();

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const opportunities = filterOpportunities(raw);

  console.log(`Records loaded: ${raw.length} → after filtering: ${opportunities.length}`);

  const items = await generateNewsletter(opportunities, date);

  const outPath = resolve(NEWSLETTER_DIR, `${date}.json`);
  writeFileSync(outPath, JSON.stringify(items, null, 2), "utf-8");

  console.log(`\nNewsletter saved to: ${outPath}`);
  console.log(`\n${items.length} items generated:\n`);
  for (const item of items) {
    console.log(`  • [${item.source}] ${item.title}`);
    console.log(`    Prazo: ${item.deadline}`);
    console.log(`    ${item.url}\n`);
  }
}

main().catch((err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

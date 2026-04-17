/**
 * setup-resend.js — Edital Radar
 * Creates the "Edital Radar Subscribers" audience in Resend and saves
 * the returned ID to .env as RESEND_AUDIENCE_ID.
 *
 * Usage: node scripts/setup-resend.js
 */

import "dotenv/config";
import { Resend } from "resend";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../.env");

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set");

  const resend = new Resend(apiKey);

  console.log('Creating audience "Edital Radar Subscribers" …');

  const { data, error } = await resend.audiences.create({
    name: "Edital Radar Subscribers",
  });

  if (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  }

  const audienceId = data.id;
  console.log(`Audience created! ID: ${audienceId}`);

  // Write RESEND_AUDIENCE_ID to .env (add or update the line)
  let env = readFileSync(ENV_PATH, "utf-8");

  if (/^RESEND_AUDIENCE_ID=.*/m.test(env)) {
    env = env.replace(/^RESEND_AUDIENCE_ID=.*/m, `RESEND_AUDIENCE_ID=${audienceId}`);
  } else {
    env = env.trimEnd() + `\nRESEND_AUDIENCE_ID=${audienceId}\n`;
  }

  writeFileSync(ENV_PATH, env, "utf-8");
  console.log(`.env updated with RESEND_AUDIENCE_ID=${audienceId}`);
}

main().catch((err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

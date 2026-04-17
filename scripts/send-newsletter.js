/**
 * send-newsletter.js — Edital Radar
 * Reads the latest newsletter JSON, renders it as HTML, and sends via Resend.
 *
 * Requirements: resend dotenv
 *   npm install resend dotenv
 *
 * Usage: node scripts/send-newsletter.js [recipient@email.com]
 * Default recipient if none provided: andre.cosolin@gmail.com
 */

import "dotenv/config";
import { Resend } from "resend";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEWSLETTER_DIR = resolve(__dirname, "../newsletter");

// ---------------------------------------------------------------------------
// Find the most recent newsletter JSON file
// ---------------------------------------------------------------------------

function getLatestNewsletter() {
  const files = readdirSync(NEWSLETTER_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  if (!files.length) throw new Error("No newsletter files found in /newsletter");

  const latest = files[files.length - 1];
  const date = latest.replace(".json", "");
  console.log(`Using newsletter: ${latest}`);
  return { path: resolve(NEWSLETTER_DIR, latest), date };
}

// ---------------------------------------------------------------------------
// Render one newsletter item as HTML
// ---------------------------------------------------------------------------

function renderItem(item) {
  const safeTitle = item.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSource = item.source.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeDeadline = item.deadline.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeDesc = item.description.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeUrl = item.url.replace(/"/g, "&quot;");

  return `
    <h2 style="margin: 0 0 10px; font-size: 17px; color: #1e3a5f; line-height: 1.4;">${safeTitle}</h2>
    <div style="margin-bottom: 14px; display: flex; gap: 6px; flex-wrap: wrap;">
      <span style="display: inline-block; background: #f0f0f0; color: #555; font-size: 12px;
                   padding: 2px 8px; border-radius: 4px; font-family: inherit;">Fonte: ${safeSource}</span>
      <span style="display: inline-block; background: #f0f0f0; color: #555; font-size: 12px;
                   padding: 2px 8px; border-radius: 4px; font-family: inherit;">Prazo: ${safeDeadline}</span>
    </div>
    <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.7; color: #374151;">${safeDesc}</p>
    <a href="${safeUrl}" style="font-size: 13px; color: #2563eb; text-decoration: none; font-weight: 500;">
      Ver edital &rarr;
    </a>`;
}

// ---------------------------------------------------------------------------
// Build full email HTML
// ---------------------------------------------------------------------------

function buildEmailHtml(items, date) {
  const itemsHtml = items
    .map((item, i) => {
      const isLast = i === items.length - 1;
      return `
    <div style="margin-bottom: ${isLast ? "0" : "28px"};">
      ${renderItem(item)}
    </div>
    ${isLast ? "" : '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 28px;" />'}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Edital Radar – ${date}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5;
             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
             'Helvetica Neue', Arial, sans-serif; color: #111827;">

  <div style="width: 100%; background-color: #f4f4f5; padding: 32px 16px; box-sizing: border-box;">
    <div style="max-width: 620px; margin: 0 auto; background-color: #ffffff;
                border-radius: 8px; overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background-color: #1e3a5f; padding: 28px 32px; text-align: center;">
        <div style="font-size: 22px; font-weight: 700; color: #ffffff;
                    letter-spacing: 0.5px;">📡 Edital Radar</div>
        <div style="margin-top: 6px; font-size: 13px; color: #93c5fd;">
          Oportunidades de fomento · ${date}
        </div>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        ${itemsHtml}
      </div>

      <!-- Footer -->
      <div style="background-color: #f9fafb; border-top: 1px solid #e5e7eb;
                  padding: 20px 32px; text-align: center;
                  font-size: 12px; color: #9ca3af;">
        <p style="margin: 0 0 6px;">
          Você recebe este email porque se inscreveu no Edital Radar.
        </p>
        <p style="margin: 0;">
          <a href="#unsubscribe" style="color: #9ca3af; text-decoration: underline;">
            Cancelar inscrição
          </a>
        </p>
      </div>

    </div>
  </div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set");

  const to = process.argv[2] || "andre.cosolin@gmail.com";

  const { path, date } = getLatestNewsletter();
  const items = JSON.parse(readFileSync(path, "utf-8"));

  console.log(`Rendering ${items.length} items …`);
  const html = buildEmailHtml(items, date);

  const resend = new Resend(apiKey);

  console.log(`Sending to: ${to}`);

  const { data, error } = await resend.emails.send({
    from: "Edital Radar <onboarding@resend.dev>",
    to,
    subject: `Edital Radar – ${date}`,
    html,
  });

  if (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  }

  console.log(`Email sent! ID: ${data.id}`);
}

main().catch((err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

/**
 * send-to-list.js — Edital Radar
 * Fetches all contacts from the Resend Audience and sends the latest
 * newsletter to each one using the Resend batch API.
 *
 * Usage: node scripts/send-to-list.js
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
// Render one item as HTML (mirrors send-newsletter.js)
// ---------------------------------------------------------------------------

function renderItem(item) {
  const safeTitle = item.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSource = item.source.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeDesc = item.description.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeUrl = item.url.replace(/"/g, "&quot;");

  const pills = [
    `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:12px;padding:2px 8px;border-radius:4px;">Fonte: ${safeSource}</span>`,
    item.deadline
      ? `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:12px;padding:2px 8px;border-radius:4px;">Prazo: ${item.deadline.replace(/</g, "&lt;")}</span>`
      : "",
    item.budget
      ? `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:12px;padding:2px 8px;border-radius:4px;">Orçamento: ${item.budget.replace(/</g, "&lt;")}</span>`
      : "",
    item.target_audience
      ? `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:12px;padding:2px 8px;border-radius:4px;">Para: ${item.target_audience.replace(/</g, "&lt;")}</span>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <h2 style="margin:0 0 10px;font-size:17px;color:#1e3a5f;line-height:1.4;">${safeTitle}</h2>
    <div style="margin-bottom:14px;">${pills}</div>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#374151;">${safeDesc}</p>
    <a href="${safeUrl}" style="font-size:13px;color:#2563eb;text-decoration:none;font-weight:500;">
      Ver edital &rarr;
    </a>`;
}

function buildEmailHtml(items, date) {
  const itemsHtml = items
    .map((item, i) => {
      const isLast = i === items.length - 1;
      return `
    <div style="margin-bottom:${isLast ? "0" : "28px"};">
      ${renderItem(item)}
    </div>
    ${isLast ? "" : '<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 28px;" />'}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Edital Radar – ${date}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
  <div style="width:100%;background:#f4f4f5;padding:32px 16px;box-sizing:border-box;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <div style="background:#1e3a5f;padding:28px 32px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:.5px;">📡 Edital Radar</div>
        <div style="margin-top:6px;font-size:13px;color:#93c5fd;">Oportunidades de fomento · ${date}</div>
      </div>
      <div style="padding:32px;">
        ${itemsHtml}
      </div>
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;font-size:12px;color:#9ca3af;">
        <p style="margin:0 0 6px;">Você recebe este email porque se inscreveu no Edital Radar.</p>
        <p style="margin:0;"><a href="#unsubscribe" style="color:#9ca3af;text-decoration:underline;">Cancelar inscrição</a></p>
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
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set");
  if (!audienceId) throw new Error("RESEND_AUDIENCE_ID environment variable is not set");

  const resend = new Resend(apiKey);

  // Load newsletter
  const { path, date } = getLatestNewsletter();
  const items = JSON.parse(readFileSync(path, "utf-8"));
  const html = buildEmailHtml(items, date);
  const subject = `Edital Radar – ${date}`;

  // Fetch contacts from audience
  console.log("Fetching contacts from audience …");
  const { data: listData, error: listError } = await resend.contacts.list({ audienceId });

  if (listError) {
    console.error("[ERROR] Failed to fetch contacts:", listError);
    process.exit(1);
  }

  const contacts = (listData?.data ?? []).filter((c) => !c.unsubscribed && c.email);

  if (!contacts.length) {
    console.log("No active contacts found. Nothing sent.");
    return;
  }

  console.log(`Sending to ${contacts.length} contact(s) …`);

  // Resend batch API: max 100 emails per call
  const BATCH_SIZE = 100;
  let totalSent = 0;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE).map((c) => ({
      from: "Edital Radar <onboarding@resend.dev>",
      to: c.email,
      subject,
      html,
    }));

    const { data, error } = await resend.batch.send(batch);

    if (error) {
      console.error(`[ERROR] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error);
      continue;
    }

    totalSent += data?.data?.length ?? batch.length;
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} emails queued`);
  }

  console.log(`\nDone. ${totalSent} email(s) sent for edition ${date}.`);
}

main().catch((err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

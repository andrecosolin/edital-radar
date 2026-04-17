/**
 * api/subscribe.js — Vercel serverless function
 * POST { email } → adds contact to Resend Audience
 */

const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body ?? {};

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email inválido." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error("Missing RESEND_API_KEY or RESEND_AUDIENCE_ID");
    return res.status(500).json({ error: "Configuração incompleta no servidor." });
  }

  const resend = new Resend(apiKey);

  const { data, error } = await resend.contacts.create({
    audienceId,
    email: email.toLowerCase().trim(),
    unsubscribed: false,
  });

  if (error) {
    console.error("Resend error:", error);
    return res.status(500).json({ error: "Não foi possível concluir a inscrição. Tente novamente." });
  }

  return res.status(200).json({ success: true, id: data.id });
}

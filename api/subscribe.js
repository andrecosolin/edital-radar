/**
 * api/subscribe.js — Vercel serverless function
 * POST { email } → adds contact to Resend Audience
 */

const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    // Parse body — Vercel may pass it as a string if Content-Type isn't set
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body ?? {};

    console.log("subscribe request body:", JSON.stringify(body));

    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).end(JSON.stringify({ error: "Email inválido." }));
    }

    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;

    if (!apiKey || !audienceId) {
      console.error("Missing RESEND_API_KEY or RESEND_AUDIENCE_ID");
      return res.status(500).end(JSON.stringify({ error: "Configuração incompleta no servidor." }));
    }

    const resend = new Resend(apiKey);

    const { data, error } = await resend.contacts.create({
      audienceId,
      email: email.toLowerCase(),
      unsubscribed: false,
    });

    if (error) {
      console.error("Resend error:", JSON.stringify(error));
      return res.status(500).end(JSON.stringify({ error: "Não foi possível concluir a inscrição. Tente novamente." }));
    }

    return res.status(200).end(JSON.stringify({ success: true, id: data?.id ?? null }));
  } catch (err) {
    console.error("Unhandled error in subscribe handler:", err.message, err.stack);
    return res.status(500).end(JSON.stringify({ error: "Erro interno. Tente novamente." }));
  }
};

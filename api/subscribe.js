/**
 * api/subscribe.js — Vercel serverless function
 * POST { email } → adds contact to Resend Audience via raw fetch (no SDK)
 */

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body ?? {};

    console.log("subscribe body:", JSON.stringify(req.body));

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Email inválido." });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;

    if (!apiKey || !audienceId) {
      console.error("Missing env vars — RESEND_API_KEY or RESEND_AUDIENCE_ID not set");
      return res.status(500).json({ error: "Configuração incompleta no servidor." });
    }

    const response = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), unsubscribed: false }),
      }
    );

    const data = await response.json();
    console.log("Resend response:", response.status, JSON.stringify(data));

    if (!response.ok) {
      console.error("Resend error:", response.status, JSON.stringify(data));
      return res.status(500).json({ error: "Não foi possível concluir a inscrição. Tente novamente." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Subscribe handler error:", err.message, err.stack);
    return res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}

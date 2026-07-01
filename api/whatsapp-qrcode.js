const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";

function getEvolutionConfig(req) {
  return {
    baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.host || "minha-ia-orquestrador.vercel.app"}`,
  };
}

async function evolutionFetch(path, init = {}) {
  const baseUrl = (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) throw new Error("EVOLUTION_API_KEY não configurada.");

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Evolution API respondeu ${response.status}.`);
  }
  return payload;
}

function findQrData(payload) {
  return (
    payload?.base64 ||
    payload?.qrcode?.base64 ||
    payload?.qrCode?.base64 ||
    payload?.qrcode ||
    payload?.qrCode ||
    payload?.code ||
    payload?.data?.base64 ||
    payload?.data?.code ||
    ""
  );
}

function asImageSource(qrData) {
  const value = String(qrData || "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 500) return `data:image/png;base64,${value}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(value)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wantsJson(req) {
  return req.query?.format === "json" || String(req.headers.accept || "").includes("application/json");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  const config = getEvolutionConfig(req);

  try {
    const payload = await evolutionFetch(`/instance/connect/${encodeURIComponent(config.instance)}`);
    const qrData = findQrData(payload);
    const imageSource = asImageSource(qrData);
    const pairingCode = payload?.pairingCode || payload?.data?.pairingCode || "";

    if (wantsJson(req)) {
      return res.status(200).json({
        ok: true,
        instance: config.instance,
        connected: !qrData && !pairingCode,
        pairingCode,
        imageSource,
        raw: payload,
      });
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="20" />
  <title>WhatsApp QR Code - Minha IA</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #fff; color: #09090b; padding: 24px; }
    main { width: min(100%, 520px); border: 1px solid #e4e4e7; border-radius: 20px; padding: 24px; box-shadow: 0 18px 60px rgba(0,0,0,.08); text-align: center; }
    h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
    p { color: #52525b; line-height: 1.55; }
    img { width: min(320px, 86vw); height: min(320px, 86vw); object-fit: contain; margin: 18px auto; display: block; border-radius: 12px; border: 1px solid #f4f4f5; }
    code { background: #f4f4f5; border-radius: 8px; padding: 6px 10px; color: #18181b; font-weight: 700; }
    a { color: #18181b; font-weight: 700; }
    .status { margin-top: 16px; font-size: 13px; color: #71717a; }
  </style>
</head>
<body>
  <main>
    <h1>Conectar WhatsApp</h1>
    <p>Abra o WhatsApp no celular, toque em <b>Aparelhos conectados</b> e escaneie o QR Code abaixo.</p>
    ${
      imageSource
        ? `<img alt="QR Code do WhatsApp" src="${escapeHtml(imageSource)}" />`
        : `<p><b>Nenhum QR Code ativo agora.</b><br />A instancia pode já estár conectada ou aguardando reinicio.</p>`
    }
    ${pairingCode ? `<p>Codigo de páreamento: <code>${escapeHtml(pairingCode)}</code></p>` : ""}
    <p class="status">Instância: <b>${escapeHtml(config.instance)}</b>. Esta página atualiza automaticamente a cada 20 segundos.</p>
    <p class="status"><a href="${escapeHtml(config.appUrl)}/api/whatsapp-qrcode">Atualizar agora</a></p>
  </main>
</body>
</html>`);
  } catch (error) {
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, instance: config.instance, error: error.message });
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(`<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1" /><body style="font-family:system-ui;padding:24px"><h1>Não consegui gerar o QR Code</h1><p>${escapeHtml(error.message)}</p></body></html>`);
  }
}

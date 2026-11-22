// Penerima webhook GGAPI (topup.success). Publik, diamankan dengan signature HMAC-SHA256.
import crypto from "node:crypto";
import { rcmd, storeReady } from "./_lib/store.mjs";
import { getWebhookSecret } from "./_lib/ggapi.mjs";

export const config = { api: { bodyParser: false } };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const idr = (n) => new Intl.NumberFormat("id-ID").format(Number(n) || 0);

async function notifyAdmins(text) {
  if (!BOT_TOKEN) return;
  await Promise.all(ADMINS.map((id) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text }),
    }).catch(() => {})
  ));
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).end();

  const secret = await getWebhookSecret();
  if (!secret) return response.status(503).json({ message: "Webhook secret belum disimpan di server." });

  const raw = await readRaw(request);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = String(request.headers["x-ggapi-signature"] || "");
  const ok = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return response.status(401).end();

  let p;
  try { p = JSON.parse(raw.toString("utf8")); } catch { return response.status(400).end(); }
  if (p.event !== "topup.success" || !p.order_id) return response.status(200).json({ ok: true });

  // Idempoten: order yang sudah diproses cukup dibalas 200.
  let first = true;
  if (storeReady()) {
    try { first = (await rcmd(["SET", `topup:done:${p.order_id}`, "1", "NX", "EX", 2592000])) === "OK"; } catch {}
  }
  if (first) {
    await notifyAdmins(
      `✅ Top up GGAPI berhasil\nOrder: ${p.order_id}\nPoin masuk: +${idr(p.points)}\nBayar: Rp ${idr(p.amount_idr)}\nSaldo sekarang: ${idr(p.balance_points)} points`
    );
  }
  return response.status(200).json({ ok: true });
}

// Klien API resmi GGAPI (server-side saja; API key tidak pernah dikirim ke browser).
import { rcmd, storeReady } from "./store.mjs";

const BASE = "https://use.ggapi.co.id";
const SECRET_KEY = "ggapi:webhook_secret";

export async function gg(path, { method = "GET", body } = {}) {
  const key = process.env.GGAPI_API_KEY;
  if (!key) return { status: 500, ok: false, data: { error: "GGAPI_API_KEY belum dikonfigurasi di server." } };
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "application/json",
        "x-ggapi-co-id": key,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch {
    return { status: 502, ok: false, data: { error: "Tidak dapat terhubung ke GGAPI." } };
  }
}

export async function getWebhookSecret() {
  if (process.env.GGAPI_WEBHOOK_SECRET) return process.env.GGAPI_WEBHOOK_SECRET;
  if (!storeReady()) return "";
  try { return (await rcmd(["GET", SECRET_KEY])) || ""; } catch { return ""; }
}

export async function saveWebhookSecret(secret) {
  if (!storeReady()) throw new Error("Storage belum dikonfigurasi.");
  await rcmd(["SET", SECRET_KEY, secret]);
}

export const ORDER_RE = /^TOPUP-[A-Za-z0-9_-]{6,80}$/;

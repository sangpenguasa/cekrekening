import { getConfig, isClosed } from "./_lib/store.mjs";
import { isAuthenticated } from "./_lib/auth.mjs";
import { gg } from "./_lib/ggapi.mjs";

let cache = { t: 0, out: null };

const BAL_KEYS = /^(balance_points|balance|points|saldo)$/i;
function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
// Toleran terhadap bentuk respons: {balance_points}, {data:{balance_points}}, dst.
function findBalance(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 3) return null;
  for (const [k, v] of Object.entries(o)) {
    if (BAL_KEYS.test(k)) { const n = toNum(v); if (n !== null) return n; }
  }
  for (const v of Object.values(o)) {
    const n = findBalance(v, depth + 1);
    if (n !== null) return n;
  }
  return null;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "GET") return response.status(405).json({ message: "Method tidak diizinkan." });
  if (isClosed(await getConfig())) return response.status(503).json({ message: "This Site Has Been Closed Thanks" });
  if (!(await isAuthenticated(request)).ok) return response.status(401).json({ code: "AUTH", message: "Sesi berakhir. Silakan login ulang." });

  if (!process.env.GGAPI_API_KEY) {
    return response.status(200).json({ balance: null, lowBalance: false, error: "no_key" });
  }
  if (cache.out && Date.now() - cache.t < 10000) return response.status(200).json(cache.out);

  const r = await gg("/v1/me");
  const points = r.ok ? findBalance(r.data) : null;
  if (points === null) {
    console.error("[balance] /v1/me gagal. HTTP", r.status, "keys:", r.data && typeof r.data === "object" ? Object.keys(r.data).join(",") : "-");
    const detail = r.status === 401 ? "" : r.ok ? "Format respons tidak dikenal." : `Server membalas HTTP ${r.status}.`;
    return response.status(200).json({ balance: null, lowBalance: false, error: r.status === 401 ? "api_key" : "unavailable", detail });
  }
  const low = Number(process.env.LOW_BALANCE_POINTS || 0);
  const out = {
    balance: process.env.SHOW_BALANCE === "0" ? null : points,
    plan: r.data?.plan || r.data?.data?.plan || null,
    lowBalance: points <= low,
    error: null,
  };
  cache = { t: Date.now(), out };
  return response.status(200).json(out);
}

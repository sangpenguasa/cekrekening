import { getConfig, isClosed, rateLimit } from "./_lib/store.mjs";
import { isAuthenticated, clientIp } from "./_lib/auth.mjs";
import { gg } from "./_lib/ggapi.mjs";

const MIN = 10000;
const MAX = 5000000;

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ message: "Method tidak diizinkan." });
  if (isClosed(await getConfig())) return response.status(503).json({ message: "This Site Has Been Closed Thanks" });
  if (!(await isAuthenticated(request)).ok) return response.status(401).json({ code: "AUTH", message: "Sesi berakhir. Silakan login ulang." });
  if (!(await rateLimit(`topup:${clientIp(request)}`, 6, 60))) {
    return response.status(429).json({ message: "Terlalu banyak permintaan. Coba lagi sebentar." });
  }

  let input = request.body ?? {};
  if (typeof input === "string") { try { input = JSON.parse(input || "{}"); } catch { input = {}; } }
  const amount = Number(input?.amount);
  if (!Number.isInteger(amount) || amount < MIN || amount > MAX) {
    return response.status(400).json({ message: `Nominal harus ${MIN.toLocaleString("id-ID")} - ${MAX.toLocaleString("id-ID")}.` });
  }

  const r = await gg("/v1/topup", { method: "POST", body: { amount_idr: amount } });
  if (!r.ok) {
    const msg =
      r.status === 400 ? "Nominal ditolak atau profil akun belum lengkap (nomor HP)."
      : r.status === 401 ? "API key tidak valid / tidak aktif."
      : r.status === 500 || r.status === 502 ? "Top up belum tersedia saat ini. Coba lagi nanti."
      : `Gagal membuat top up (HTTP ${r.status}).`;
    return response.status(r.status === 401 ? 502 : r.status >= 500 ? 502 : 400).json({ message: msg });
  }
  const d = r.data || {};
  if (!d.order_id || typeof d.payment_url !== "string" || !/^https:\/\//.test(d.payment_url)) {
    return response.status(502).json({ message: "Respons top up tidak lengkap." });
  }
  return response.status(200).json({
    order_id: d.order_id,
    payment_url: d.payment_url,
    amount_idr: d.amount_idr ?? amount,
    fee_idr: d.fee_idr ?? 0,
    total_idr: d.total_idr ?? amount,
    points: d.points ?? amount,
  });
}

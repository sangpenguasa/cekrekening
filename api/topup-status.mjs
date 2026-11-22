import { getConfig, isClosed, rateLimit } from "./_lib/store.mjs";
import { isAuthenticated, clientIp } from "./_lib/auth.mjs";
import { gg, ORDER_RE } from "./_lib/ggapi.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "GET") return response.status(405).json({ message: "Method tidak diizinkan." });
  if (isClosed(await getConfig())) return response.status(503).json({ message: "This Site Has Been Closed Thanks" });
  if (!(await isAuthenticated(request)).ok) return response.status(401).json({ code: "AUTH", message: "Sesi berakhir. Silakan login ulang." });
  if (!(await rateLimit(`tstat:${clientIp(request)}`, 40, 60))) {
    return response.status(429).json({ message: "Terlalu banyak permintaan." });
  }

  const id = String(request.query?.order_id || "");
  if (!ORDER_RE.test(id)) return response.status(400).json({ message: "order_id tidak valid." });

  // Endpoint GGAPI ini sekaligus merekonsiliasi pembayaran yang webhook-nya terlewat.
  const r = await gg(`/v1/topup/${encodeURIComponent(id)}`);
  if (!r.ok) return response.status(r.status === 404 ? 404 : 502).json({ message: "Status belum bisa dibaca." });
  const d = r.data || {};
  return response.status(200).json({ order_id: d.order_id || id, status: d.status || "PENDING", points: d.points ?? null, amount: d.amount ?? null });
}

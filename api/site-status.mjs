import { getConfig, isClosed } from "./_lib/store.mjs";

// Respons di-cache singkat di CDN Vercel supaya ribuan polling tidak membebani Redis.
const TTL = Math.max(0, Number(process.env.STATUS_CACHE_SEC ?? 3));

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ message: "Method tidak diizinkan." });
  const c = await getConfig();
  const now = Date.now();
  response.setHeader(
    "Cache-Control",
    TTL > 0 ? `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=${TTL * 2}` : "no-store, max-age=0"
  );
  return response.status(200).json({
    now, closeAt: c.closeAt, message: c.message, msgId: c.msgId, level: c.msgLevel, closeMsg: c.closeMsg, closed: isClosed(c, now),
  });
}

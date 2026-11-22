import {
  getAuthConfig, checkPassword, createSessionToken, setSessionCookie, isAuthenticated, clientIp,
} from "./_lib/auth.mjs";
import { rcmd } from "./_lib/store.mjs";

const MAX_ATTEMPTS = 8;      // percobaan salah per IP
const WINDOW_SEC = 15 * 60;  // jendela pembatasan

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  // Status sesi (dipakai halaman login & aplikasi)
  if (req.method === "GET") {
    const a = await isAuthenticated(req);
    return res.status(200).json({
      authenticated: a.ok,
      loginEnabled: a.cfg.enabled,
      passwordSet: a.cfg.passwordSet,
      storage: a.cfg.ready,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ message: "Method tidak diizinkan." });

  let input = req.body ?? {};
  if (typeof input === "string") { try { input = JSON.parse(input || "{}"); } catch { input = {}; } }
  const password = String(input.password ?? "");
  const remember = Boolean(input.remember);

  const cfg = await getAuthConfig();
  if (!cfg.ready) return res.status(503).json({ message: "Storage belum dikonfigurasi di server." });
  if (!cfg.enabled) return res.status(200).json({ ok: true, open: true });
  if (!cfg.passwordSet) {
    return res.status(503).json({ code: "NOPASS", message: "Password belum diatur. Kirim /setpass PASSWORD ke bot Telegram." });
  }
  if (!password || password.length > 128) return res.status(400).json({ message: "Masukkan password." });

  // Pembatasan percobaan per IP
  const rlKey = `auth:rl:${clientIp(req)}`;
  try {
    const n = await rcmd(["INCR", rlKey]);
    if (n === 1) await rcmd(["EXPIRE", rlKey, WINDOW_SEC]);
    if (n > MAX_ATTEMPTS) {
      const ttl = Math.max(1, Number(await rcmd(["TTL", rlKey])) || WINDOW_SEC);
      res.setHeader("Retry-After", String(ttl));
      return res.status(429).json({ message: "Terlalu banyak percobaan. Coba lagi nanti.", retryAfter: ttl });
    }
    if (!checkPassword(password, cfg)) {
      await sleep(600);
      return res.status(401).json({ message: "Password salah.", attemptsLeft: Math.max(0, MAX_ATTEMPTS - n) });
    }
    await rcmd(["DEL", rlKey]).catch(() => {});
  } catch {
    return res.status(503).json({ message: "Server sibuk, coba lagi." });
  }

  const ttl = remember ? 30 * 86400 : 12 * 3600;
  const token = await createSessionToken(cfg.version, ttl);
  setSessionCookie(req, res, token, remember ? ttl : null);
  return res.status(200).json({ ok: true });
}

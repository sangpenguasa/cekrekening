// Notifikasi Telegram ke admin (dipakai untuk peringatan operasional).
import { rcmd, storeReady } from "./store.mjs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

export async function notifyAdmins(text) {
  if (!BOT_TOKEN || !ADMINS.length) return;
  await Promise.all(ADMINS.map((id) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text }),
    }).catch(() => {})
  ));
}

// Kirim sekali saja dalam jendela waktu tertentu (anti-spam).
export async function notifyOnce(key, ttlSec, text) {
  if (!BOT_TOKEN || !ADMINS.length) return;
  let first = true;
  if (storeReady()) {
    try { first = (await rcmd(["SET", `notify:${key}`, "1", "NX", "EX", ttlSec], { tries: 1, timeoutMs: 2000 })) === "OK"; } catch { /* tetap kirim */ }
  }
  if (first) await notifyAdmins(text);
}

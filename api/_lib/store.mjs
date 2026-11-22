// Penyimpanan konfigurasi situs (Upstash Redis / Vercel KV via REST, tanpa dependensi).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "site:config";

export const storeReady = () => Boolean(URL_ && TOKEN);

// Jalankan satu perintah Redis, contoh: rcmd(["GET", "key"]).
// Otomatis mencoba ulang saat timeout / gangguan sesaat di Upstash.
const TRANSIENT = /timeout|timed out|etimedout|econnreset|econnrefused|socket|temporar|unavailable|overload|try again/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rcmd(command, { tries = 2, timeoutMs = 4000 } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(URL_, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) return data.result;
      const err = new Error(data.error || `Redis HTTP ${res.status}`);
      err.transient = res.status >= 500 || res.status === 429 || TRANSIENT.test(err.message);
      throw err;
    } catch (e) {
      lastErr = e;
      const transient = e.transient || e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError" || TRANSIENT.test(String(e.message));
      if (!transient || i === tries) break;
      await sleep(250 * i);
    }
  }
  throw lastErr;
}
const redis = rcmd;

const DEFAULT = { closeAt: null, message: "", msgId: 0, msgLevel: "info", closeMsg: "" };

function parseConfig(raw) {
  if (!raw) return { ...DEFAULT };
  const c = JSON.parse(raw);
  return {
    closeAt: Number.isFinite(c.closeAt) ? c.closeAt : null,
    message: typeof c.message === "string" ? c.message : "",
    closeMsg: typeof c.closeMsg === "string" ? c.closeMsg : "",
    msgId: Number.isFinite(c.msgId) ? c.msgId : 0,
    msgLevel: ["info", "warn", "urgent"].includes(c.msgLevel) ? c.msgLevel : "info",
  };
}

export async function getConfig() {
  if (!storeReady()) return { ...DEFAULT };
  try {
    return parseConfig(await redis(["GET", KEY], { tries: 2, timeoutMs: 3000 }));
  } catch {
    return { ...DEFAULT }; // fail-open: gangguan storage tidak menutup situs
  }
}

export async function setConfig(patch) {
  if (!storeReady()) throw new Error("Storage belum dikonfigurasi (KV_REST_API_URL / KV_REST_API_TOKEN).");
  // Baca STRICT: bila gagal, lempar error (jangan menimpa konfigurasi lama dengan nilai default).
  const current = parseConfig(await redis(["GET", KEY], { tries: 3, timeoutMs: 3500 }));
  const next = { ...current, ...patch };
  await redis(["SET", KEY, JSON.stringify(next)], { tries: 3, timeoutMs: 3500 });
  return next;
}

export const isClosed = (c, now = Date.now()) => c.closeAt !== null && now >= c.closeAt;

// Pembatas request sederhana per kunci (fail-open bila Redis bermasalah).
export async function rateLimit(key, limit, windowSec) {
  if (!storeReady()) return true;
  try {
    const n = await rcmd(["INCR", `rl:${key}`]);
    if (n === 1) await rcmd(["EXPIRE", `rl:${key}`, windowSec]);
    return n <= limit;
  } catch {
    return true;
  }
}

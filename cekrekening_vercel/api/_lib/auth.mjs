// Autentikasi: password disimpan (hash scrypt) di Redis, diubah lewat bot Telegram.
// Sesi = cookie HttpOnly bertanda tangan HMAC. Mengubah password / /kickall menaikkan
// "version" sehingga semua sesi lama otomatis tidak berlaku.
import crypto from "node:crypto";
import { rcmd, storeReady } from "./store.mjs";

const CFG_KEY = "auth:config";
const SECRET_KEY = "auth:secret";
export const COOKIE = "mg_session";
const SCRYPT = { N: 16384, r: 8, p: 1 };
let secretCache = null;

export function hashPassword(pw, saltHex = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(pw).normalize("NFKC"), Buffer.from(saltHex, "hex"), 32, SCRYPT).toString("hex");
  return { salt: saltHex, hash };
}

export function checkPassword(pw, cfg) {
  if (!cfg?.hash || !cfg?.salt) return false;
  const a = Buffer.from(hashPassword(pw, cfg.salt).hash, "hex");
  const b = Buffer.from(cfg.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// { ready, passwordSet, enabled, version, salt, hash }
export async function getAuthConfig() {
  if (!storeReady()) return { ready: false, passwordSet: false, enabled: true, version: 1 };
  try {
    const raw = await rcmd(["GET", CFG_KEY]);
    const c = raw ? JSON.parse(raw) : {};
    return {
      ready: true,
      passwordSet: Boolean(c.hash && c.salt),
      enabled: c.enabled !== false,
      version: Number.isInteger(c.version) ? c.version : 1,
      salt: c.salt || "",
      hash: c.hash || "",
    };
  } catch {
    return { ready: false, passwordSet: false, enabled: true, version: 1 };
  }
}

async function saveAuthConfig(patch) {
  if (!storeReady()) throw new Error("Storage belum dikonfigurasi (KV_REST_API_URL / KV_REST_API_TOKEN).");
  const cur = await getAuthConfig();
  if (!cur.ready) throw new Error("Storage tidak dapat dibaca, coba lagi.");
  const next = {
    hash: cur.hash, salt: cur.salt, enabled: cur.enabled, version: cur.version,
    ...patch, updatedAt: Date.now(),
  };
  await rcmd(["SET", CFG_KEY, JSON.stringify(next)]);
  return next;
}

export async function setPassword(pw) {
  const cur = await getAuthConfig();
  const { salt, hash } = hashPassword(pw);
  await saveAuthConfig({ salt, hash, version: cur.version + 1 }); // logout semua sesi lama
}
export async function setLoginEnabled(enabled) { await saveAuthConfig({ enabled: Boolean(enabled) }); }
export async function kickAll() { const cur = await getAuthConfig(); await saveAuthConfig({ version: cur.version + 1 }); }

async function getSecret() {
  if (secretCache) return secretCache;
  let s = await rcmd(["GET", SECRET_KEY]);
  if (!s) {
    await rcmd(["SET", SECRET_KEY, crypto.randomBytes(32).toString("hex"), "NX"]);
    s = await rcmd(["GET", SECRET_KEY]);
  }
  return (secretCache = s);
}

const sign = (payload, secret) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export async function createSessionToken(version, ttlSec) {
  const payload = Buffer.from(JSON.stringify({ v: version, exp: Date.now() + ttlSec * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, await getSecret())}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Mengembalikan { ok, reason?, cfg }
export async function isAuthenticated(req) {
  const cfg = await getAuthConfig();
  if (!cfg.ready) return { ok: false, reason: "storage", cfg };
  if (!cfg.enabled) return { ok: true, open: true, cfg }; // login dimatikan via /loginoff
  if (!cfg.passwordSet) return { ok: false, reason: "nopass", cfg };
  const token = parseCookies(req)[COOKIE];
  if (!token || !token.includes(".")) return { ok: false, reason: "nologin", cfg };
  try {
    const [payload, sig] = token.split(".");
    const expected = sign(payload, await getSecret());
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad", cfg };
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.v !== cfg.version || !(data.exp > Date.now())) return { ok: false, reason: "expired", cfg };
    return { ok: true, cfg };
  } catch {
    return { ok: false, reason: "bad", cfg };
  }
}

const secureFlag = (req) =>
  req.headers?.["x-forwarded-proto"] === "https" || process.env.VERCEL ? "; Secure" : "";

export function setSessionCookie(req, res, token, maxAgeSec) {
  const age = maxAgeSec ? `; Max-Age=${maxAgeSec}` : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${age}${secureFlag(req)}`);
}
export function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(req)}`);
}

export const clientIp = (req) =>
  String(req.headers?.["x-real-ip"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim();

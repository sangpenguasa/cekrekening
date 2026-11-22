// Penafsir respons validasi rekening + cache server untuk rekening yang sudah VALID.
import { rcmd, storeReady } from "./store.mjs";

const NAME_KEYS = ["account_holder", "account_holder_name", "account_name", "accountName", "holder_name", "holderName", "nama", "name", "owner"];
const BANK_KEYS = ["bank", "bank_name", "bankName"];
const NUM_KEYS = ["account_number", "accountNumber", "number"];

function findString(o, keys, depth = 0) {
  if (!o || typeof o !== "object" || depth > 3) return "";
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") {
      const r = findString(v, keys, depth + 1);
      if (r) return r;
    }
  }
  return "";
}

// Menafsirkan respons penyedia (GGAPI / V2) dengan toleran terhadap bentuk JSON.
export function interpret(body) {
  if (!body || typeof body !== "object") return { valid: false, found: null, name: "", bank: "", number: "", message: "" };
  const d = body.data && typeof body.data === "object" ? body.data : body.result && typeof body.result === "object" ? body.result : body;
  const found = d.found ?? body.found;
  const failed =
    body.success === false || body.status === false || body.status === "false" ||
    body.valid === false || d.valid === false || d.is_valid === false || found === false;
  const name = findString(body, NAME_KEYS);
  return {
    valid: !failed && Boolean(name),
    found: found ?? null,
    name,
    bank: findString(body, BANK_KEYS),
    number: findString(body, NUM_KEYS),
    message: typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "",
  };
}

// ---------- cache ----------
const TTL_DAYS = Number(process.env.CACHE_TTL_DAYS ?? 365); // 0 = tanpa kedaluwarsa
const PREFIX = "acc:";
// Kunci disamakan untuk V1 & V2: e-wallet "DANA" == "dana".
export const cacheKey = (type, code, account) => `${PREFIX}${type}:${String(code).toLowerCase()}:${String(account).trim()}`;

export async function cacheGet(type, code, account) {
  if (!storeReady()) return null;
  try {
    const raw = await rcmd(["GET", cacheKey(type, code, account)], { tries: 2, timeoutMs: 2500 });
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec.name === "string" && rec.name ? rec : null;
  } catch {
    return null; // cache gagal tidak boleh menggagalkan pengecekan
  }
}

export async function cachePut(type, code, account, rec) {
  if (!storeReady() || !rec?.name) return;
  try {
    const cmd = ["SET", cacheKey(type, code, account), JSON.stringify({ name: rec.name, bank: rec.bank || "", at: Date.now() })];
    if (TTL_DAYS > 0) cmd.push("EX", Math.round(TTL_DAYS * 86400));
    await rcmd(cmd, { tries: 2, timeoutMs: 3000 });
  } catch { /* abaikan */ }
}

async function scanAll(onKeys, maxLoops = 300) {
  let cursor = "0", loops = 0, total = 0;
  do {
    const r = await rcmd(["SCAN", cursor, "MATCH", `${PREFIX}*`, "COUNT", "500"], { tries: 2, timeoutMs: 6000 });
    cursor = String(r?.[0] ?? "0");
    const keys = Array.isArray(r?.[1]) ? r[1] : [];
    total += keys.length;
    if (keys.length && onKeys) await onKeys(keys);
  } while (cursor !== "0" && ++loops < maxLoops);
  return total;
}
export const cacheCount = () => scanAll();
export async function cacheClear() {
  return scanAll(async (keys) => { await rcmd(["DEL", ...keys], { tries: 2, timeoutMs: 6000 }); });
}

// Bentuk respons yang dipahami frontend (sama dengan respons API asli).
export function cachedBody(hit, account) {
  return { success: true, found: true, cached: true, cachedAt: hit.at, data: { account_holder: hit.name, bank: hit.bank || undefined, account_number: account, found: true } };
}

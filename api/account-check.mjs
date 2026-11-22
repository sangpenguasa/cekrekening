import { getConfig, isClosed } from "./_lib/store.mjs";
import { isAuthenticated } from "./_lib/auth.mjs";
import { interpret, cacheGet, cachePut, cachedBody } from "./_lib/accounts.mjs";
import { checkV2 } from "./_lib/v2.mjs";
import { notifyOnce } from "./_lib/notify.mjs";

const BASE_URL = "https://use.ggapi.co.id";
const NOT_FOUND = "Rekening tidak ditemukan / tidak valid.";

// Penyedia utama (V1 / GGAPI). kind: valid | notfound | error
async function checkV1(type, code, account) {
  const apiKey = process.env.GGAPI_API_KEY;
  if (!apiKey) return { kind: "error", reason: "API_KEY belum dikonfigurasi di server" };
  const path = type === "ewallet" ? "/api/ewallet-verification/validate" : "/api/bank-verification/validate";
  const url = new URL(path, BASE_URL);
  url.searchParams.set("code", code);
  url.searchParams.set("account_number", account);

  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", "x-ggapi-co-id": apiKey }, signal: AbortSignal.timeout(8000) });
  } catch {
    return { kind: "error", reason: "tidak terhubung / timeout" };
  }
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== "object") return { kind: "error", reason: `HTTP ${res.status}, respons bukan JSON` };
  const v = interpret(body);
  if (res.ok && v.valid) return { kind: "valid", name: v.name, bank: v.bank, number: v.number };
  if (res.ok || [400, 404, 422].includes(res.status)) return { kind: "notfound", reason: v.message };
  return { kind: "error", reason: `HTTP ${res.status}${v.message ? ": " + v.message : ""}` };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ message: "Method tidak diizinkan." });
  if (isClosed(await getConfig())) return response.status(503).json({ message: "This Site Has Been Closed Thanks" });
  if (!(await isAuthenticated(request)).ok) return response.status(401).json({ code: "AUTH", message: "Sesi berakhir. Silakan login ulang." });

  let input = request.body ?? {};
  if (typeof input === "string") {
    try { input = JSON.parse(input || "{}"); } catch { return response.status(400).json({ message: "Body request tidak valid." }); }
  }
  const type = input?.type === "ewallet" ? "ewallet" : "bank";
  const code = String(input?.code ?? "").trim();
  const account = String(input?.accountNumber ?? "").trim();
  if (!code || !/^\d{5,32}$/.test(account)) {
    return response.status(400).json({ message: "Kode dan nomor rekening tidak valid." });
  }

  // 1) Rekening yang sudah pernah VALID diambil dari server (hemat poin). force=true untuk cek ulang.
  if (input?.force !== true) {
    const hit = await cacheGet(type, code, account);
    if (hit) return response.status(200).json({ ...cachedBody(hit, account), source: "cache" });
  }

  // 2) Penyedia utama V1; bila error / tidak ditemukan -> penyedia cadangan V2.
  const alerts = [];
  const t1 = await checkV1(type, code, account);
  let found = t1.kind === "valid" ? t1 : null, source = "v1", t2 = null;
  if (!found) {
    if (t1.kind === "error") alerts.push(["v1err", `⚠️ API V1 (GGAPI) error: ${t1.reason}. Pengecekan dialihkan ke cadangan V2.`]);
    t2 = await checkV2(type, code, account);
    if (t2.kind === "valid") { found = t2; source = "v2"; }
  }

  let status, body;
  if (found) {
    await cachePut(type, code, account, found);
    status = 200;
    body = { success: true, found: true, cached: false, source, data: { account_holder: found.name, bank: found.bank || undefined, account_number: found.number || account, found: true } };
  } else if (t1.kind === "notfound" || t2?.kind === "notfound") {
    status = 200;
    body = { success: true, found: false, cached: false, source: "none", data: { found: false }, message: NOT_FOUND };
  } else {
    status = 502;
    body = { success: false, message: "Layanan cek rekening sedang gangguan. Coba lagi sebentar." };
    alerts.push(["bothfail", `🚨 V1 dan V2 sama-sama gagal. V1: ${t1.reason || t1.kind}. V2: ${t2?.reason || t2?.kind || "-"}.`]);
  }

  response.status(status).json(body);
  for (const [key, text] of alerts) await notifyOnce(key, 600, text); // peringatan ke admin (maks 1x / 10 menit)
}

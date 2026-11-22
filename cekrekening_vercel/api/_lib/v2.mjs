import { interpret } from "./accounts.mjs";

// Penyedia V2 (HTTP biasa, bukan HTTPS). Dipanggil dari server karena browser memblokir http:// dari halaman https://.
const toHttp = (u) => String(u).replace(/^https:\/\//i, "http://");
const EWALLET_BASE = toHttp(process.env.V2_EWALLET_BASE || "http://node.bimxyz.my.id:3128");
const BANK_BASE = toHttp(process.env.V2_BANK_BASE || "http://node.bimxyz.my.id:3143");

// Nilai kode e-wallet persis seperti yang diminta API V2.
export const V2_EWALLETS = { gopay: "GOPAY", dana: "DANA", ovo: "OVO", shopeepay: "ShopeePay", linkaja: "LinkAja" };

export async function queryV2(type, code, account) {
  const url = new URL("/api/validate", type === "ewallet" ? EWALLET_BASE : BANK_BASE);
  url.searchParams.set("code", code);
  url.searchParams.set("account_number", account);
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, ok: res.ok, body, text };
}

// Cek lewat penyedia V2 (cadangan). kind: valid | notfound | error | skip (kode tidak didukung V2).
export async function checkV2(type, code, account) {
  const c = type === "ewallet" ? V2_EWALLETS[String(code).toLowerCase()] : /^\d{3}$/.test(String(code)) ? String(code) : "";
  if (!c) return { kind: "skip" };
  let r;
  try { r = await queryV2(type, c, account); } catch { return { kind: "error", reason: "tidak terhubung" }; }
  if (!r.body) return { kind: "error", reason: `HTTP ${r.status}, respons bukan JSON` };
  const v = interpret(r.body);
  if (v.valid) return { kind: "valid", name: v.name, bank: v.bank, number: v.number };
  if (r.ok || v.found === false || [400, 404, 422].includes(r.status)) return { kind: "notfound", reason: v.message };
  return { kind: "error", reason: `HTTP ${r.status}${v.message ? ": " + v.message : ""}` };
}

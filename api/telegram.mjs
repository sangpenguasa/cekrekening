import crypto from "node:crypto";
import { getConfig, setConfig, isClosed, storeReady, rcmd } from "./_lib/store.mjs";
import { getAuthConfig, setPassword, setLoginEnabled, kickAll } from "./_lib/auth.mjs";
import { gg, getWebhookSecret, saveWebhookSecret } from "./_lib/ggapi.mjs";
import { interpret, cacheCount, cacheClear } from "./_lib/accounts.mjs";
import { queryV2, V2_EWALLETS } from "./_lib/v2.mjs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const WIB = 7 * 3600 * 1000;

const fmt = (ms) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "short",
  }).format(new Date(ms)) + " WIB";

function humanLeft(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(" ");
}

// Parse: "now", "2h", "30m", "1d 3h", "2026-11-01 23:59", "01/11/2026 23:59" (WIB)
function parseTime(input) {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (t === "now" || t === "sekarang") return Date.now();

  const rel = [...t.matchAll(/(\d+)\s*(d|h|j|m)\b/g)];
  if (rel.length && rel.map((r) => r[0]).join("").replace(/\s/g, "") === t.replace(/\s/g, "")) {
    const unit = { d: 86400000, h: 3600000, j: 3600000, m: 60000 };
    return Date.now() + rel.reduce((a, r) => a + Number(r[1]) * unit[r[2]], 0);
  }

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2})[:.](\d{2}))?$/);
  let y, mo, d, H, mi;
  if (m) [, y, mo, d, H = 0, mi = 0] = m;
  else {
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ t](\d{1,2})[:.](\d{2}))?$/);
    if (!m) return null;
    [, d, mo, y, H = 0, mi = 0] = m;
  }
  const ms = Date.UTC(+y, +mo - 1, +d, +H, +mi) - WIB;
  return Number.isFinite(ms) ? ms : null;
}

// Pesan halaman tutup: maks 300 karakter, "\\n" menjadi baris baru.
function cleanCloseMsg(t) {
  return String(t).replace(/\\n/g, "\n").trim().slice(0, 300);
}

async function send(chatId, text) {
  if (!BOT_TOKEN) { console.error("[telegram] TELEGRAM_BOT_TOKEN kosong di project ini"); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!r.ok) console.error("[telegram] sendMessage gagal:", r.status, await r.text().catch(() => ""));
  } catch (e) {
    console.error("[telegram] sendMessage error:", e.message);
  }
}

async function removeMessage(chatId, messageId) {
  if (!BOT_TOKEN || !messageId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  }).catch(() => {});
}

// Password acak 14 karakter (tanpa karakter yang mudah tertukar)
function randomPassword(len = 14) {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += abc[crypto.randomInt(abc.length)];
  return out;
}

const HELP = `Kontrol Website CEK REKENING (waktu = WIB)

LOGIN
/setpass PASSWORD  → ganti password login (6-64 karakter, pesan Anda otomatis dihapus)
/genpass  → buat password acak & langsung dipakai
/loginon  → wajibkan login
/loginoff  → matikan login (situs terbuka tanpa password)
/kickall  → paksa semua pengguna login ulang

WEBSITE
/close 2h  → tutup 2 jam lagi (bisa 30m, 1d, 1d 3h)
/close 2026-11-01 23:59  → tutup pada tanggal & jam tsb
/close now  → tutup sekarang
/close 2h | pesan  → tutup + pesan custom (tanda | memisahkan)
/closemsg teks  → atur pesan di halaman tutup (\\n = baris baru)
/closemsg reset  → kembali ke "This Site Has Been Closed Thanks"
/cancel  → batalkan jadwal / buka kembali situs
/announce teks  → broadcast biasa (biru)\n/announce warn teks  → broadcast perhatian (kuning)\n/announce urgent teks  → broadcast penting (merah)
/clearannounce  → hapus pesan announcement
/status  → lihat status sekarang

TOP UP GGAPI
/saldo  → lihat saldo points GGAPI
/redis  → tes kecepatan database Redis
/cache  → jumlah rekening valid yang tersimpan di server
/clearcache  → hapus semua cache rekening
/testv2 bank 014 1234567890  → tes API cadangan V2 (atau: /testv2 ewallet DANA 0812…)
/setwebhook  → daftarkan webhook top up ke domain ini (otomatis)
/webhookinfo  → lihat webhook yang terdaftar di GGAPI
/testtopup 10000  → buat link top up uji
/myid  → lihat ID Telegram Anda`;

async function statusText() {
  const c = await getConfig();
  const lines = [];
  if (c.closeAt === null) lines.push("Status: BUKA (tidak ada jadwal tutup)");
  else if (isClosed(c)) lines.push(`Status: TUTUP sejak ${fmt(c.closeAt)}`);
  else lines.push(`Status: BUKA\nTutup: ${fmt(c.closeAt)}\nSisa: ${humanLeft(c.closeAt - Date.now())}`);
  lines.push(`Pesan tutup: ${c.closeMsg ? c.closeMsg.replace(/\n/g, " / ") : "(bawaan) This Site Has Been Closed Thanks"}`);
  lines.push(`Announcement: ${c.message || "-"}${c.message ? ` [${c.msgLevel}]` : ""}`);
  const a = await getAuthConfig();
  lines.push(`Login: ${a.enabled ? "AKTIF" : "NONAKTIF"} | Password: ${a.passwordSet ? "sudah diatur" : "BELUM diatur (kirim /setpass)"}`);
  lines.push(`Webhook GGAPI: secret ${(await getWebhookSecret()) ? "tersimpan" : "BELUM ada (kirim /setwebhook)"}`);
  return lines.join("\n");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    // Diagnosis (hanya true/false, tanpa membuka nilai rahasia)
    const info = {
      ok: true,
      env: {
        TELEGRAM_BOT_TOKEN: Boolean(BOT_TOKEN),
        TELEGRAM_ADMIN_IDS: ADMINS.length,
        TELEGRAM_WEBHOOK_SECRET: Boolean(SECRET),
        REDIS_STORAGE: storeReady(),
      },
      botToken: "belum diisi",
    };
    if (BOT_TOKEN) {
      try {
        const me = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)).json();
        info.botToken = me.ok ? `VALID (@${me.result.username})` : `DITOLAK Telegram: ${me.description}`;
      } catch { info.botToken = "tidak bisa menghubungi Telegram"; }
    }
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(info);
  }
  if (SECRET && request.headers["x-telegram-bot-api-secret-token"] !== SECRET) {
    return response.status(401).json({ ok: false });
  }

  let update = request.body ?? {};
  if (typeof update === "string") { try { update = JSON.parse(update); } catch { update = {}; } }
  const msg = update.message || update.edited_message;
  const text = (msg?.text || "").trim();
  if (!msg || !text.startsWith("/")) return response.status(200).json({ ok: true });

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? "");
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const arg = text.slice(rawCmd.length).trim();

  if (cmd === "/myid") { await send(chatId, `ID Anda: ${userId}`); return response.status(200).json({ ok: true }); }

  if (!ADMINS.length || !ADMINS.includes(userId)) {
    await send(chatId, ADMINS.length
      ? "Akses ditolak."
      : `TELEGRAM_ADMIN_IDS belum diisi di Vercel. Isi dengan ID Anda: ${userId}`);
    return response.status(200).json({ ok: true });
  }

  try {
    if (cmd === "/start" || cmd === "/help") {
      await send(chatId, HELP);
    } else if (cmd === "/setpass") {
      await removeMessage(chatId, msg.message_id); // hapus pesan berisi password
      if (!arg) await send(chatId, "Contoh: /setpass PasswordBaru123");
      else if (arg.length < 6 || arg.length > 64) await send(chatId, "Password harus 6-64 karakter.");
      else {
        await setPassword(arg);
        await send(chatId, "Password login diperbarui. Semua sesi lama otomatis keluar.\n(Pesan Anda berisi password sudah dihapus dari chat.)");
      }
    } else if (cmd === "/genpass") {
      const pw = randomPassword();
      await setPassword(pw);
      await send(chatId, `Password baru:\n${pw}\n\nSimpan, lalu hapus pesan ini. Semua sesi lama otomatis keluar.`);
    } else if (cmd === "/loginon") {
      await setLoginEnabled(true);
      await send(chatId, `Login diaktifkan.\n${await statusText()}`);
    } else if (cmd === "/loginoff") {
      await setLoginEnabled(false);
      await send(chatId, `Login dimatikan, situs terbuka tanpa password.\n${await statusText()}`);
    } else if (cmd === "/kickall") {
      await kickAll();
      await send(chatId, "Semua sesi login dibatalkan. Pengguna harus login ulang.");
    } else if (cmd === "/status") {
      await send(chatId, await statusText());
    } else if (cmd === "/close") {
      const bar = arg.indexOf("|");
      const timePart = bar >= 0 ? arg.slice(0, bar) : arg;
      const msgPart = bar >= 0 ? cleanCloseMsg(arg.slice(bar + 1)) : null;
      const when = parseTime(timePart);
      if (when === null) await send(chatId, "Format waktu salah.\nContoh: /close 2h  atau  /close 2026-11-01 23:59 | Maintenance sampai besok");
      else {
        await setConfig(msgPart === null || msgPart === "" ? { closeAt: when } : { closeAt: when, closeMsg: msgPart });
        await send(chatId, `Jadwal tutup disimpan.\n${await statusText()}`);
      }
    } else if (cmd === "/closemsg") {
      if (!arg) await send(chatId, "Contoh:\n/closemsg Sedang maintenance, kembali pukul 20.00 WIB\n/closemsg reset  (kembali ke teks bawaan)");
      else if (/^reset$/i.test(arg)) { await setConfig({ closeMsg: "" }); await send(chatId, `Pesan tutup dikembalikan ke bawaan.\n${await statusText()}`); }
      else { await setConfig({ closeMsg: cleanCloseMsg(arg) }); await send(chatId, `Pesan halaman tutup disimpan.\n${await statusText()}`); }
    } else if (cmd === "/cancel" || cmd === "/open") {
      await setConfig({ closeAt: null });
      await send(chatId, `Jadwal tutup dihapus, situs dibuka.\n${await statusText()}`);
    } else if (cmd === "/announce") {
      const m = arg.match(/^(info|warn|urgent)\s+([\s\S]+)$/i);
      const level = m ? m[1].toLowerCase() : "info";
      const text = (m ? m[2] : arg).trim().slice(0, 300);
      if (!text || /^(info|warn|urgent)$/i.test(text)) await send(chatId, "Contoh:\n/announce Maintenance malam ini\n/announce warn Server sedang lambat\n/announce urgent Website tutup 10 menit lagi");
      else {
        await setConfig({ message: text, msgLevel: level, msgId: Date.now() });
        await send(chatId, `Broadcast terkirim (${level}). Muncul realtime di semua tab yang terbuka.\n${await statusText()}`);
      }
    } else if (cmd === "/clearannounce") {
      await setConfig({ message: "" });
      await send(chatId, `Announcement dihapus.\n${await statusText()}`);
    } else if (cmd === "/cache") {
      await send(chatId, `Cache rekening valid: ${new Intl.NumberFormat("id-ID").format(await cacheCount())} data tersimpan di server.`);
    } else if (cmd === "/clearcache") {
      const n = await cacheClear();
      await send(chatId, `Cache rekening dihapus (${n} data). Pengecekan berikutnya akan memanggil penyedia lagi.`);
    } else if (cmd === "/testv2") {
      const [t, c, a] = arg.split(/\s+/);
      const type = /^e/i.test(t || "") ? "ewallet" : "bank";
      const code = type === "ewallet" ? V2_EWALLETS[String(c || "").toLowerCase()] : c;
      if (!t || !code || !/^\d{5,32}$/.test(a || "")) await send(chatId, "Contoh:\n/testv2 bank 014 1234567890\n/testv2 ewallet DANA 08123456789");
      else {
        const r = await queryV2(type, code, a);
        const v = interpret(r.body);
        await send(chatId, `HTTP ${r.status}\nTerbaca: ${v.name || "-"} (valid=${v.valid})\n\n${String(r.text).slice(0, 600)}`);
      }
    } else if (cmd === "/redis") {
      const times = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        try { await rcmd(["PING"], { tries: 1, timeoutMs: 6000 }); times.push(`${Date.now() - t0} ms`); }
        catch (e) { times.push(`gagal (${String(e.message).slice(0, 40)})`); }
      }
      await send(chatId, `Tes Redis (PING x3): ${times.join(" | ")}\n< 300 ms normal. Jika > 1000 ms atau gagal, samakan region fungsi Vercel dengan region database Upstash.`);
    } else if (cmd === "/saldo") {
      if (!process.env.GGAPI_API_KEY) { await send(chatId, "GGAPI_API_KEY belum diisi di Vercel project ini (Production). Isi lalu Redeploy."); }
      else {
        const r = await gg("/v1/me");
        const d = r.data && typeof r.data === "object" ? r.data : {};
        const bal = d.balance_points ?? d.data?.balance_points ?? d.balance ?? d.points;
        if (r.ok && bal !== undefined) await send(chatId, `Saldo GGAPI: ${new Intl.NumberFormat("id-ID").format(Number(bal))} points (plan ${d.plan || d.data?.plan || "-"})`);
        else await send(chatId, `Diagnosa /v1/me\nHTTP ${r.status}\nKey respons: ${Object.keys(d).join(", ") || "-"}\n${JSON.stringify(d).slice(0, 350)}`);
      }
    } else if (cmd === "/setwebhook") {
      const url = arg || `https://${request.headers.host}/api/ggapi-webhook`;
      if (!/^https:\/\/\S+$/.test(url)) { await send(chatId, "URL harus diawali https://"); }
      else {
        const have = Boolean(await getWebhookSecret());
        let r = await gg("/v1/webhook", { method: "PUT", body: have ? { url } : { url, rotate_secret: true } });
        if (r.ok && !r.data?.secret && !have) r = await gg("/v1/webhook", { method: "PUT", body: { url, rotate_secret: true } });
        if (!r.ok) await send(chatId, `Gagal mendaftarkan webhook (HTTP ${r.status}): ${r.data?.error || ""}`);
        else {
          if (r.data?.secret) await saveWebhookSecret(r.data.secret);
          const saved = Boolean(await getWebhookSecret());
          await send(chatId, `Webhook terdaftar:\n${r.data?.url || url}\nSecret ${saved ? "tersimpan di server" : "TIDAK diterima dari GGAPI — kirim /setwebhook lagi"}.`);
        }
      }
    } else if (cmd === "/webhookinfo") {
      const r = await gg("/v1/webhook");
      await send(chatId, r.ok ? `URL: ${r.data?.url || "-"}\nEvent: ${r.data?.event || "-"}\nSecret di server: ${(await getWebhookSecret()) ? "ada" : "belum"}` : `Gagal (HTTP ${r.status})`);
    } else if (cmd === "/testtopup") {
      const amount = Number(arg || 10000);
      const r = await gg("/v1/topup", { method: "POST", body: { amount_idr: amount } });
      await send(chatId, r.ok ? `Order: ${r.data.order_id}\nTotal bayar: Rp ${new Intl.NumberFormat("id-ID").format(r.data.total_idr)}\nLink: ${r.data.payment_url}` : `Gagal (HTTP ${r.status}): ${r.data?.error || r.data?.message || ""}`);
    } else {
      await send(chatId, HELP);
    }
  } catch (e) {
    const msg = String(e.message || e);
    await send(chatId, /redis|timeout|timed out/i.test(msg)
      ? "Database (Redis) sedang lambat / timeout, perubahan BELUM tersimpan. Coba kirim ulang perintahnya. Jika terus berulang, kirim /redis untuk cek kecepatan."
      : `Error: ${msg}`);
  }
  return response.status(200).json({ ok: true });
}

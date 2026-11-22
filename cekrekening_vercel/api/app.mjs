// Menyajikan aplikasi (private/app.html) hanya jika sesi login valid.
import fs from "node:fs";
import path from "node:path";
import { isAuthenticated } from "./_lib/auth.mjs";

let html = null;
function loadHtml() {
  if (html) return html;
  const candidates = [
    path.join(process.cwd(), "private", "app.html"),
    new URL("../private/app.html", import.meta.url),
  ];
  for (const p of candidates) {
    try { return (html = fs.readFileSync(p, "utf8")); } catch { /* coba berikutnya */ }
  }
  throw new Error("private/app.html tidak ditemukan");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const auth = await isAuthenticated(req);
  if (!auth.ok) {
    res.setHeader("Location", "/login");
    return res.status(302).end();
  }
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(loadHtml());
  } catch (e) {
    return res.status(500).send("Aplikasi tidak dapat dimuat: " + e.message);
  }
}

import { clearSessionCookie } from "./_lib/auth.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  clearSessionCookie(req, res);
  if (req.method === "GET") {
    res.setHeader("Location", "/login");
    return res.status(302).end();
  }
  return res.status(200).json({ ok: true });
}

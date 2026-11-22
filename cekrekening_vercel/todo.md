# Project TODO

- [x] Ganti request HTML BANK ke endpoint GGAPI `/api/bank-verification/validate`
- [x] Ganti request HTML E-WALLET ke endpoint GGAPI `/api/ewallet-verification/validate`
- [x] Gunakan header `x-ggapi-co-id` melalui server-side proxy
- [x] Pertahankan label Indonesia dan form tanpa Nama Pemilik Rekening
- [x] Perbaiki HTTP 405 dengan handler format Netlify `export const handler`
- [x] Uji syntax dan request POST BANK/E-WALLET melalui proxy
- [x] Pastikan API key tidak ada di `index.html`

## Catatan

Uji live berhasil mencapai kedua endpoint GGAPI dan menerima HTTP 402 karena kuota gratis habis/saldo tidak mencukupi. Setelah saldo atau kuota tersedia, function yang sama akan meneruskan respons validasi BANK dan E-WALLET ke UI.
- [x] Login page (neon MG + animasi), password di Redis, diubah via Telegram (/setpass, /genpass, /loginon, /loginoff, /kickall)
- [x] Kunci `/` dan `/api/account-check` dengan sesi login; logout + auto-keluar saat password diganti
- [x] Menu Balance & Top Up via API resmi GGAPI (/v1/me, /v1/topup, status polling, webhook + notif Telegram)
- [x] Login page diringankan (mode lite/full otomatis, tombol mode, logo kecil)

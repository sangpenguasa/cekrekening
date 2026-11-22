# CEK REKENING + GGAPI

Aplikasi HTML statis ini menggunakan Vercel Serverless Function sebagai proxy server-side ke GGAPI. API key tidak pernah ditulis di HTML atau dikirim langsung dari browser.

## Upload ke GitHub + Deploy otomatis ke Vercel (rahasia tetap di Vercel)
Semua data rahasia (API key, token Telegram, Redis) **tidak ada di kode**; tetap diisi di **Vercel → Settings → Environment Variables**. Daftar nama variabel ada di `.env.example`. File `.gitignore` sudah mencegah `.env` ikut ter-commit.

1. **Ekstrak** ZIP ini di komputer (GitHub web tidak menerima file ZIP langsung).
2. Buat repository baru di GitHub (disarankan **Private**), lalu **Add file → Upload files**, seret **seluruh isi folder hasil ekstrak** (termasuk folder `api`, `assets`, `private`) → **Commit changes**. (Tampilkan file tersembunyi agar `.gitignore` dan `.env.example` ikut terseret. Batas upload web: 100 file per sekali upload; proyek ini ±40 file.)
3. **Vercel**:
   - Project **baru**: *Add New → Project → Import* repository tadi. *Framework Preset*: **Other**, *Build Command*: kosong, *Output Directory*: kosong. Isi Environment Variables sesuai `.env.example`, lalu *Deploy*.
   - Project **yang sudah ada** (variabel sudah terisi): *Settings → Git → Connect Git Repository* → pilih repo. Environment Variables lama tetap dipakai, tidak perlu diisi ulang.
4. Setiap update berikutnya: upload/commit file yang berubah ke GitHub → Vercel otomatis deploy.
5. Setelah domain/project berubah, daftarkan ulang webhook Telegram (`setWebhook`) dan kirim `/setwebhook` ke bot untuk top up.

> Jangan pernah menaruh token/API key di file apa pun di repo. Jika sempat ter-commit, anggap bocor: ganti (revoke) kuncinya di BotFather / Upstash / GGAPI.

## Deploy ke Vercel melalui Dashboard

1. Ekstrak ZIP ini, lalu buka [Vercel](https://vercel.com/) dan pilih **Add New → Project**.
2. Upload folder proyek atau hubungkan repository Git.
3. Pada **Build and Output Settings**, gunakan pengaturan default. Karena ini HTML statis, **Build Command** boleh dikosongkan dan **Output Directory** diisi `.` bila Vercel memintanya.
4. Sebelum atau sesudah deploy, buka **Project → Settings → Environment Variables**.
5. Tambahkan variable berikut:
   - **Name:** `GGAPI_API_KEY`
   - **Value:** API key GGAPI Anda
   - Centang **Production**, **Preview**, dan **Development** sesuai kebutuhan.
6. Klik **Save**, kemudian lakukan **Redeploy** agar deployment membaca variable baru. Jangan memakai prefix `NEXT_PUBLIC_` atau menaruh key di `index.html`, karena itu akan mengekspos key ke pengunjung.

## Deploy melalui CLI

Di folder proyek yang berisi `index.html`, folder `api`, dan `package.json`:

```bash
npm install
npm install -g vercel
vercel login
vercel
vercel env add GGAPI_API_KEY production
vercel env add GGAPI_API_KEY preview
vercel env add GGAPI_API_KEY development
vercel --prod
```

Saat `vercel env add` meminta nilai, masukkan API key GGAPI. Untuk mengubahnya, jalankan perintah yang sama lalu pilih nilai baru, kemudian deploy ulang.

## Struktur endpoint

Frontend memanggil endpoint Vercel berikut:

```text
POST /api/account-check
```

Function tersebut meneruskan permintaan ke:

- Bank: `https://use.ggapi.co.id/api/bank-verification/validate`
- E-Wallet: `https://use.ggapi.co.id/api/ewallet-verification/validate`

Header `x-ggapi-co-id` diisi dari `process.env.GGAPI_API_KEY` di server Vercel. Jika API key belum dipasang atau kuota GGAPI habis, aplikasi akan menampilkan pesan error dari server.

## Announcement & Jadwal Tutup Website (kontrol via Telegram)

Banner announcement tampil di **atas** halaman (pesan, waktu tutup WIB, hitung mundur). Saat waktu tiba, seluruh halaman diganti tulisan **This Site Has Been Closed Thanks**, dan `/api/account-check` ikut menolak request (HTTP 503).

### 1. Storage (wajib, gratis)
Vercel Dashboard → **Storage / Marketplace → Upstash Redis → Create** lalu hubungkan ke project. Env `KV_REST_API_URL` dan `KV_REST_API_TOKEN` terisi otomatis (nama `UPSTASH_REDIS_REST_URL/TOKEN` juga didukung).

### 2. Environment Variables
| Name | Isi |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token dari @BotFather |
| `TELEGRAM_ADMIN_IDS` | ID Telegram admin, pisahkan koma (kirim `/myid` ke bot untuk melihat ID) |
| `TELEGRAM_WEBHOOK_SECRET` | string acak bebas (huruf/angka/_/-) |

Redeploy setelah menambah variable.

### 3. Pasang webhook (sekali saja)
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://DOMAIN-ANDA.vercel.app/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 4. Perintah bot (waktu = WIB)
```
/close 2h                  tutup 2 jam lagi (30m, 1d, 1d 3h)
/close 2026-11-01 23:59    tutup pada tanggal & jam tertentu
/close now                 tutup sekarang
/cancel                    batalkan jadwal / buka kembali
/announce teks             pesan announcement tambahan
/clearannounce             hapus pesan
/status                    cek status
```

## Login Page (password disimpan di server, diganti lewat Telegram)

Seluruh situs sekarang dilindungi login. **Password tidak ada di dalam ZIP/kode**: disimpan sebagai hash (scrypt) di Redis yang sama dengan jadwal tutup, dan bisa diganti kapan saja lewat bot Telegram. Tidak perlu redeploy.

- `/login` → halaman login (logo neon MG + animasi). `/` → aplikasi, hanya terbuka bila sudah login.
- `/api/account-check` ikut dikunci (tanpa sesi = HTTP 401), jadi API tidak bisa dipakai tanpa login.
- Sesi = cookie HttpOnly bertanda tangan. Ganti password atau `/kickall` → semua pengguna otomatis keluar (maks. 20 detik).
- Anti brute-force: 8 percobaan salah per IP, lalu dikunci 15 menit.
- Storage Redis (Upstash) **wajib** terpasang. Tanpa password yang diatur, semua orang ditolak (aman secara default).

### Pertama kali
1. Deploy, pastikan env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS`, `TELEGRAM_WEBHOOK_SECRET` dan Redis sudah terisi (lihat bagian Telegram di atas).
2. Kirim ke bot: `/setpass PasswordAnda123` (atau `/genpass` untuk password acak). Pesan Anda berisi password otomatis dihapus bot dari chat.
3. Buka `https://DOMAIN-ANDA.vercel.app/login`.

### Perintah bot tambahan
```
/setpass PASSWORD   ganti password (6-64 karakter)
/genpass            buat password acak 14 karakter & langsung dipakai
/loginon            wajibkan login (default)
/loginoff           matikan login (situs terbuka tanpa password)
/kickall            paksa semua pengguna login ulang
/status             kini juga menampilkan status login & password
```

### Struktur baru
```text
login.html               halaman login (publik)
private/app.html         aplikasi utama (dulu index.html, hanya disajikan via /api/app setelah login)
api/app.mjs              gerbang: cek sesi lalu kirim private/app.html
api/login.mjs            GET status sesi / POST login
api/logout.mjs           logout
api/_lib/auth.mjs        hash password, sesi, rate limit
assets/mg-neon.webp      logo neon MG untuk background login
vercel.json              routing: / -> /api/app, /login -> login.html, /private/* diblok
```
Untuk mengubah tampilan aplikasi, edit `private/app.html` (bukan index.html).

## Update tampilan (login, background, ikon)
- Login page: logo MG neon dibersihkan (tanpa kotak-kotak), tulisan "PASSWORD DIATUR PEMILIK..." dihapus.
- Background **Awan & Bintang** dan **Superman (Statis)** dihapus. Diganti 3 background animasi ringan (canvas): **Aurora Borealis**, **Neon Sunset**, **Hyperspace** (ikut gerakan kursor).
- Background utama sekarang **Galaxy** (default). Background Satoru Gojo sudah dihapus beserta aset `gojo.webp` / `gojo-poster.webp`.
- Ikon tab (favicon) baru: `favicon.ico`, `assets/favicon-*.png`, `assets/apple-touch-icon.png`, `assets/icon-192/512.png`, `manifest.webmanifest`.

## Menu Balance & Top Up (API resmi GGAPI)

Tab **Balance & Top Up** di aplikasi memakai API resmi GGAPI (`docs: ggapi.co.id/docs/topup-integration.md`), semuanya lewat server (API key tidak pernah ke browser) dan hanya bisa diakses setelah login.

Alur: pilih nominal → server `POST /v1/topup` → halaman bayar (QRIS/e-wallet/VA) terbuka di tab baru → status dicek otomatis (`GET /v1/topup/{order_id}`) + webhook `topup.success` → saldo `GET /v1/me` bertambah. Setiap top up sukses juga dikirim ke Telegram admin.

### Pemasangan
1. Pastikan **nomor HP sudah diisi di profil dashboard GGAPI** (syarat membuat invoice) dan `GGAPI_API_KEY` sudah ada di Vercel.
2. Deploy ulang project ini.
3. Daftarkan webhook (sekali saja): kirim **`/setwebhook`** ke bot Telegram. URL otomatis `https://DOMAIN-ANDA/api/ggapi-webhook`, secret disimpan di Redis.
4. Tes: `/saldo` (baca saldo), `/webhookinfo`, lalu `/testtopup 10000` dan bayar linknya, atau pakai tab Top Up di website.

### Environment Variables (semua opsional)
| Key | Fungsi |
|---|---|
| `GGAPI_WEBHOOK_SECRET` | Secret webhook manual (default: disimpan otomatis oleh `/setwebhook`) |
| `LOW_BALANCE_POINTS` | Batas badge "Saldo habis" (default `0`) |
| `SHOW_BALANCE` | Isi `0` untuk menyembunyikan angka saldo dari pengguna |

### Perintah bot tambahan
`/saldo`, `/setwebhook [url]`, `/webhookinfo`, `/testtopup [nominal]`.

## Login ringan (perangkat kentang)
`login.html` kini ringan secara default: tanpa blur/backdrop-filter, tanpa animasi yang memicu repaint, logo memakai versi kecil (`mg-neon-sm.webp`, 720px) di layar kecil. Efek tambahan (partikel, border neon berputar, parallax) hanya aktif di **mode penuh** pada perangkat kuat. Mode dipilih otomatis (RAM/CPU, hemat data, reduced-motion, dan uji FPS 1,5 detik pertama). Pengguna bisa mengganti lewat tombol kecil di pojok kiri bawah, atau paksa dengan `/login?fx=lite` / `/login?fx=full`.

## Broadcast realtime (tanpa refresh)
Pesan dari bot Telegram muncul di semua tab yang sedang terbuka dalam ±5-8 detik (polling ringan, hasilnya di-cache CDN `STATUS_CACHE_SEC` detik, default 3, sehingga Redis tidak terbebani).

- `/announce teks` → biru (info) · `/announce warn teks` → kuning (perhatian) · `/announce urgent teks` → merah (penting)
- `/clearannounce` hapus pesan · `/close 2h` jadwal tutup (hitung mundur ikut tampil) · `/cancel` batalkan
- Tampilan: banner animasi (ikon lonceng, label BARU, "x menit lalu", kotak hitung mundur) + pop-up toast saat ada pesan/jadwal baru, getar di HP, dan judul tab berkedip "🔔 Pesan baru" bila tab sedang tidak aktif.
- Saat waktu tutup tiba, halaman langsung berganti **This Site Has Been Closed Thanks**; `/cancel` membukanya kembali tanpa refresh. Kurang dari 1 jam sebelum tutup, banner otomatis berwarna merah dan tidak bisa ditutup.
- Jam hitung mundur disinkronkan ke jam server lewat `/api/time`, jadi tetap akurat walau jam perangkat salah.

## Pesan halaman tutup (custom)
Teks di halaman "tutup" bisa diganti lewat bot Telegram (berlaku realtime, juga di halaman login):
- `/closemsg Sedang maintenance, kembali pukul 20.00 WIB` (gunakan `\n` untuk baris baru)
- `/closemsg reset` kembali ke bawaan **This Site Has Been Closed Thanks**
- Sekaligus dengan jadwal: `/close 2026-11-10 23:59 | Maintenance sampai besok pagi`

## Jika muncul "redis: Timeout Error: Request timed out"
Itu timeout dari database Upstash (biasanya sesaat). Kode kini otomatis mencoba ulang, dan perubahan konfigurasi tidak akan menimpa data lama bila Redis gagal. Jika sering terjadi:
1. Kirim `/redis` ke bot: waktu normal < 300 ms.
2. Samakan region: Upstash console → region database Anda, lalu Vercel → Settings → Functions → **Function Region** pilih yang terdekat (mis. Singapore `sin1` untuk database ap-southeast-1).
3. Cek penggunaan di Upstash console (kuota perintah & status database).

## Pilih foto sendiri (background)
Menu **BACKGROUND → 🖼️ Pilih foto sendiri…** (disimpan di browser masing-masing pengguna).
- Unggah foto dari perangkat (otomatis dikecilkan ≤ 1920px & dikompres) atau tempel link `https://`.
- Slider *Gelapkan* (agar teks tetap terbaca), *Blur*, dan opsi *Partikel bergerak* di atas foto.
- Menu **Foto Sendiri** muncul di daftar background; pengaturan terakhir dipulihkan otomatis saat halaman dibuka lagi.
- Tips HP lemah: matikan partikel agar foto statis (paling ringan).

## Cek rekening: V1 utama + V2 cadangan otomatis (satu tab CekrekV1)
Tab CekrekV2 sudah digabung. Urutan pengecekan di server (`/api/account-check`):
1. **Cache server**: rekening yang pernah valid langsung dijawab tanpa memanggil siapa pun (tanda ⚡, tautan *Cek ulang* untuk memaksa).
2. **V1 (GGAPI)**. Jika V1 **error** (timeout, HTTP 5xx, saldo habis 402, API key salah, dll) → otomatis ke **V2**.
3. Jika V1 menjawab **tidak ditemukan** → tetap dicoba di **V2**.
4. Jika V2 juga tidak menemukan → tampil **"Rekening tidak ditemukan / tidak valid."** Jika V1 dan V2 sama-sama gangguan → pesan gangguan + notifikasi ke Telegram admin.
- V2 selalu lewat **HTTP** (bukan HTTPS), dipanggil dari server karena browser memblokir `http://` dari halaman `https://`:
  - E-wallet: `http://node.bimxyz.my.id:3128/api/validate?code={GOPAY|DANA|OVO|ShopeePay|LinkAja}&account_number=…`
  - Bank: `http://node.bimxyz.my.id:3143/api/validate?code={kode bank, sama dengan V1}&account_number=…`
  - Bisa diubah lewat env `V2_EWALLET_BASE` / `V2_BANK_BASE` (https otomatis dipaksa menjadi http).
- Notifikasi Telegram saat V1 error dikirim maks. 1x per 10 menit. Tes API cadangan: `/testv2 bank 014 1234567890` atau `/testv2 ewallet DANA 08123456789`.

## Cache rekening valid (hemat poin / tanpa cek ulang)
Rekening yang sudah **valid** disimpan di server (Redis) dan dipakai untuk semua sumber (V1 maupun V2). Cek berikutnya untuk rekening yang sama langsung dari cache (tanda ⚡ + tautan *Cek ulang* untuk memaksa cek ke penyedia). Rekening **tidak ditemukan / error tidak disimpan**.
- Masa simpan default 365 hari; ubah dengan env `CACHE_TTL_DAYS` (`0` = tanpa kedaluwarsa).
- Bot: `/cache` (jumlah data), `/clearcache` (hapus semua).
- Catatan: cache menyimpan nomor rekening + nama pemilik di database Redis Anda; batasi akses ke Upstash/Vercel dan hapus bila tidak diperlukan.

# Padelix

Aplikasi administrasi penyewaan lapangan padel: Next.js (frontend) dan Express.js (API)
dengan penyimpanan SQLite bawaan Node (`node:sqlite`).

## Menjalankan proyek

1. Salin `.env.example` menjadi `.env`.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.
4. Buka `http://localhost:3000`.

Frontend berjalan di port `3000`, API di port `4000`. Frontend mem-proxy `/api/*` ke API,
jadi tidak ada permintaan lintas-origin dari browser.

## Akun

Akun pertama yang didaftarkan melalui `/register` otomatis menjadi `admin`, dan setelah itu
**pendaftaran publik tertutup permanen**. Akun operator berikutnya dibuat oleh admin melalui
menu **Users**, lengkap dengan pemilihan role.

Di produksi (`NODE_ENV=production`), pembuatan admin pertama mewajibkan `BOOTSTRAP_TOKEN`
pada `.env`. Hapus variabel itu setelah admin pertama dibuat.

## Perintah

- `npm run dev` — menjalankan frontend dan API bersamaan
- `npm run lint` — memeriksa TypeScript seluruh workspace
- `npm run test` — menjalankan test integrasi API
- `npm run build` — membuat production build
- `npm run start` — menjalankan production build
- `npm run backup -w apps/api` — menyalin database ke `apps/api/data/backups/`

## Penyimpanan data

Data tersimpan pada `apps/api/data/padelix.sqlite` (mode WAL) dan dibuat otomatis saat
API pertama kali dijalankan. Lokasi dapat diubah melalui `DATA_DIR`.

Berkas `users.json`, `roles.json`, dan `menus.json` yang lama hanya dibaca **satu kali**
sebagai sumber migrasi awal, lalu diabaikan. Berkas aslinya tidak dihapus.

## Catatan produksi

- Sesi memakai cookie `httpOnly` berisi token acak yang disimpan ter-hash di database,
  berlaku 8 jam. Aktifkan HTTPS agar atribut `secure` pada cookie berfungsi.
- Jadwalkan `npm run backup -w apps/api` secara berkala; salin hasilnya ke luar server.
- SQLite di sini mengandalkan satu proses API. Bila nanti API dijalankan lebih dari satu
  proses atau lebih dari satu server, pindahkan penyimpanan ke PostgreSQL.

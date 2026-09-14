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

## Data contoh

- `npm run seed -w apps/api` — venue satu lantai: tiga lapangan, tarif khusus, booking, denah
  lengkap dengan pintu masuk, serta info venue, kebijakan, dan FAQ.
- `npm run seed:dua-lantai -w apps/api` — gedung dua lantai: tiga lapangan indoor dan pintu masuk
  di Lantai 1, dua lapangan rooftop dan tribun di Lantai 2, tangga dan lift di posisi yang sama
  pada kedua lantai.

Seeder hanya mengisi database yang belum punya lapangan. Untuk mencoba contoh dua lantai tanpa
menyentuh data Anda, pakai folder data terpisah (path absolut), lalu jalankan aplikasi dengan
folder yang sama:

```powershell
$env:DATA_DIR="C:\padelix-contoh"; npm run seed:dua-lantai -w apps/api
$env:DATA_DIR="C:\padelix-contoh"; npm run dev
```

## Venue bertingkat

Denah mendukung hingga 10 lantai. Di menu **Denah Venue**, gunakan **Tambah lantai** di atas denah,
lalu pindahkan lapangan atau elemen lewat pilihan **Lantai** di panel pengaturannya. Setiap lantai
punya ukuran sendiri, dan lapangan hanya dicek saling menimpa terhadap lapangan di lantai yang sama.
Lantai yang masih berisi tidak dapat dihapus. Pelanggan melihat tab lantai pada denah dan jadwal
yang dikelompokkan per lantai.

## Penyimpanan data

Data tersimpan pada `apps/api/data/padelix.sqlite` (mode WAL) dan dibuat otomatis saat
API pertama kali dijalankan. Lokasi dapat diubah melalui `DATA_DIR`.

Berkas `users.json`, `roles.json`, dan `menus.json` yang lama hanya dibaca **satu kali**
sebagai sumber migrasi awal, lalu diabaikan. Berkas aslinya tidak dihapus.

## Catatan produksi

- Sesi memakai cookie `httpOnly` berisi token acak yang disimpan ter-hash di database,
  berlaku 8 jam. Aktifkan HTTPS agar atribut `secure` pada cookie berfungsi.
- Jadwalkan `npm run backup -w apps/api` secara berkala; salin hasilnya ke luar server.
- Rate limit membaca IP pengunjung. Rewrite Next.js tidak menambahkan IP asli, sehingga tanpa
  reverse proxy semua pengunjung berbagi satu kuota. Pasang nginx (atau sejenisnya) di depan
  Next.js dengan `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, lalu isi
  `TRUST_PROXY=loopback`. Jangan isi `TRUST_PROXY` tanpa reverse proxy: header dari browser
  dapat dipalsukan.
- Foto lapangan tersimpan di dalam database, jadi ikut tercadang oleh `npm run backup`.
- Menjalankan server Next.js kedua dari folder yang sama (mis. pratinjau) membutuhkan folder build
  sendiri: isi `NEXT_DIST_DIR=.next-pratinjau` agar tidak bentrok dengan `npm run dev`.
- SQLite di sini mengandalkan satu proses API. Bila nanti API dijalankan lebih dari satu
  proses atau lebih dari satu server, pindahkan penyimpanan ke PostgreSQL.

# Padelix

Fondasi aplikasi administrasi penyewaan lapangan padel dengan Next.js dan Express.js.

## Menjalankan proyek

1. Salin `.env.example` menjadi `.env` dan ganti `JWT_SECRET`.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.
4. Buka `http://localhost:3000`.

Frontend berjalan di port `3000`, sedangkan API berjalan di port `4000`. Akun pertama yang didaftarkan otomatis mendapat role `admin`; akun berikutnya mendapat role `staff`.

## Perintah

- `npm run dev` — menjalankan frontend dan API bersamaan
- `npm run lint` — memeriksa TypeScript seluruh workspace
- `npm run build` — membuat production build
- `npm run start` — menjalankan production build

## Catatan produksi

Data development tersimpan pada `apps/api/data/users.json` dan dibuat otomatis. Sebelum deployment publik, ganti penyimpanan file ini dengan PostgreSQL, simpan token melalui cookie `httpOnly`, aktifkan HTTPS, dan gunakan secret yang kuat dari secret manager.

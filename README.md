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

- `npm run seed -w apps/api` — venue satu lantai: tiga lapangan, tarif khusus, booking dengan sewa
  raket dan tambahan lain, denah lengkap dengan pintu masuk, info venue, kebijakan, FAQ, serta contoh
  pembukuan berisi setoran modal, biaya operasional dua bulan terakhir, dan satu tagihan pemasok.
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

## Sewa & tambahan

Menu **Sewa & Tambahan** mengelola katalog raket, bola, sepatu, pelatih, dan barang lain yang
ditagihkan bersama booking. Setiap item punya salah satu jenis berikut:

- **Sewa**: barang dipinjam lalu dikembalikan. Stoknya berupa jumlah unit, dan unit hanya terpakai
  selama jam main, jadi raket yang sama bisa dipakai booking berikutnya.
- **Jual**: barang habis pakai, misalnya bola atau minuman. Stok berkurang saat item ditambahkan ke
  booking dan kembali bila barisnya dihapus atau booking dibatalkan.
- **Layanan**: jasa seperti pelatih. Stoknya berarti kapasitas pada jam yang sama.

Harga dihitung per booking atau per jam main. Stok boleh tidak dibatasi. Setiap baris booking
menyimpan salinan nama dan harga, jadi perubahan katalog tidak mengubah tagihan lama.

- **Kasir**: menambah atau mengubah tambahan dari detail booking, termasuk biaya lain di luar katalog.
  Tagihan tidak boleh turun di bawah pembayaran yang sudah diterima.
- **Pengembalian**: barang sewa ditandai sudah kembali dari detail booking. Barang yang belum kembali
  tampil di menu ini dan di ringkasan.
- **Stok**: restok, barang rusak atau hilang, dan hitung ulang tercatat di riwayat stok.
- **Pelanggan**: melihat katalog di beranda, memilih tambahan di ringkasan pesanan, dan pilihannya
  ikut di pesan WhatsApp. Item yang tidak ditandai tampil online hanya tersedia untuk kasir.

## Pembayaran online (Midtrans)

Menu **Pembayaran** menyambungkan aplikasi ke akun Midtrans Anda.

1. Ambil **client key** dan **server key** di dashboard Midtrans: Settings -> Access Keys. Kunci sandbox
   berawalan `SB-`, kunci produksi tanpa awalan itu.
2. Isi kedua kunci di menu Pembayaran, pilih lingkungan, lalu centang **Aktifkan pembayaran online**.
   Tombol **Uji koneksi** memastikan server key diterima Midtrans.
3. Salin alamat webhook dari halaman itu ke dashboard Midtrans: Settings -> Configuration ->
   **Payment Notification URL**. Tanpa webhook, pembayaran yang masuk tidak otomatis mengonfirmasi booking.

Kunci juga dapat diisi lewat environment (`MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`,
`MIDTRANS_IS_PRODUCTION`). Bila diisi, nilai itu yang dipakai dan panel hanya menampilkan statusnya.
Server key tidak pernah dikirim kembali ke browser.

### Keranjang

Pelanggan dapat mengumpulkan beberapa sesi (lapangan, tanggal, atau jam berbeda) di keranjang, lalu
membayarnya sekali. Keranjang disimpan di browser pelanggan; server baru menyentuhnya saat checkout,
jadi tidak ada slot yang terkunci sebelum pembayaran dimulai. Maksimal 6 sesi per pesanan.

Saat checkout, seluruh sesi dibuat dalam satu transaksi: bila satu jam keburu diambil orang lain,
tidak ada satu pun yang tersimpan dan pelanggan diberi tahu sesi mana yang bermasalah. Setiap sesi
tetap menjadi booking tersendiri di menu Booking, dan pembayarannya dibagi ke tiap sesi agar
pembukuan per lapangan tetap utuh.

### Alur pemesanan online

Pelanggan memilih jadwal dan tambahan, memasukkannya ke keranjang, lalu diarahkan ke halaman pembayaran
Midtrans (QRIS, virtual account, e-wallet, atau kartu). Booking langsung dibuat berstatus *menunggu
pembayaran* sehingga slotnya terkunci selama batas waktu yang Anda tentukan. Setelah pembayaran masuk,
webhook mengubahnya menjadi terkonfirmasi dan mencatat pembayaran. Bila tidak dibayar sampai batas
waktu, booking kedaluwarsa, slot terbuka lagi, dan stok barang jual kembali.

- **Bayar penuh atau DP**: pilih di menu Pembayaran. Sisa tagihan DP ditagih di venue seperti biasa.
- **Halaman status**: pelanggan menerima tautan `/pesanan/<id>` yang menampilkan status, sisa waktu bayar,
  dan tombol periksa status sebagai cadangan bila webhook telat.
- **Link tagihan kasir**: dari detail booking, staf dapat membuat link pembayaran untuk sisa tagihan
  booking yang sudah berjalan. Link berlaku 24 jam dan hanya mencatat pembayaran.

Tanda tangan setiap notifikasi diperiksa dengan server key, nominalnya dicocokkan dengan tagihan, dan
notifikasi ganda tidak pernah menambah pembayaran dua kali.

### Menguji di komputer sendiri

Webhook dikirim dari server Midtrans, jadi `localhost` tidak dapat dihubungi. Jalankan terowongan
(mis. `ngrok http 3000`), isi `PUBLIC_URL` dengan alamat terowongan itu, lalu pakai alamat webhook yang
tampil di menu Pembayaran. Coba dulu dengan kunci sandbox sebelum berpindah ke produksi.

## Pembukuan & laporan keuangan

Menu **Keuangan** mencatat pengeluaran operasional dan pemasukan di luar booking, lalu menyusunnya
sendiri menjadi laba rugi, neraca, buku besar, dan buku besar pembantu. Isinya empat bagian:

- **Ringkasan** — saldo kas dan bank, pemasukan, pengeluaran, laba bersih beserta perbandingan dengan
  periode sebelumnya, grafik enam bulan, piutang pelanggan, utang pemasok, dan tagihan yang jatuh tempo.
- **Catatan** — daftar pengeluaran dan pemasukan. Setiap catatan dapat dibayar langsung atau ditunda
  sebagai utang, dan boleh dilampiri foto nota sebagai bukti.
- **Laporan** — laba rugi, neraca, buku besar, buku besar pembantu, dan jurnal umum. Semuanya dapat
  diunduh sebagai CSV atau dicetak.
- **Pengaturan** — bagan akun, daftar pemasok, rekening tujuan tiap metode pembayaran, dan penguncian
  pembukuan.

### Dari mana angkanya datang

Seluruh laporan dihitung dari satu jurnal berpasangan: tiap pencatatan punya sisi debit dan kredit yang
jumlahnya sama, sehingga neraca tidak pernah perlu dicocokkan manual.

- **Booking** yang aktif atau selesai otomatis menjadi pendapatan pada **tanggal sesi bermain**, bukan
  tanggal pemesanan. Nilainya dipecah ke Pendapatan Sewa Lapangan, Sewa Alat, Penjualan Barang, dan
  Pendapatan Jasa sesuai isi booking.
- **Pembayaran dan pengembalian dana** dicatat pada tanggal transaksinya, masuk ke akun Kas atau Bank
  sesuai metode pembayarannya. Pemetaan metode ke rekening diatur di bagian Pengaturan.
- **Uang yang sudah diterima untuk sesi yang belum dimainkan** tampil di neraca sebagai kewajiban
  *Uang Muka Pelanggan*, bukan sebagai pendapatan.
- **Pembatalan booking** menarik kembali pendapatannya, dan pengembalian dana mengurangi kas.

Karena itu, membatalkan booking atau mengubah tambahannya langsung terlihat di laporan tanpa pencatatan
ulang. Jurnal yang dibuat otomatis ditandai sumbernya dan tidak dapat diubah dari menu Keuangan; yang
berubah adalah data operasionalnya.

### Mencatat pengeluaran

Formulirnya memakai bahasa sehari-hari: tanggal, jumlah, untuk apa uangnya, keterangan, lalu apakah
sudah dibayar. Bila belum dibayar, pilih pemasoknya supaya tagihannya muncul di buku besar pembantu
utang, dan tandai lunas begitu dibayar. Sebelum disimpan, formulir menampilkan pratinjau **"Nanti
tercatat begini"** berisi sisi debit dan kredit — berguna untuk staf yang belum terbiasa dengan istilah
akuntansi.

Pemasukan di luar booking (misalnya sewa venue untuk acara) dicatat dengan cara yang sama. Untuk
memindahkan uang antar kas dan bank, atau mencatat setoran dan pengambilan pemilik, gunakan tombol
**Pindah dana** dan **Modal pemilik** — keduanya tidak memengaruhi laba rugi.

### Buku besar pembantu

Tiga rincian yang paling sering ditanyakan:

- **Piutang pelanggan** — sisa tagihan tiap pelanggan, lengkap dengan sesi yang belum lunas.
- **Utang pemasok** — tagihan yang belum dibayar per pemasok, beserta jatuh temponya.
- **Kas & bank** — saldo awal, uang masuk, uang keluar, dan saldo akhir tiap tempat penyimpanan uang.

### Akun dan penguncian

Bagan akun bawaan sudah memakai istilah sehari-hari dan cukup untuk kebanyakan venue. Akun baru boleh
ditambahkan; akun bawaan tidak dapat dihapus, dan jenis akun yang sudah dipakai jurnal tidak dapat
diubah lagi agar riwayatnya tetap benar. Setelah laporan sebuah bulan selesai, isi **Kunci pembukuan**
agar catatan manual pada periode itu tidak berubah diam-diam.

## Tampilan

Seluruh ukuran huruf, jarak, sudut, dan warna berasal dari satu berkas: `apps/web/app/tokens.css`.
Berkas lain memakai variabel dari sana dan tidak menulis ulang angka sendiri, sehingga panel staf dan
situs pelanggan terasa satu produk.

Tiga aturan yang dijaga di seluruh halaman:

- **Tidak ada teks di bawah 12px.** Label mungil memakai `--fs-xs` dengan huruf kapital dan tebal.
- **Setiap teks memenuhi kontras WCAG AA** (4,5:1) pada tema gelap maupun terang.
- **Setiap kontrol dapat disentuh** dengan area minimal 32px. Pengecualiannya hanya elemen denah,
  yang ukurannya memang mengikuti data, dan tautan di tengah kalimat.

Panel staf punya tema gelap dan terang; temanya dipasang sebelum halaman digambar sehingga tidak
berkedip saat dimuat. Situs pelanggan sengaja selalu terang dengan palet sendiri.

Di layar sempit, tabel panel staf berubah menjadi kartu dan sidebar menjadi laci. Halaman laporan
keuangan punya gaya cetak tersendiri: hanya laporannya yang keluar di kertas.

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

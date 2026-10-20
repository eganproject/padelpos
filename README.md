# Padelix

Aplikasi administrasi penyewaan lapangan padel: Next.js (frontend) dan Express.js (API)
dengan database MySQL 8.

## Menjalankan proyek

1. Siapkan MySQL 8.0.19 atau lebih baru (lihat [Database](#database)).
2. Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL`.
3. Jalankan `npm install`.
4. Jalankan `npm run dev`. Tabel dibuat otomatis saat API pertama kali menyala.
5. Buka `http://localhost:3000`.

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
- `npm run lint` — memeriksa TypeScript seluruh workspace dan aturan async di API
- `npm run test` — menjalankan test integrasi API (butuh MySQL, lihat [Database](#database))
- `npm run build` — membuat production build
- `npm run start` — menjalankan production build
- `npm run backup -w apps/api` — membuat berkas backup di folder backup (lihat [Cadangan data](#cadangan-data))
- `npm run restore -w apps/api -- <berkas>` — memulihkan database dari berkas backup
- `npm run import:sqlite -w apps/api` — memindahkan data dari versi SQLite lama ke MySQL

## Data contoh

- `npm run seed -w apps/api` — venue satu lantai: tiga lapangan, tarif khusus, booking dengan sewa
  raket dan tambahan lain, denah lengkap dengan pintu masuk, info venue, kebijakan, FAQ, serta contoh
  pembukuan berisi setoran modal, biaya operasional dua bulan terakhir, dan satu tagihan pemasok.
- `npm run seed:dua-lantai -w apps/api` — gedung dua lantai: tiga lapangan indoor dan pintu masuk
  di Lantai 1, dua lapangan rooftop dan tribun di Lantai 2, tangga dan lift di posisi yang sama
  pada kedua lantai.

Seeder hanya mengisi database yang belum punya lapangan. Untuk mencoba contoh dua lantai tanpa
menyentuh data Anda, pakai database terpisah (dibuat otomatis bila pengguna MySQL punya hak
`CREATE`), lalu jalankan aplikasi dengan database yang sama:

```powershell
$env:DATABASE_URL="mysql://padelix:password@127.0.0.1:3306/padelix_contoh"; npm run seed:dua-lantai -w apps/api
$env:DATABASE_URL="mysql://padelix:password@127.0.0.1:3306/padelix_contoh"; npm run dev
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

## Akun pelanggan (login Google)

Pelanggan dapat masuk dengan akun Google, melengkapi nomor WhatsApp, lalu melihat jadwal mendatang,
riwayat main, dan profilnya di `/akun`. Login memakai Firebase Authentication dan seluruh
pengaturannya ada di panel admin: **Pelanggan → Login Google**. Tidak ada isian `.env` yang perlu
diubah dan tidak perlu file service account.

### Menyiapkan sekali (±10 menit)

1. Buat proyek di [Firebase Console](https://console.firebase.google.com/). Paket gratis sudah cukup.
2. **Authentication → Sign-in method → Google** → aktifkan → Save.
3. **Authentication → Settings → Authorized domains** → tambahkan domain situs (tampil di panel,
   dan bisa disalin). `localhost` sudah terdaftar sejak awal.
4. **Project settings → General → Your apps** → tambah aplikasi Web (`</>`) → salin kotak
   `firebaseConfig`.
5. Tempel di panel admin. Keempat isian terisi sendiri. Centang **Aktifkan login pelanggan**,
   simpan, lalu tekan **Uji koneksi**. Uji koneksi menanyakan langsung ke Google apakah API key
   diterima, proyeknya cocok, domain situs sudah diizinkan, dan login Google sudah menyala — dan
   memberi tahu langkah mana yang belum.

Domain yang diperiksa diambil dari `PUBLIC_URL` (atau `CLIENT_URL`), jadi pastikan nilainya sama
dengan alamat yang dibuka pelanggan.

### Cara kerjanya

Browser masuk ke Google lewat Firebase, lalu mengirim ID token ke API. API memeriksa tanda
tangan token dengan kunci publik Google, memastikan token itu untuk proyek yang tersimpan di panel
dan berasal dari login Google, lalu memberi pelanggan sesi sendiri (cookie `padelix_customer`,
berlaku 30 hari). Setelah itu sesi Firebase di browser langsung ditutup. SDK Firebase hanya diunduh
saat tombol **Lanjutkan dengan Google** ditekan, jadi halaman lain tidak ikut membayar ukurannya.

Sesi pelanggan terpisah dari sesi staf: staf yang memesan sebagai pelanggan di browser yang sama
tidak saling menimpa, dan cookie pelanggan tidak membuka panel staf.

### Riwayat pesanan

Nomor WhatsApp diisi pelanggan sendiri dan **tidak diverifikasi SMS**. Karena itu booking tidak
pernah masuk ke akun hanya karena nomornya sama — kalau begitu, siapa pun bisa mengetik nomor orang
lain dan melihat jadwal mainnya. Booking masuk ke riwayat akun lewat tiga jalan:

- **Checkout sambil masuk.** Pesanan online yang dibuat saat login otomatis tercatat di akun.
- **Klaim oleh pelanggan.** Di halaman Pesanan, pelanggan memasukkan kode pesanan (PDX-XXXXXX, atau
  kode booking 8 karakter dari kasir) beserta nomor HP yang dipakai saat memesan. Keduanya harus
  cocok, dan pesanan yang sudah milik akun lain tidak bisa diambil.
- **Dihubungkan staf.** Rincian booking di panel menampilkan akun dengan nomor yang sama sebagai
  saran; staf menekan **Hubungkan** setelah yakin itu orang yang sama.

Menghapus akun tidak menghapus booking. Jadwal dan pembayarannya tetap milik venue; yang hilang
hanya kaitannya ke akun dan data login Google.

## Pindah jadwal

Booking aktif dapat dipindah ke lapangan, tanggal, atau jam lain dari detail booking (tombol
**Pindah jadwal**). Pembayaran, tambahan, dan potongan ikut pindah. Harga sewa memakai tarif slot
baru, tambahan per jam mengikuti durasi baru, dan stok raket sewa diperiksa di jam baru. Bila
jadwal baru lebih murah dari yang sudah dibayar, kelebihannya tampil sebagai "Perlu pengembalian".
Jurnal pendapatan ikut pindah ke tanggal main yang baru, sehingga kedua tanggal harus berada di
luar periode yang dikunci.

Pelanggan yang masuk dengan Google dapat memindah booking miliknya sendiri dari **Akun → Pesanan**
bila kebijakan venue (Info Venue → Kebijakan) mengizinkan pindah jadwal. Batasnya: sekali per
booking, paling lambat sesuai "batas jam pindah jadwal", dengan durasi yang sama, dan tagihan baru
tidak boleh lebih kecil dari yang sudah dibayar.

## Notifikasi

Menu **Pengaturan → Notifikasi** mengatur tiga kanal sekaligus:

- **Email** lewat SMTP (Gmail atau Google Workspace dengan App Password, Zoho, Mailgun, SendGrid).
- **WhatsApp** lewat Fonnte, Wablas, atau WhatsApp Cloud API dari Meta. Mode **Simulasi** (bawaan)
  tidak mengirim apa pun: isi setiap pesan hanya dicatat di tab Riwayat kiriman, jadi alurnya bisa
  dicoba sebelum berlangganan penyedia.
- **Notifikasi akun**: pelanggan yang masuk dengan Google melihat semua kabar di menu
  **Akun → Notifikasi** (dengan lonceng dan hitungan belum dibaca di kepala halaman), dan bisa
  mematikan salinan email atau WhatsApp dari halaman profilnya.

Pesan yang dikirim, masing-masing bisa dinyalakan atau dimatikan per kanal:

| Pesan | Kapan |
| --- | --- |
| Tagihan | Pelanggan checkout online (berisi nominal, batas bayar, tombol bayar), atau kasir membuat link pembayaran |
| Pengingat batas bayar | Pesanan online belum dibayar, sekali menjelang batas waktunya (setengah waktu tahan, paling lama 15 menit sebelum habis) |
| Pembayaran diterima | Webhook Midtrans mengonfirmasi pembayaran |
| Waktu bayar habis | Slot dilepas karena belum dibayar, dengan tautan untuk memesan lagi |
| Kwitansi kasir | Kasir mencatat pembayaran atau pengembalian dana |
| Jadwal dipindah, booking dibatalkan | Oleh staf atau oleh pelanggan sendiri |
| Pengingat main | Sesuai jam sebelum main yang diatur per kanal (bawaan 24 jam) |
| Untuk staf | Booking online baru dan pindah jadwal oleh pelanggan, ke email dan nomor WhatsApp staf |

Setiap kanal punya antreannya sendiri (`email_outbox`, `whatsapp_outbox`, `customer_notifications`)
yang ditulis di transaksi yang sama dengan perubahannya, lalu dikirim proses latar API setiap 30
detik. Kunci unik per peristiwa mencegah pesan ganda walau webhook datang berkali-kali. Bila
penyedia gagal, pesan dicoba ulang sampai 5 kali dan dapat dikirim ulang dari panel.

Pengaturan juga dapat diisi lewat environment, yang mengalahkan isian panel: `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` untuk email, dan
`WHATSAPP_PROVIDER` (`simulasi`, `fonnte`, `wablas`, `cloud`), `WHATSAPP_TOKEN`,
`WHATSAPP_BASE_URL`, `WHATSAPP_PHONE_NUMBER_ID` untuk WhatsApp.

### Kwitansi

Halaman pesanan (`/pesanan/<id>`) menampilkan riwayat pembayaran dan tautan ke
`/pesanan/<id>/kwitansi`: kwitansi (bila lunas) atau tagihan (bila masih ada sisa) yang siap dicetak
atau disimpan sebagai PDF lewat dialog cetak browser. Setelah terkonfirmasi, halaman pesanan juga
menawarkan simpan ke kalender, bagikan jadwal ke teman main, dan petunjuk arah.

### Nota kasir

Detail booking di panel admin punya tombol **Cetak nota**, untuk booking di kasir maupun online. Tombol
itu membuka `/cetak/nota/<id>` di tab baru dan langsung memanggil dialog cetak browser. Ukuran kertas:
thermal 58 mm, thermal 80 mm, A5, A4, atau lebar lain (40–216 mm). Kertas thermal dan lebar lain
dicetak sebagai kertas gulung yang panjangnya mengikuti isi nota; di dialog cetak atur Margin ke None
dan Skala 100%. Ukuran bawaan, teks kepala/kaki, serta tampil-tidaknya rincian pembayaran dan nama
kasir diatur di **Pengaturan → Nota & Cetak** (bawaannya hanya Super Admin; kasir tetap bisa memilih
ukuran lain untuk satu cetakan).

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

- **Pajak** (mis. PB1 atau PPN) diatur di Pengaturan → Kas & penguncian: nama, tarif, dan apakah
  ditambahkan ke harga atau sudah termasuk. Tarifnya disalin ke setiap booking baru, jadi mengubah
  pengaturan tidak mengubah tagihan lama. Pajak dicatat ke *Utang Pajak*, bukan pendapatan; setorannya
  dicatat lewat Catat pengeluaran dengan kategori Utang Pajak.
- **Potongan harga** diberikan staf dari detail booking aktif, wajib dengan alasan. Pajak dihitung dari
  harga setelah potongan, dan potongannya tampil di laba rugi lewat akun *Potongan Harga*.
- **Denda pembatalan**: pembayaran booking batal yang tidak dikembalikan dapat ditahan sebagian atau
  seluruhnya dari detail booking. Bagian itu menjadi *Pendapatan Pembatalan*; sisanya tetap dapat
  dikembalikan.
- **Potongan payment gateway** diatur per metode (persen dan/atau nominal tetap). Pembayaran Midtrans
  masuk ke rekening sebesar uang yang benar-benar diterima, dan potongannya menjadi *Biaya Bank &
  Payment Gateway*. Tagihan pelanggan tetap lunas penuh.

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

### Situs pelanggan

Gayanya terpisah dari panel staf dan tersimpan di tiga berkas: `shop.css` (rangka, tombol, beranda),
`shop-booking.css` (cek ketersediaan, keranjang, status pesanan), dan `shop-pages.css` (FAQ,
kebijakan, galeri foto, 404). Paletnya ditetapkan sekali pada kelas `.shop`, jadi tema gelap atau
terang milik staf tidak pernah merembes ke halaman pelanggan.

Beranda, FAQ, dan kebijakan digambar di server (`apps/web/lib/server-data.ts`) sehingga isinya sudah
nyata pada gambar pertama. Alur pemesanan tetap berjalan di browser karena jadwalnya harus hidup.
Bila API sedang mati, halaman tetap tampil dengan pesan yang jelas, bukan layar galat.

Beranda dibuka dengan hero gelap. Bila venue sudah mengunggah foto, fotonya dipakai sebagai latar
penuh; bila belum, kolom kanan diisi gambar lapangan yang digambar dengan CSS supaya venue baru pun
punya suasana. Kepekatan lapisan gelap di atas foto ditentukan dari pengukuran: tulisan paling tipis
di hero tetap di atas 5:1 walau fotonya terang.

## Database

Padelix memakai MySQL 8.0.19 atau lebih baru (MariaDB tidak didukung). Buat database dan pengguna
sekali, misalnya lewat `mysql -u root -p`:

```sql
CREATE DATABASE padelix CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'padelix'@'localhost' IDENTIFIED BY 'ganti-password';
GRANT ALL PRIVILEGES ON padelix.* TO 'padelix'@'localhost';
```

Lalu isi `.env`:

```
DATABASE_URL=mysql://padelix:ganti-password@127.0.0.1:3306/padelix
```

Bila password mengandung karakter seperti `@` atau `/`, pakai `MYSQL_HOST`, `MYSQL_PORT`,
`MYSQL_USER`, `MYSQL_PASSWORD`, dan `MYSQL_DATABASE` sebagai gantinya. Tabel dan data bawaan
(menu, role, bagan akun) dibuat otomatis saat API pertama kali menyala; perubahan skema berikutnya
tercatat di tabel `migrations` dan dijalankan sekali saja walau beberapa proses API menyala bersamaan.

Semua penulisan berjalan berurutan dalam transaksi, jadi pemeriksaan seperti bentrok jadwal, stok
sewa, dan nomor jurnal tetap aman walau API dijalankan lebih dari satu proses atau server.

**Test** memakai database `padelix_test_*` yang dibuat ulang setiap kali dijalankan. Bawaannya
menyambung ke `mysql://padelix:padelix@127.0.0.1:3306`; ubah lewat `TEST_DATABASE_URL` (tanpa nama
database). Pengguna itu perlu hak membuat dan menghapus database:

```sql
GRANT ALL PRIVILEGES ON `padelix\_test\_%`.* TO 'padelix'@'localhost';
```

### Pindah dari versi SQLite

Data versi sebelumnya (`apps/api/data/padelix.sqlite`) dipindahkan sekali dengan:

1. Jalankan dulu versi SQLite terakhir sekali agar migrasinya lengkap, lalu hentikan aplikasinya.
2. Siapkan MySQL dan `DATABASE_URL` seperti di atas, lalu perbarui kode ke versi ini.
3. Jalankan `npm run import:sqlite -w apps/api` (atau tambahkan path berkas SQLite lain di belakangnya).

Impor berjalan dalam satu transaksi: bila ada yang gagal, MySQL kembali kosong seperti semula.
Setelah selesai, jumlah baris tiap tabel dicocokkan dan rujukan antartabel diperiksa. Berkas SQLite
tidak diubah, jadi simpan sebagai cadangan sampai Anda yakin. Sesi login tidak ikut dipindah, jadi
staf masuk ulang sekali. Bila MySQL sudah berisi data, impor menolak kecuali ditambah `--yes`.

## Cadangan data

Menu **Pengaturan → Cadangan Data** (bawaannya hanya admin) menampilkan backup yang tersimpan.

- **Otomatis**: setiap hari mulai jam yang dipilih (bawaan 02.00 waktu venue), API membuat satu berkas
  berisi seluruh data, termasuk foto. Backup dibaca dari satu snapshot, jadi kasir tetap bisa bekerja.
- **Penyimpanan**: berkas `.json.gz` di `DATA_DIR/backups`, atau di `BACKUP_DIR` bila diisi. Berkas
  terlama dihapus bila jumlahnya melebihi batas (bawaan 14). Arahkan `BACKUP_DIR` ke disk lain atau
  folder yang disinkron ke Google Drive/OneDrive, atau unduh berkas dari panel secara berkala.
- **Pemulihan**: hentikan API, lalu jalankan
  `npm run restore -w apps/api -- padelix-20261017-020000-auto.json.gz --yes`. Seluruh isi database
  diganti isi berkas dalam satu transaksi; berkas rusak ditolak tanpa mengubah apa pun. Sesi login dan
  kode OTP tidak dicadangkan, jadi semua orang masuk ulang setelah pemulihan.

## Log aktivitas

Menu **Pengaturan → Log Aktivitas** (bawaannya hanya admin) menampilkan siapa melakukan apa dan kapan:
booking, pindah jadwal, pembayaran, refund, potongan harga, denda, jurnal, catatan kas, pengaturan,
backup, dan perubahan pengguna. Aksi yang menyangkut uang menyimpan nilai sebelum dan sesudahnya.
Log dapat disaring per tanggal, pelaku, dan jenis aksi, serta dicari berdasarkan isinya.

## Catatan produksi

- Sesi memakai cookie `httpOnly` berisi token acak yang disimpan ter-hash di database,
  berlaku 8 jam. Aktifkan HTTPS agar atribut `secure` pada cookie berfungsi.
- Backup harian berjalan otomatis (lihat [Cadangan data](#cadangan-data)); pastikan salinannya juga
  ada di luar server.
- Rate limit (login, daftar, OTP, checkout) dihitung per IP pengunjung. Frontend dijalankan oleh
  `apps/web/server.mjs`, yang meneruskan IP asli ke API dalam header bertanda tangan HMAC. Kuncinya
  `INTERNAL_PROXY_SECRET`; bila kosong, API membuat kunci acak di `DATA_DIR/proxy-secret` dan
  frontend membacanya, jadi web dan API di satu mesin langsung jalan. Isi variabel itu dengan nilai
  yang sama bila web dan API berada di mesin berbeda. Header palsu dari browser selalu dibuang.
- Bila ada reverse proxy (nginx, Cloudflare) di depan Next.js, isi `TRUST_PROXY=loopback` (atau jumlah
  proxy) agar IP diambil dari `X-Forwarded-For` buatan proxy itu. Jangan isi tanpa reverse proxy.
- Login juga dibatasi per email: 10 percobaan gagal per 15 menit dari IP yang sama.
- Foto lapangan dan bukti pengeluaran tersimpan di dalam database, jadi ikut tercadang.
- Menjalankan server Next.js kedua dari folder yang sama (mis. pratinjau) membutuhkan folder build
  sendiri: isi `NEXT_DIST_DIR=.next-pratinjau` agar tidak bentrok dengan `npm run dev`.
- API boleh dijalankan lebih dari satu proses di atas database yang sama: migrasi dan backup otomatis
  dikunci di MySQL agar hanya satu proses yang menjalankannya.

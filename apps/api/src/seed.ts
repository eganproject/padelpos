import { randomUUID } from "node:crypto";
import { db, transaction } from "./store.js";
import { floors, localClock, priceRules, quote } from "./operations.js";
import { applyLines } from "./addons.js";
import { createEquity, createTransfer, savePartner, saveRecord, syncBooking } from "./finance.js";

/**
 * Data contoh untuk mencoba aplikasi.
 *   npm run seed -w apps/api              satu lantai, tiga lapangan
 *   npm run seed:dua-lantai -w apps/api   gedung dua lantai: tiga lapangan indoor di Lantai 1,
 *                                         dua lapangan rooftop di Lantai 2, tangga dan lift sejajar
 * --force menambah data satu lantai walau sudah ada lapangan. Contoh dua lantai hanya dibuat
 * di database kosong agar denahnya tidak bercampur dengan denah yang sudah ada.
 */
const twoFloors = process.argv.includes("--dua-lantai");
const force = process.argv.includes("--force");
const existing = db.prepare("SELECT count(*) n FROM courts").get() as { n: number };
if (existing.n && (twoFloors || !force)) {
  console.log(twoFloors
    ? `Sudah ada ${existing.n} lapangan. Contoh dua lantai hanya dibuat di database kosong. Jalankan dengan DATA_DIR baru (lihat README).`
    : `Sudah ada ${existing.n} lapangan. Jalankan dengan --force untuk menambah data contoh lagi.`);
  db.close();
  process.exit(0);
}

const actor = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined)?.id ?? "seed";
const clock = localClock();
const day = (offset: number) => {
  const date = new Date(clock.date + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

type SeedCourt = {
  name: string; hourly_rate: number; opens_at: string; closes_at: string;
  floor: number; x: number; y: number; environment: "indoor" | "outdoor"; surface: string; description: string;
};
type Scenario = {
  label: string;
  floors: { name: string; width: number; height: number }[];
  courts: SeedCourt[];
  rules: [label: string, days: number[], start: string, end: string, rate: number, courts: number[]][];
  /** `addons`: [indeks item katalog, jumlah]. */
  reservations: { court: number; day: number; start: string; end: string; customer: string; phone: string; addons?: [item: number, quantity: number][] }[];
  maintenance: { court: number; day: number; start: string; end: string; reason: string };
  /** Posisi dalam unit kanvas: 1 unit = 0,1 m. Lapangan standar 10 x 20 m = 100 x 200 unit. */
  features: [floor: number, kind: string, label: string, x: number, y: number, w: number, h: number][];
  tagline: string;
  about: string;
  faqs: [question: string, answer: string][];
};

// Katalog sewa & tambahan, sama untuk kedua contoh.
// [nama, kategori, jenis, hitungan, harga, stok (null = tidak dibatasi), batas stok menipis, maks per booking, deskripsi, tampil online]
const catalog: [string, string, "sewa" | "jual" | "layanan", "per_booking" | "per_hour", number, number | null, number, number, string, boolean][] = [
  ["Sewa raket", "raket", "sewa", "per_booking", 30000, 16, 0, 4, "Raket karbon untuk pemula hingga menengah, dipinjam selama jam main.", true],
  ["Raket premium", "raket", "sewa", "per_booking", 60000, 4, 0, 4, "Raket seri pro yang lebih ringan dan bertenaga.", true],
  ["Bola padel (isi 3)", "bola", "jual", "per_booking", 85000, 24, 6, 4, "Satu tabung berisi 3 bola baru, boleh dibawa pulang.", true],
  ["Sewa sepatu", "sepatu", "sewa", "per_booking", 25000, 10, 0, 4, "Sepatu bersol karet non-marking, ukuran 38–45.", true],
  ["Handuk", "handuk", "sewa", "per_booking", 10000, 20, 0, 4, "Handuk bersih untuk dipakai selama di venue.", true],
  ["Air mineral 600 ml", "minuman", "jual", "per_booking", 8000, 48, 12, 12, "", true],
  ["Pelatih privat", "pelatih", "layanan", "per_hour", 200000, 2, 0, 1, "Latihan teknik dasar bersama pelatih bersertifikat. Dihitung per jam main.", true],
  ["Rekam video pertandingan", "dokumentasi", "layanan", "per_booking", 75000, null, 0, 1, "Video pertandingan dikirim lewat WhatsApp setelah main.", true],
  ["Overgrip raket", "perlengkapan", "jual", "per_booking", 35000, 4, 5, 4, "Dijual di resepsionis untuk mengganti grip yang licin.", false],
];

const commonFaqs: [string, string][] = [
  ["Apakah bisa sewa raket dan bola?", "Bisa. Pilih raket, bola, sepatu, atau pelatih saat memesan jadwal, atau minta langsung di resepsionis."],
  ["Berapa pemain dalam satu lapangan?", "Padel dimainkan berpasangan, jadi idealnya 4 pemain. Tetap boleh bermain berdua."],
];

const oneFloor: Scenario = {
  label: "satu lantai",
  floors: [{ name: "Lantai 1", width: 600, height: 400 }],
  courts: [
    { name: "Center Court", hourly_rate: 350000, opens_at: "06:00", closes_at: "23:00", floor: 0, x: 40, y: 60, environment: "indoor", surface: "Karpet akrilik",
      description: "Lapangan utama berdinding kaca panoramik dengan tribun penonton. Pencahayaan LED merata, cocok untuk turnamen dan main malam." },
    { name: "Court 2", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", floor: 0, x: 180, y: 60, environment: "indoor", surface: "Rumput sintetis",
      description: "Lapangan indoor beratap penuh, tetap nyaman dipakai saat hujan. Pilihan favorit untuk main santai bersama teman." },
    { name: "Court 3 (Outdoor)", hourly_rate: 250000, opens_at: "07:00", closes_at: "21:00", floor: 0, x: 320, y: 60, environment: "outdoor", surface: "Rumput sintetis",
      description: "Lapangan terbuka dengan udara segar dan tarif paling hemat. Tidak dapat dipakai saat hujan deras." },
  ],
  // Jam sibuk hari kerja dan akhir pekan. Court 3 hanya naik di akhir pekan.
  rules: [
    ["Jam sibuk", [1, 2, 3, 4, 5], "17:00", "22:00", 450000, [0]],
    ["Jam sibuk", [1, 2, 3, 4, 5], "17:00", "22:00", 400000, [1]],
    ["Akhir pekan", [0, 6], "06:00", "23:00", 450000, [0]],
    ["Akhir pekan", [0, 6], "06:00", "23:00", 400000, [1]],
    ["Akhir pekan", [0, 6], "07:00", "21:00", 300000, [2]],
  ],
  reservations: [
    { court: 0, day: 0, start: "18:00", end: "19:30", customer: "Andi Pratama", phone: "081234567001", addons: [[0, 4], [2, 1], [5, 4]] },
    { court: 1, day: 0, start: "19:00", end: "20:00", customer: "Rina Kusuma", phone: "081234567002", addons: [[3, 2]] },
    { court: 0, day: 1, start: "07:00", end: "08:30", customer: "Komunitas Padel Pagi", phone: "081234567003", addons: [[6, 1], [0, 2]] },
    { court: 2, day: 1, start: "16:00", end: "18:00", customer: "Dimas Herlambang", phone: "081234567004", addons: [[1, 2], [7, 1]] },
    { court: 1, day: 2, start: "20:00", end: "21:00", customer: "Sari Wulandari", phone: "081234567005" },
  ],
  maintenance: { court: 2, day: 1, start: "09:00", end: "11:00", reason: "Perawatan rumput sintetis" },
  features: [
    [0, "jalan", "", 40, 280, 380, 30],
    [0, "resepsionis", "", 40, 330, 70, 40],
    [0, "kantin", "Kantin & lounge", 130, 330, 120, 60],
    [0, "tempat-duduk", "Tribun penonton", 270, 330, 90, 50],
    [0, "toilet", "", 380, 330, 50, 40],
    [0, "parkir", "", 450, 60, 110, 200],
    [0, "pintu-masuk", "Pintu masuk utama", 450, 330, 110, 40],
  ],
  tagline: "Tiga lapangan padel di tengah kota, buka setiap hari.",
  about: "Padelix Arena menyediakan dua lapangan indoor dan satu lapangan outdoor dengan standar ukuran internasional.\n\nCocok untuk pemula yang baru mencoba padel maupun komunitas yang rutin bermain. Tim kami siap membantu menyiapkan raket dan bola.",
  faqs: [
    ...commonFaqs,
    ["Apakah lapangan indoor tetap bisa dipakai saat hujan?", "Bisa. Center Court dan Court 2 beratap penuh."],
    ["Apakah tersedia tempat parkir?", "Tersedia parkir mobil dan motor di area venue."],
  ],
};

// Gedung 60 x 40 m. Tangga dan lift diletakkan di posisi yang sama pada kedua lantai,
// seperti di bangunan sebenarnya, sehingga pelanggan mudah membayangkan jalur naiknya.
const twoFloorBuilding: Scenario = {
  label: "dua lantai",
  floors: [
    { name: "Lantai 1", width: 600, height: 400 },
    { name: "Lantai 2 · Rooftop", width: 600, height: 400 },
  ],
  courts: [
    { name: "Arena 1", hourly_rate: 350000, opens_at: "06:00", closes_at: "23:00", floor: 0, x: 40, y: 40, environment: "indoor", surface: "Karpet akrilik",
      description: "Lapangan utama berdinding kaca panoramik di lantai dasar, dekat kafe dan ruang tunggu." },
    { name: "Arena 2", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", floor: 0, x: 180, y: 40, environment: "indoor", surface: "Rumput sintetis",
      description: "Lapangan indoor beratap penuh, tetap nyaman dipakai saat hujan." },
    { name: "Arena 3", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", floor: 0, x: 320, y: 40, environment: "indoor", surface: "Rumput sintetis",
      description: "Lapangan indoor paling dekat dengan pintu masuk." },
    { name: "Rooftop 1", hourly_rate: 275000, opens_at: "07:00", closes_at: "22:00", floor: 1, x: 40, y: 40, environment: "outdoor", surface: "Rumput sintetis",
      description: "Lapangan terbuka di atap gedung dengan pemandangan kota. Tidak dapat dipakai saat hujan deras." },
    { name: "Rooftop 2", hourly_rate: 275000, opens_at: "07:00", closes_at: "22:00", floor: 1, x: 180, y: 40, environment: "outdoor", surface: "Rumput sintetis",
      description: "Bersebelahan dengan tribun rooftop, cocok untuk main sore sambil menikmati matahari terbenam." },
  ],
  rules: [
    ["Akhir pekan", [0, 6], "06:00", "23:00", 400000, [0]],
    ["Akhir pekan", [0, 6], "06:00", "23:00", 350000, [1, 2]],
    ["Sore rooftop", [0, 1, 2, 3, 4, 5, 6], "16:00", "19:00", 325000, [3, 4]],
  ],
  reservations: [
    { court: 0, day: 0, start: "18:00", end: "19:30", customer: "Andi Pratama", phone: "081234567001", addons: [[0, 4], [2, 1], [5, 4]] },
    { court: 3, day: 0, start: "17:00", end: "18:00", customer: "Rina Kusuma", phone: "081234567002", addons: [[3, 2], [4, 2]] },
    { court: 1, day: 1, start: "07:00", end: "08:30", customer: "Komunitas Padel Pagi", phone: "081234567003", addons: [[6, 1], [0, 2]] },
    { court: 4, day: 1, start: "16:00", end: "18:00", customer: "Dimas Herlambang", phone: "081234567004", addons: [[1, 2], [7, 1]] },
    { court: 2, day: 2, start: "20:00", end: "21:00", customer: "Sari Wulandari", phone: "081234567005" },
  ],
  maintenance: { court: 4, day: 1, start: "09:00", end: "11:00", reason: "Pengecekan jaring dan lampu rooftop" },
  features: [
    // Lantai 1: tiga lapangan indoor, selasar, dan fasilitas di sisi depan.
    [0, "tangga", "Tangga ke Lantai 2", 460, 40, 100, 90],
    [0, "lift", "", 460, 140, 50, 40],
    [0, "jalan", "Selasar", 40, 260, 520, 30],
    [0, "resepsionis", "", 40, 310, 80, 50],
    [0, "kantin", "Kafe & ruang tunggu", 140, 310, 140, 70],
    [0, "toilet", "", 300, 310, 50, 40],
    [0, "loker", "", 370, 310, 70, 40],
    [0, "pintu-masuk", "Pintu masuk utama", 460, 320, 100, 50],
    // Lantai 2: dua lapangan rooftop, tribun, dan bar.
    [1, "tangga", "Tangga ke Lantai 1", 460, 40, 100, 90],
    [1, "lift", "", 460, 140, 50, 40],
    [1, "toilet", "", 460, 200, 50, 40],
    [1, "tempat-duduk", "Tribun rooftop", 320, 40, 110, 200],
    [1, "jalan", "Selasar", 40, 260, 520, 30],
    [1, "kantin", "Bar minuman", 40, 310, 120, 60],
    [1, "lainnya", "Area pemanasan", 180, 310, 160, 60],
  ],
  tagline: "Lima lapangan padel di dua lantai, termasuk rooftop.",
  about: "Padelix Arena punya lima lapangan di dua lantai: tiga lapangan indoor di Lantai 1 dan dua lapangan rooftop di Lantai 2.\n\nNaik ke rooftop lewat tangga atau lift di samping kafe. Tim kami siap membantu menyiapkan raket dan bola.",
  faqs: [
    ...commonFaqs,
    ["Bagaimana menuju lapangan rooftop?", "Gunakan tangga atau lift di sisi kanan gedung menuju Lantai 2. Lapangan rooftop ada tepat di depan pintu keluar tangga."],
    ["Apakah lapangan rooftop tetap bisa dipakai saat hujan?", "Tidak saat hujan deras. Booking rooftop yang terkena hujan dapat dijadwalkan ulang tanpa biaya."],
  ],
};

const scenario = twoFloors ? twoFloorBuilding : oneFloor;

transaction(() => {
  // Lantai pertama dibuat oleh migrasi; di database kosong nama dan ukurannya disesuaikan.
  const present = floors();
  const floorIds = scenario.floors.map((floor, index) => {
    const current = present[index];
    if (current) {
      if (!existing.n) db.prepare("UPDATE floors SET name=?,width=?,height=? WHERE id=?").run(floor.name, floor.width, floor.height, current.id);
      return current.id;
    }
    const id = randomUUID();
    db.prepare("INSERT INTO floors (id,name,position,width,height,created_at) VALUES (?,?,?,?,?,?)").run(id, floor.name, index, floor.width, floor.height, new Date().toISOString());
    return id;
  });
  if (!existing.n) db.prepare("UPDATE settings SET document=? WHERE key='venue'").run(JSON.stringify({ width: scenario.floors[0].width, height: scenario.floors[0].height, grid: 10 }));

  const ids = scenario.courts.map(court => {
    const id = randomUUID();
    db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,active,created_at,layout_x,layout_y,layout_w,layout_h,description,environment,surface,floor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, court.name, court.hourly_rate, court.opens_at, court.closes_at, 1, new Date().toISOString(), court.x, court.y, 100, 200, court.description, court.environment, court.surface, floorIds[court.floor]);
    return { id, ...court };
  });

  for (const [label, days, start, end, rate, targets] of scenario.rules) {
    const id = randomUUID();
    db.prepare("INSERT INTO price_rules (id,label,days,start_time,end_time,hourly_rate,created_at) VALUES (?,?,?,?,?,?,?)").run(id, label, JSON.stringify(days), start, end, rate, new Date().toISOString());
    for (const index of targets) db.prepare("INSERT INTO price_rule_courts (rule_id,court_id) VALUES (?,?)").run(id, ids[index].id);
  }

  // Katalog tambahan hanya diisi bila masih kosong, agar --force tidak membuat item ganda.
  const hasCatalog = (db.prepare("SELECT count(*) n FROM addons").get() as { n: number }).n > 0;
  const addonIds = hasCatalog ? [] : catalog.map(([name, category, type, pricing, price, stock, lowStock, max, description, online], position) => {
    const id = randomUUID(), stamp = new Date().toISOString();
    db.prepare("INSERT INTO addons (id,name,category,type,pricing,price,stock,low_stock,max_per_booking,description,active,online,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)")
      .run(id, name, category, type, pricing, price, stock, lowStock, max, description, Number(online), position, stamp);
    if (stock !== null) db.prepare("INSERT INTO addon_stock_moves (id,addon_id,delta,reason,note,stock_after,created_by,created_at) VALUES (?,?,?,'awal','',?,?,?)").run(randomUUID(), id, stock, stock, actor, stamp);
    return id;
  });

  const activeRules = priceRules();
  for (const item of scenario.reservations) {
    const court = ids[item.court], id = randomUUID();
    const total = quote(court, activeRules, day(item.day), item.start, item.end);
    db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,court_total,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, court.id, item.customer, item.phone, day(item.day), item.start, item.end, total, total, "confirmed", "", actor, new Date().toISOString());
    if (addonIds.length && item.addons)
      applyLines({ id, date: day(item.day), start_time: item.start, end_time: item.end, paid: 0, court_total: total }, item.addons.map(([index, quantity]) => ({ addon_id: addonIds[index], quantity })), actor);
    // Booking di sini ditulis langsung ke tabel, jadi jurnal pendapatannya dibuat menyusul.
    syncBooking(id);
  }

  const care = scenario.maintenance;
  db.prepare("INSERT INTO maintenance (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), ids[care.court].id, day(care.day), care.start, care.end, care.reason);

  // Elemen penjelas denah: hanya informasi, tidak memengaruhi jadwal.
  for (const [floor, kind, label, x, y, w, h] of scenario.features) {
    db.prepare("INSERT INTO venue_features (id,kind,label,x,y,w,h,floor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), kind, label, x, y, w, h, floorIds[floor], new Date().toISOString());
  }

  // Info venue contoh. Alamat dan nomor sengaja berbentuk contoh agar tidak tertukar dengan data asli.
  // INSERT OR IGNORE: info yang sudah diisi admin tidak pernah ditimpa, termasuk saat --force.
  const stamp = new Date().toISOString();
  const documents: Record<string, object> = {
    info: {
      name: "Padelix Arena", tagline: scenario.tagline, about: scenario.about,
      address: "Jl. Contoh Raya No. 10, Kebayoran Baru, Jakarta Selatan", maps_url: "", show_map: true,
      whatsapp: "6281234567890", phone: "", email: "halo@contoh.test", instagram: "padelix.contoh",
      hours_note: "Setiap hari, 06.00–23.00", facilities: ["parkir", "toilet", "kamar-bilas", "musala", "kantin", "wifi", "sewa-raket", "sewa-bola"],
      extra_facilities: twoFloors ? ["Lift ke rooftop"] : [], updated_at: stamp,
    },
    policies: {
      refund_tiers: [{ hours: 24, percent: 100 }, { hours: 6, percent: 50 }], refund_days: 3, reschedule: "yes", reschedule_hours: 12,
      cancellation_note: "Pembatalan karena hujan deras di lapangan outdoor dapat dijadwalkan ulang tanpa biaya.",
      terms: "Harap datang 10 menit sebelum jam main untuk registrasi.\n\n- Wajib memakai sepatu olahraga bersol karet non-marking.\n- Maksimal 4 pemain aktif per lapangan.\n- Jam main berakhir tepat waktu agar pemesan berikutnya tidak menunggu.\n\nKerusakan fasilitas akibat kelalaian pemain menjadi tanggung jawab pemesan.",
      updated_at: stamp,
    },
    faqs: { items: scenario.faqs.map(([question, answer]) => ({ id: randomUUID(), question, answer })), updated_at: stamp },
  };
  for (const [key, document] of Object.entries(documents))
    db.prepare("INSERT OR IGNORE INTO settings (key, document) VALUES (?, ?)").run(key, JSON.stringify(document));

  console.log(`Data contoh ${scenario.label} dibuat: ${scenario.floors.length} lantai, ${ids.length} lapangan, ${scenario.rules.length} tarif khusus, ${scenario.reservations.length} booking, ${addonIds.length} item sewa & tambahan, ${scenario.features.length} elemen denah, info venue, kebijakan, dan FAQ.`);
  console.log(`Tanggal yang terisi: ${day(0)} (hari ini), ${day(1)}, ${day(2)}.`);
});
// Contoh pembukuan: setoran modal, biaya operasional dua bulan terakhir, satu tagihan pemasok yang
// belum dibayar, dan satu pemasukan di luar booking, supaya laporan keuangan langsung ada isinya.
if (!(db.prepare("SELECT 1 FROM finance_records LIMIT 1").get())) {
  const account = (code: string) => (db.prepare("SELECT id FROM accounts WHERE code=?").get(code) as { id: string }).id;
  const kas = account("1-100"), bank = account("1-200");
  const supplier = savePartner({ name: "Toko Olahraga Sentosa", kind: "pemasok", phone: "081200001111", note: "Bola, grip, dan perlengkapan lapangan.", active: true }, actor);
  createEquity({ date: day(-40), direction: "setor", cash_account_id: bank, amount: 20000000, memo: "Setoran modal awal pemilik" }, actor);
  createTransfer({ date: day(-38), from_account_id: bank, to_account_id: kas, amount: 3000000, memo: "Isi kas kasir dari rekening venue" }, actor);
  const samples: [number, "pengeluaran" | "pemasukan", string, number, string | null, string][] = [
    [-35, "pengeluaran", "5-300", 4000000, bank, "Sewa tempat bulan lalu"],
    [-32, "pengeluaran", "5-100", 3500000, bank, "Gaji staf bulan lalu"],
    [-30, "pengeluaran", "5-200", 950000, bank, "Listrik dan internet bulan lalu"],
    [-8, "pengeluaran", "5-100", 3500000, bank, "Gaji staf bulan ini"],
    [-6, "pengeluaran", "5-200", 1020000, bank, "Token listrik dan tagihan internet"],
    [-5, "pengeluaran", "5-700", 600000, kas, "Jasa kebersihan mingguan"],
    [-4, "pengeluaran", "5-500", 1250000, null, "Bola latihan 10 tabung"],
    [-2, "pengeluaran", "5-600", 450000, kas, "Iklan Instagram turnamen internal"],
    [-1, "pengeluaran", "5-400", 800000, kas, "Servis lampu lapangan 2"],
    [-1, "pemasukan", "4-900", 2500000, bank, "Sewa venue untuk turnamen komunitas"],
  ];
  for (const [offset, kind, code, amount, cash, description] of samples) {
    saveRecord({
      kind, date: day(offset), account_id: account(code), amount, description,
      settle: cash ? "tunai" : "tempo", cash_account_id: cash,
      partner_id: cash ? null : supplier.id, due_date: cash ? "" : day(10),
    }, actor);
  }
  console.log(`Contoh pembukuan dibuat: ${samples.length} catatan keuangan, 1 pemasok, dan setoran modal awal.`);
}
db.close();

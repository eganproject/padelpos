import { randomUUID } from "node:crypto";
import { db, transaction } from "./store.js";
import { localClock, priceRules, quote } from "./operations.js";

const force = process.argv.includes("--force");
const existing = db.prepare("SELECT count(*) n FROM courts").get() as { n: number };
if (existing.n && !force) {
  console.log(`Sudah ada ${existing.n} lapangan. Jalankan dengan --force untuk menambah data contoh lagi.`);
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

// Posisi denah dalam unit kanvas (1 unit = 0,1 m), dijajarkan agar langsung rapi di editor.
const courts = [
  { name: "Center Court", hourly_rate: 350000, opens_at: "06:00", closes_at: "23:00", x: 40, y: 60, environment: "indoor", surface: "Karpet akrilik",
    description: "Lapangan utama berdinding kaca panoramik dengan tribun penonton. Pencahayaan LED merata, cocok untuk turnamen dan main malam." },
  { name: "Court 2", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", x: 180, y: 60, environment: "indoor", surface: "Rumput sintetis",
    description: "Lapangan indoor beratap penuh, tetap nyaman dipakai saat hujan. Pilihan favorit untuk main santai bersama teman." },
  { name: "Court 3 (Outdoor)", hourly_rate: 250000, opens_at: "07:00", closes_at: "21:00", x: 320, y: 60, environment: "outdoor", surface: "Rumput sintetis",
    description: "Lapangan terbuka dengan udara segar dan tarif paling hemat. Tidak dapat dipakai saat hujan deras." },
];

transaction(() => {
  const ids = courts.map(court => {
    const id = randomUUID();
    db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,active,created_at,layout_x,layout_y,layout_w,layout_h,description,environment,surface) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, court.name, court.hourly_rate, court.opens_at, court.closes_at, 1, new Date().toISOString(), court.x, court.y, 100, 200, court.description, court.environment, court.surface);
    return { id, ...court };
  });

  // Tarif khusus: jam sibuk hari kerja dan akhir pekan. Court 3 hanya naik di akhir pekan.
  const rules: [label: string, days: number[], start: string, end: string, rate: number, courts: number[]][] = [
    ["Jam sibuk", [1, 2, 3, 4, 5], "17:00", "22:00", 450000, [0]],
    ["Jam sibuk", [1, 2, 3, 4, 5], "17:00", "22:00", 400000, [1]],
    ["Akhir pekan", [0, 6], "06:00", "23:00", 450000, [0]],
    ["Akhir pekan", [0, 6], "06:00", "23:00", 400000, [1]],
    ["Akhir pekan", [0, 6], "07:00", "21:00", 300000, [2]],
  ];
  for (const [label, days, start, end, rate, targets] of rules) {
    const id = randomUUID();
    db.prepare("INSERT INTO price_rules (id,label,days,start_time,end_time,hourly_rate,created_at) VALUES (?,?,?,?,?,?,?)").run(id, label, JSON.stringify(days), start, end, rate, new Date().toISOString());
    for (const index of targets) db.prepare("INSERT INTO price_rule_courts (rule_id,court_id) VALUES (?,?)").run(id, ids[index].id);
  }

  const reservations = [
    { court: 0, date: day(0), start: "18:00", end: "19:30", customer: "Andi Pratama", phone: "081234567001" },
    { court: 1, date: day(0), start: "19:00", end: "20:00", customer: "Rina Kusuma", phone: "081234567002" },
    { court: 0, date: day(1), start: "07:00", end: "08:30", customer: "Komunitas Padel Pagi", phone: "081234567003" },
    { court: 2, date: day(1), start: "16:00", end: "18:00", customer: "Dimas Herlambang", phone: "081234567004" },
    { court: 1, date: day(2), start: "20:00", end: "21:00", customer: "Sari Wulandari", phone: "081234567005" },
  ];
  const activeRules = priceRules();
  for (const item of reservations) {
    const court = ids[item.court];
    const total = quote(court, activeRules, item.date, item.start, item.end);
    db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), court.id, item.customer, item.phone, item.date, item.start, item.end, total, "confirmed", "", actor, new Date().toISOString());
  }

  db.prepare("INSERT INTO maintenance (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), ids[2].id, day(1), "09:00", "11:00", "Perawatan rumput sintetis");

  // Elemen penjelas denah: hanya informasi, tidak memengaruhi jadwal.
  const decor: [string, string, number, number, number, number][] = [
    ["jalan", "", 40, 280, 380, 30],
    ["resepsionis", "", 40, 330, 70, 40],
    ["kantin", "Kantin & lounge", 130, 330, 120, 60],
    ["tempat-duduk", "Tribun penonton", 270, 330, 90, 50],
    ["toilet", "", 380, 330, 50, 40],
    ["parkir", "", 450, 60, 110, 200],
  ];
  for (const [kind, label, x, y, w, h] of decor) {
    db.prepare("INSERT INTO venue_features (id,kind,label,x,y,w,h,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), kind, label, x, y, w, h, new Date().toISOString());
  }

  // Info venue contoh. Alamat dan nomor sengaja berbentuk contoh agar tidak tertukar dengan data asli.
  // INSERT OR IGNORE: info yang sudah diisi admin tidak pernah ditimpa, termasuk saat --force.
  const stamp = new Date().toISOString();
  const documents: Record<string, object> = {
    info: {
      name: "Padelix Arena", tagline: "Tiga lapangan padel di tengah kota, buka setiap hari.",
      about: "Padelix Arena menyediakan dua lapangan indoor dan satu lapangan outdoor dengan standar ukuran internasional.\n\nCocok untuk pemula yang baru mencoba padel maupun komunitas yang rutin bermain. Tim kami siap membantu menyiapkan raket dan bola.",
      address: "Jl. Contoh Raya No. 10, Kebayoran Baru, Jakarta Selatan", maps_url: "", show_map: true,
      whatsapp: "6281234567890", phone: "", email: "halo@contoh.test", instagram: "padelix.contoh",
      hours_note: "Setiap hari, 06.00–23.00", facilities: ["parkir", "toilet", "kamar-bilas", "musala", "kantin", "wifi", "sewa-raket", "sewa-bola"],
      extra_facilities: [], updated_at: stamp,
    },
    policies: {
      refund_tiers: [{ hours: 24, percent: 100 }, { hours: 6, percent: 50 }], refund_days: 3, reschedule: "yes", reschedule_hours: 12,
      cancellation_note: "Pembatalan karena hujan deras di lapangan outdoor dapat dijadwalkan ulang tanpa biaya.",
      terms: "Harap datang 10 menit sebelum jam main untuk registrasi.\n\n- Wajib memakai sepatu olahraga bersol karet non-marking.\n- Maksimal 4 pemain aktif per lapangan.\n- Jam main berakhir tepat waktu agar pemesan berikutnya tidak menunggu.\n\nKerusakan fasilitas akibat kelalaian pemain menjadi tanggung jawab pemesan.",
      updated_at: stamp,
    },
    faqs: {
      items: [
        ["Apakah bisa sewa raket dan bola?", "Bisa. Raket dan bola tersedia di resepsionis dan dibayar langsung di tempat."],
        ["Berapa pemain dalam satu lapangan?", "Padel dimainkan berpasangan, jadi idealnya 4 pemain. Tetap boleh bermain berdua."],
        ["Apakah lapangan indoor tetap bisa dipakai saat hujan?", "Bisa. Center Court dan Court 2 beratap penuh."],
        ["Apakah tersedia tempat parkir?", "Tersedia parkir mobil dan motor di area venue."],
      ].map(([question, answer]) => ({ id: randomUUID(), question, answer })),
      updated_at: stamp,
    },
  };
  for (const [key, document] of Object.entries(documents))
    db.prepare("INSERT OR IGNORE INTO settings (key, document) VALUES (?, ?)").run(key, JSON.stringify(document));

  console.log(`Data contoh dibuat: ${ids.length} lapangan, ${rules.length} tarif khusus, ${reservations.length} booking, 1 maintenance, info venue, kebijakan, dan FAQ.`);
  console.log(`Tanggal yang terisi: ${day(0)} (hari ini), ${day(1)}, ${day(2)}.`);
});
db.close();

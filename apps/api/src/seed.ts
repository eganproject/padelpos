import { randomUUID } from "node:crypto";
import { db, transaction } from "./store.js";
import { localClock, minutes } from "./operations.js";

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
  { name: "Center Court", hourly_rate: 350000, opens_at: "06:00", closes_at: "23:00", x: 40, y: 60 },
  { name: "Court 2", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", x: 180, y: 60 },
  { name: "Court 3 (Outdoor)", hourly_rate: 250000, opens_at: "07:00", closes_at: "21:00", x: 320, y: 60 },
];

transaction(() => {
  const ids = courts.map(court => {
    const id = randomUUID();
    db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,active,created_at,layout_x,layout_y,layout_w,layout_h) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, court.name, court.hourly_rate, court.opens_at, court.closes_at, 1, new Date().toISOString(), court.x, court.y, 100, 200);
    return { id, ...court };
  });

  const reservations = [
    { court: 0, date: day(0), start: "18:00", end: "19:30", customer: "Andi Pratama", phone: "081234567001" },
    { court: 1, date: day(0), start: "19:00", end: "20:00", customer: "Rina Kusuma", phone: "081234567002" },
    { court: 0, date: day(1), start: "07:00", end: "08:30", customer: "Komunitas Padel Pagi", phone: "081234567003" },
    { court: 2, date: day(1), start: "16:00", end: "18:00", customer: "Dimas Herlambang", phone: "081234567004" },
    { court: 1, date: day(2), start: "20:00", end: "21:00", customer: "Sari Wulandari", phone: "081234567005" },
  ];
  for (const item of reservations) {
    const court = ids[item.court];
    const total = Math.round(court.hourly_rate * (minutes(item.end) - minutes(item.start)) / 60);
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

  console.log(`Data contoh dibuat: ${ids.length} lapangan, ${reservations.length} booking, 1 maintenance.`);
  console.log(`Tanggal yang terisi: ${day(0)} (hari ini), ${day(1)}, ${day(2)}.`);
});
db.close();

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-api-test-"));
process.env.DATA_DIR = directory;
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("operational workflow, concurrency, permissions and durable storage", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port:number };
  const base = `http://127.0.0.1:${address.port}/api`;
  async function request(url:string, method="GET", body?:unknown, cookie="", origin="http://localhost:3000") {
    const response = await fetch(base+url, {method, headers:{"Content-Type":"application/json", Cookie:cookie, Origin:origin}, ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data = response.status===204?null:await response.json();
    return {status:response.status, data, cookie:response.headers.get("set-cookie")?.split(";")[0]||"", headers:response.headers};
  }
  const adminData={name:"Test Admin",email:"admin@example.test",phone:"081234567890",password:"StrongPass123"};
  let admin="", staff="",courtId="",bookingId="",staffId="";
  const tomorrowDate=new Date(localClock().date+"T12:00:00Z"); tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
  const tomorrow=tomorrowDate.toISOString().slice(0,10);
  const court={name:"Centre Court",hourly_rate:300000,opens_at:"06:00",closes_at:"24:00",active:true};
  const booking=(overrides={})=>({court_id:courtId,customer:"Test Customer",phone:"081234567891",date:tomorrow,start_time:"09:00",end_time:"10:30",notes:"Test booking",...overrides});
  const payment=(amount:number,kind="payment",overrides={})=>({id:randomUUID(),amount,kind,method:"transfer",note:kind==="refund"?"Booking cancelled":"",...overrides});
  try {
    await t.test("admin bootstrap closes registration and uses HttpOnly cookies",async()=>{
      assert.equal((await request("/auth/setup")).data.available,true);
      const result=await request("/auth/register","POST",adminData);
      assert.equal(result.status,201); admin=result.cookie;
      assert.ok(result.headers.get("set-cookie")?.includes("HttpOnly"));assert.equal(result.data.token,undefined);
      assert.equal(result.data.user.passwordHash,undefined);
      assert.equal((await request("/auth/register","POST",{...adminData,email:"another@example.test"})).status,403);
      assert.equal((await request("/auth/login","POST",{email:adminData.email,password:"wrong"})).status,401);
      assert.equal((await request("/operations/courts")).status,401);
      assert.equal((await request("/operations/courts","POST",court,admin,"https://untrusted.example")).status,403);
    });
    await t.test("staff cannot grant permissions even when menu access is assigned",async()=>{
      const result=await request("/access/users","POST",{...adminData,email:"staff@example.test",name:"Test Staff",role:"staff"},admin);
      assert.equal(result.status,201);staffId=result.data.user.id;
      staff=(await request("/auth/login","POST",{email:"staff@example.test",password:adminData.password})).cookie;
      assert.equal((await request("/access/overview","GET",undefined,staff)).status,403);
      const role=await request("/access/roles/staff","PUT",{name:"Operator",slug:"staff",description:"test",menuIds:["dashboard","bookings","courts","profile","users","roles"]},admin);
      assert.equal(role.status,200);
      assert.equal((await request("/access/users","POST",{...adminData,email:"intruder@example.test",role:"admin"},staff)).status,403);
      assert.equal((await request("/access/users/"+staffId,"PUT",{name:"Test Staff",email:"staff@example.test",phone:"081234567890",role:"staff"},admin)).status,200);
    });
    await t.test("court validation and integer pricing",async()=>{
      assert.equal((await request("/operations/courts","POST",{...court,closes_at:"05:00"},admin)).status,400);
      assert.equal((await request("/operations/courts","POST",{...court,hourly_rate:-1},admin)).status,400);
      const result=await request("/operations/courts","POST",court,staff);
      assert.equal(result.status,201);courtId=result.data.court.id;
      assert.equal((await request("/operations/courts","POST",{...court,name:"centre court"},admin)).status,409);
      assert.equal((await request("/operations/bookings","POST",booking({start_time:"05:30",end_time:"06:30"}),staff)).status,400);
      assert.equal((await request("/operations/bookings","POST",booking({date:"2026-02-30"}),staff)).status,400);
      assert.equal((await request("/operations/bookings","POST",booking({date:"2000-01-01"}),staff)).status,400);
      assert.equal((await request("/operations/bookings","POST",booking({start_time:"09:15"}),staff)).status,400);
    });
    await t.test("simultaneous overlapping requests: only one booking is accepted",async()=>{
      const results=await Promise.all([request("/operations/bookings","POST",booking({total:1}),staff),request("/operations/bookings","POST",booking(),staff)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const result=results.find(r=>r.status===201)!;bookingId=result.data.booking.id;
      assert.equal(result.data.booking.total,450000);
      assert.equal((await request("/operations/bookings","POST",booking({start_time:"10:00",end_time:"11:00"}),staff)).status,409);
      assert.equal((await request("/operations/bookings","POST",booking({start_time:"10:30",end_time:"11:00"}),staff)).status,201);
    });
    await t.test("maintenance blocks bookings and preserves existing reservations",async()=>{
      const maintenance={court_id:courtId,date:tomorrow,start_time:"09:30",end_time:"10:00",reason:"Repair net"};
      assert.equal((await request("/operations/maintenance","POST",maintenance,staff)).status,409);
      const result=await request("/operations/maintenance","POST",{...maintenance,start_time:"12:00",end_time:"13:00"},staff);
      assert.equal(result.status,201);
      assert.equal((await request("/operations/bookings","POST",booking({start_time:"12:30",end_time:"13:30"}),staff)).status,409);
      assert.equal((await request("/operations/maintenance/"+result.data.maintenance.id,"DELETE",undefined,staff)).status,204);
      assert.equal((await request("/operations/courts/"+courtId,"PUT",{...court,active:false},staff)).status,409);
      assert.equal((await request("/operations/courts/"+courtId,"PUT",{...court,opens_at:"10:00"},staff)).status,409);
      assert.equal((await request("/operations/courts/"+courtId,"PUT",{...court,hourly_rate:400000},staff)).status,200);
      assert.equal((await request("/operations/bookings/"+bookingId,"GET",undefined,staff)).data.booking.total,450000);
    });
    await t.test("partial payments, retry idempotency and overpayment prevention",async()=>{
      const entry=payment(150000);
      const first=await request(`/operations/bookings/${bookingId}/payments`,"POST",entry,staff);
      assert.equal(first.status,201);assert.equal(first.data.booking.paid,150000);
      const retry=await request(`/operations/bookings/${bookingId}/payments`,"POST",entry,staff);
      assert.equal(retry.data.booking.paid,150000);assert.equal(retry.data.payments.length,1);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",{...entry,amount:150001},staff)).status,409);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(300001),staff)).status,400);
      const results=await Promise.all([request(`/operations/bookings/${bookingId}/payments`,"POST",payment(300000),staff),request(`/operations/bookings/${bookingId}/payments`,"POST",payment(300000),staff)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);
      assert.equal((await request(`/operations/bookings/${bookingId}/status`,"PATCH",{status:"completed"},staff)).status,409);
    });
    await t.test("cancellation releases schedule and refunds are separate, bounded records",async()=>{
      assert.equal((await request(`/operations/bookings/${bookingId}/status`,"PATCH",{status:"cancelled"},staff)).status,400);
      assert.equal((await request(`/operations/bookings/${bookingId}/status`,"PATCH",{status:"cancelled",reason:"Customer requested"},staff)).status,200);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(1),staff)).status,409);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(450001,"refund"),staff)).status,400);
      const refund=await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(450000,"refund"),staff);
      assert.equal(refund.status,201);assert.equal(refund.data.booking.paid,0);assert.equal(refund.data.payments.length,3);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(1,"refund"),staff)).status,400);
      assert.equal((await request("/operations/bookings","POST",booking(),staff)).status,201);
    });
    await t.test("dashboard uses recorded payments and database survives a new connection",async()=>{
      const summary=await request("/dashboard/summary","GET",undefined,admin);
      assert.equal(summary.status,200);assert.equal(summary.data.revenueToday,0);assert.equal(summary.data.refundsDue,0);
      assert.equal(summary.data.bookingsToday,0);assert.equal(summary.data.daily.length,7);assert.equal(summary.data.courts.length,1);
      const child=spawnSync(process.execPath,["--input-type=module","-e","import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.env.TEST_DB);console.log(db.prepare('SELECT count(*) n FROM bookings').get().n);db.close();"],{env:{...process.env,TEST_DB:path.join(directory,"padelix.sqlite")},encoding:"utf8"});
      assert.equal(child.status,0,child.stderr);assert.equal(Number(child.stdout.trim()),3);
    });
    await t.test("completion requires elapsed time and full payment",async()=>{
      const result=await request("/operations/bookings","POST",booking({start_time:"15:00",end_time:"16:00"}),staff),id=result.data.booking.id;
      const yesterday=new Date(localClock().date+"T12:00:00Z");yesterday.setUTCDate(yesterday.getUTCDate()-1);
      db.prepare("UPDATE bookings SET date=? WHERE id=?").run(yesterday.toISOString().slice(0,10),id);
      assert.equal((await request(`/operations/bookings/${id}/status`,"PATCH",{status:"completed"},staff)).status,409);
      assert.equal((await request(`/operations/bookings/${id}/payments`,"POST",payment(400000),staff)).status,201);
      assert.equal((await request(`/operations/bookings/${id}/status`,"PATCH",{status:"completed"},staff)).status,200);
      assert.equal((await request(`/operations/bookings/${id}/status`,"PATCH",{status:"cancelled",reason:"Too late"},staff)).status,409);
      assert.equal((await request("/dashboard/summary","GET",undefined,admin)).data.revenueToday,400000);
    });
    await t.test("role rename updates users and reserved admin access remains protected",async()=>{
      const role=await request("/access/roles","POST",{name:"Cashier",slug:"cashier",description:"cashier",menuIds:["bookings","profile"]},admin);
      assert.equal(role.status,201);
      await request("/access/users/"+staffId,"PUT",{name:"Test Staff",email:"staff@example.test",phone:"081234567890",role:"cashier"},admin);
      assert.equal((await request("/access/roles/"+role.data.role.id,"PUT",{name:"Cashier new",slug:"cashier-new",description:"cashier",menuIds:["bookings","profile"]},admin)).status,200);
      assert.equal((await request("/auth/me","GET",undefined,staff)).data.user.role,"cashier-new");
      assert.equal((await request("/operations/courts","GET",undefined,staff)).status,403);
      assert.equal((await request("/operations/context","GET",undefined,staff)).status,200);
      assert.equal((await request("/access/roles/admin","PUT",{name:"Admin",slug:"admin",description:"test",menuIds:[]},admin)).status,400);
      assert.equal((await request("/access/menus/users","DELETE",undefined,admin)).status,400);
    });
    await t.test("layout venue: hanya peran berhak, tolak tumpang tindih dan yang keluar area",async()=>{
      assert.equal((await request("/operations/layout","GET",undefined,staff)).status,403,"peran tanpa menu layout harus ditolak");
      const before=await request("/operations/layout","GET",undefined,admin);
      assert.equal(before.status,200);
      const venue=before.data.venue;
      assert.ok(venue.width>0&&venue.height>0&&venue.grid>0);
      const extra=await request("/operations/courts","POST",{name:"Court B",hourly_rate:250000,opens_at:"06:00",closes_at:"22:00",active:true},admin);
      assert.equal(extra.status,201);
      const a=courtId,b=extra.data.court.id;
      assert.equal((await request("/operations/layout","PUT",{venue,courts:[{id:a,x:0,y:0,w:100,h:200},{id:b,x:50,y:0,w:100,h:200}]},admin)).status,409,"dua lapangan yang menimpa harus ditolak");
      assert.equal((await request("/operations/layout","PUT",{venue,courts:[{id:a,x:venue.width-10,y:0,w:100,h:200}]},admin)).status,400,"lapangan yang keluar area harus ditolak");
      assert.equal((await request("/operations/layout","PUT",{venue,courts:[{id:"tidak-ada",x:0,y:0,w:100,h:200}]},admin)).status,404);
      const saved=await request("/operations/layout","PUT",{venue:{...venue,width:800},courts:[{id:a,x:10,y:20,w:100,h:200},{id:b,x:200,y:20,w:200,h:100}]},admin);
      assert.equal(saved.status,200);
      const after=await request("/operations/layout","GET",undefined,admin);
      assert.equal(after.data.venue.width,800);
      const first=after.data.courts.find((c:{id:string})=>c.id===a),second=after.data.courts.find((c:{id:string})=>c.id===b);
      assert.equal(first.layout_x,10);assert.equal(first.layout_y,20);
      assert.equal(second.layout_w,200);assert.equal(second.layout_h,100,"menukar lebar dan tinggi menggantikan rotasi");
      assert.equal((await request("/operations/courts/"+b,"DELETE",undefined,admin)).status,204,"lapangan tanpa booking boleh dihapus");
      assert.equal((await request("/operations/courts/"+a,"DELETE",undefined,admin)).status,409,"lapangan yang punya riwayat booking harus dipertahankan");
    });
    await t.test("elemen informasi denah: tersimpan, boleh bertumpuk, wajib di dalam area",async()=>{
      const before=await request("/operations/layout","GET",undefined,admin);
      const venue=before.data.venue,courts=before.data.courts.map((c:{id:string;layout_x:number;layout_y:number;layout_w:number;layout_h:number})=>({id:c.id,x:c.layout_x,y:c.layout_y,w:c.layout_w,h:c.layout_h}));
      const kantin={id:randomUUID(),kind:"kantin",label:"Kantin & lounge",x:0,y:300,w:120,h:60};
      const kursi={id:randomUUID(),kind:"tempat-duduk",label:"",x:40,y:320,w:60,h:30};
      const ditolak=await request("/operations/layout","PUT",{venue,courts,features:[{...kantin,x:venue.width-10,w:120}]},admin);
      assert.equal(ditolak.status,400,"elemen yang keluar area harus ditolak");
      assert.equal((await request("/operations/layout","PUT",{venue,courts,features:[{...kantin,kind:"kolam-renang"}]},admin)).status,400,"jenis di luar daftar harus ditolak");
      // Bertumpuk sengaja diizinkan: elemen ini hanya keterangan, bukan jadwal.
      const disimpan=await request("/operations/layout","PUT",{venue,courts,features:[kantin,kursi]},admin);
      assert.equal(disimpan.status,200,"dua elemen yang bertumpuk harus tetap boleh disimpan");
      assert.equal(disimpan.data.features.length,2);
      const tersimpan=disimpan.data.features.find((f:{id:string})=>f.id===kantin.id);
      assert.equal(tersimpan.label,"Kantin & lounge");assert.equal(tersimpan.kind,"kantin");
      // Daftar bersifat lengkap: yang tidak dikirim berarti dihapus.
      const dikurangi=await request("/operations/layout","PUT",{venue,courts,features:[kantin]},admin);
      assert.equal(dikurangi.data.features.length,1,"elemen yang tidak ikut dikirim harus terhapus");
      assert.equal(dikurangi.data.features[0].id,kantin.id);
      // Menghilangkan kunci features sama sekali tidak boleh menghapus apa pun.
      const tanpaKunci=await request("/operations/layout","PUT",{venue,courts},admin);
      assert.equal(tanpaKunci.data.features.length,1,"tanpa kunci features, elemen lama harus dipertahankan");
    });
    await t.test("endpoint publik membuka jadwal tanpa membocorkan data pemesan",async()=>{
      const open=await request("/public/availability?date="+tomorrow,"GET");
      assert.equal(open.status,200,"halaman pelanggan tidak memerlukan sesi");
      const body=JSON.stringify(open.data);
      assert.ok(!body.includes("Test Customer"),"nama pemesan tidak boleh ikut terkirim");
      assert.ok(!body.includes("081234567891"),"nomor telepon pemesan tidak boleh ikut terkirim");
      assert.ok(!body.includes("Test booking"),"catatan booking tidak boleh ikut terkirim");
      assert.ok(open.data.courts.length>0);
      const centre=open.data.courts.find((entry:{court:{id:string}})=>entry.court.id===courtId);
      assert.ok(centre.court.layout,"layout harus ikut agar denah bisa digambar pelanggan");
      assert.ok(centre.slots.some((slot:{state:string})=>slot.state==="booked"),"slot terisi harus terlihat sebagai sudah dipesan");
      assert.ok(centre.slots.every((slot:{start:string})=>slot.start>=centre.court.opens_at));
      assert.equal((await request("/public/availability?date=2000-01-01","GET")).status,400,"tanggal lampau ditolak");
      assert.equal((await request("/public/availability?date=2099-01-01","GET")).status,400,"jadwal terlalu jauh ke depan ditolak");
      const venue=await request("/public/venue","GET");
      assert.equal(venue.status,200);
      assert.ok(venue.data.venue.width>0&&venue.data.courts.length>0);
      assert.ok(Array.isArray(venue.data.features)&&venue.data.features.length>0,"elemen informasi harus ikut agar denah pelanggan lengkap");
      assert.ok(Array.isArray(open.data.features),"ketersediaan harian juga membawa elemen informasi");
    });
    await t.test("password change revokes previous sessions; logout revokes server session",async()=>{
      const second=(await request("/auth/login","POST",{email:adminData.email,password:adminData.password})).cookie;
      const changed=await request("/profile/password","PUT",{currentPassword:adminData.password,newPassword:"NewStrongPass123"},admin);
      assert.equal(changed.status,200);
      assert.equal((await request("/auth/me","GET",undefined,second)).status,401);
      assert.equal((await request("/auth/me","GET",undefined,admin)).status,401);
      admin=changed.cookie;assert.equal((await request("/auth/me","GET",undefined,admin)).status,200);
      assert.equal((await request("/auth/logout","POST",{},admin)).status,204);
      assert.equal((await request("/auth/me","GET",undefined,admin)).status,401);
    });
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+"padelix-api-test-"));
    rmSync(directory,{recursive:true,force:true});
  }
});

test("legacy JSON is migrated once and original files are preserved",()=>{
  const legacy=mkdtempSync(path.join(tmpdir(),"padelix-migration-test-"));
  const user={id:"legacy-user",name:"Legacy",email:"legacy@example.test",phone:"081234567890",passwordHash:"existing-hash",role:"admin",createdAt:"2026-01-01T00:00:00Z"};
  const original=JSON.stringify([user]);writeFileSync(path.join(legacy,"users.json"),original);
  const script="const {getUsers,db}=await import('./src/store.ts');console.log(JSON.stringify(getUsers()));db.close();";
  try {
    const run=()=>spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{env:{...process.env,DATA_DIR:legacy},encoding:"utf8"});
    const first=run();assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout.trim()),[user]);
    writeFileSync(path.join(legacy,"users.json"),"[]");
    const second=run();assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout.trim()),[user]);
  } finally {
    assert.ok(path.resolve(legacy).startsWith(path.resolve(tmpdir())+path.sep+"padelix-migration-test-"));
    rmSync(legacy,{recursive:true,force:true});
  }
});

const schemaV1 = `
  CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)));
  CREATE TABLE roles (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)));
  CREATE TABLE menus (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)));
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0), opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, court_id TEXT NOT NULL REFERENCES courts(id), customer TEXT NOT NULL, phone TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, total INTEGER NOT NULL CHECK(total > 0), status TEXT NOT NULL CHECK(status IN ('confirmed','completed','cancelled')), notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancel_reason TEXT NOT NULL DEFAULT '');
  CREATE INDEX bookings_schedule ON bookings(court_id,date,start_time,end_time);
  CREATE TABLE maintenance (id TEXT PRIMARY KEY, court_id TEXT NOT NULL REFERENCES courts(id), date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, reason TEXT NOT NULL);
  CREATE TABLE payments (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), amount INTEGER NOT NULL CHECK(amount > 0), kind TEXT NOT NULL CHECK(kind IN ('payment','refund')), method TEXT NOT NULL CHECK(method IN ('cash','transfer','qris')), note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX payments_booking ON payments(booking_id);
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TRIGGER maintenance_overlap BEFORE INSERT ON maintenance BEGIN
    SELECT RAISE(ABORT, 'schedule_conflict') WHERE EXISTS(SELECT 1 FROM bookings WHERE court_id=NEW.court_id AND date=NEW.date AND status <> 'cancelled' AND start_time < NEW.end_time AND end_time > NEW.start_time);
  END;
  INSERT INTO migrations VALUES (1, '2026-01-01T00:00:00Z');
`;

test("migrasi v1 ke v2 mempertahankan data lama dan memberlakukan aturan hold", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "padelix-v2-test-"));
  const file = path.join(directory, "padelix.sqlite");
  const stamp = "2026-01-01T00:00:00Z";
  const legacy = new DatabaseSync(file);
  legacy.exec(schemaV1);
  legacy.prepare("INSERT INTO courts VALUES (?,?,?,?,?,?,?)").run("c1", "Court A", 300000, "06:00", "24:00", 1, stamp);
  legacy.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("b1", "c1", "Budi", "081234567890", "2030-01-10", "09:00", "10:00", 300000, "confirmed", "catatan lama", "staff-1", stamp);
  legacy.prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?)").run("p1", "b1", 150000, "payment", "cash", "DP", "staff-1", stamp);
  legacy.close();

  try {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "const {db}=await import('./src/store.ts');db.close();"], { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    const db2 = new DatabaseSync(file);
    db2.exec("PRAGMA foreign_keys = ON");
    const one = (sql: string) => db2.prepare(sql).get() as Record<string, unknown>;
    const rejects = (work: () => void, fragment: string) => {
      try { work(); return `tidak menolak apa pun (harapan: ${fragment})`; }
      catch (error) { const message = (error as Error).message; return message.includes(fragment) ? "" : `pesan tidak sesuai: ${message}`; }
    };
    const insert = (id: string, start: string, end: string, status: string, extra: { hold?: number; source?: string; createdBy?: string | null; customerId?: string } = {}) => () =>
      db2.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at,hold_expires_at,source,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, "c1", "X", "081234567890", "2030-02-01", start, end, 300000, status, "", extra.createdBy === undefined ? "staff-1" : extra.createdBy, stamp, extra.hold ?? null, extra.source ?? "staff", extra.customerId ?? null);

    assert.equal(one("SELECT version FROM migrations WHERE version=2").version, 2, "migrasi 2 harus tercatat");
    const kept = one("SELECT * FROM bookings WHERE id='b1'");
    assert.equal(kept.notes, "catatan lama");
    assert.equal(kept.status, "confirmed");
    assert.equal(kept.source, "staff", "booking lama harus dianggap dibuat staf");
    assert.equal(kept.customer_id, null);
    assert.equal(kept.hold_expires_at, null);
    assert.equal(one("SELECT * FROM payments WHERE id='p1'").amount, 150000);
    assert.equal(one("SELECT * FROM payments WHERE id='p1'").source, "staff");
    assert.equal(db2.prepare("PRAGMA foreign_key_check").all().length, 0, "migrasi tidak boleh menyisakan foreign key menggantung");

    const active = Math.floor(Date.now() / 1000) + 600, lapsed = Math.floor(Date.now() / 1000) - 1;
    insert("h1", "09:00", "10:00", "pending", { hold: active })();
    assert.equal(rejects(insert("h2", "09:30", "10:30", "confirmed"), "schedule_conflict"), "", "hold yang masih aktif harus memblokir booking lain");
    insert("h3", "11:00", "12:00", "pending", { hold: lapsed })();
    insert("h4", "11:00", "12:00", "confirmed")();
    assert.equal(rejects(() => db2.prepare("UPDATE bookings SET status='confirmed' WHERE id='h3'").run(), "schedule_conflict"), "", "hold kedaluwarsa yang slotnya sudah direbut tidak boleh dikonfirmasi");
    db2.prepare("UPDATE bookings SET status='confirmed' WHERE id='h1'").run();
    assert.equal(one("SELECT status FROM bookings WHERE id='h1'").status, "confirmed", "hold yang masih sah harus bisa dikonfirmasi");

    insert("e1", "13:00", "14:00", "expired")();
    insert("e2", "13:00", "14:00", "confirmed")();

    assert.equal(rejects(insert("x1", "15:00", "16:00", "pending"), "CHECK"), "", "pending wajib punya hold_expires_at");
    assert.equal(rejects(insert("x2", "16:00", "17:00", "confirmed", { source: "online", createdBy: null }), "CHECK"), "", "booking online wajib punya customer_id");
    assert.equal(rejects(insert("x3", "17:00", "18:00", "menunggu"), "CHECK"), "", "status di luar daftar harus ditolak");

    const gateway = (id: string, ref: string) => () => db2.prepare("INSERT INTO payments (id,booking_id,amount,kind,method,source,gateway_ref,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, "b1", 1000, "payment", "ewallet", "gateway", ref, "", null, stamp);
    gateway("pg1", "MID-123")();
    assert.equal(rejects(gateway("pg2", "MID-123"), "UNIQUE"), "", "gateway_ref ganda harus ditolak demi idempotensi webhook");
    db2.close();
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + "padelix-v2-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

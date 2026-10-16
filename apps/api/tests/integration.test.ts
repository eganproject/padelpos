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
      // Modul Keuangan dan Pelanggan sama-sama halaman bawaan: path-nya tidak boleh diubah atau menunya dihapus.
      assert.equal((await request("/access/menus/finance","DELETE",undefined,admin)).status,400);
      assert.equal((await request("/access/menus/customers","PUT",{name:"Pelanggan",path:"/admin/pelanggan",icon:"Contact",group:"Operasional",order:3,active:true},admin)).status,400);
      const invalid=await request("/access/roles","POST",{name:"Kasir Malam",slug:"Kasir Malam",description:"",menuIds:[]},admin);
      assert.equal(invalid.status,400);assert.match(invalid.data.message,/huruf kecil/);
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
    await t.test("lantai: denah per lantai, koordinat sama boleh di lantai berbeda",async()=>{
      const before=await request("/operations/layout","GET",undefined,admin);
      assert.equal(before.data.floors.length,1,"denah lama menjadi satu lantai");
      const [ground]=before.data.floors;
      const grid=before.data.venue.grid;
      const upper=await request("/operations/courts","POST",{name:"Rooftop Uji",hourly_rate:250000,opens_at:"07:00",closes_at:"22:00",active:true},admin);
      assert.equal(upper.status,201);
      assert.equal(upper.data.court.floor_id,ground.id,"lapangan baru masuk ke lantai pertama");
      const upperId=upper.data.court.id,roof={id:"lantai-atas",name:"Rooftop",width:400,height:300};
      const floorPlan=[{id:ground.id,name:ground.name,width:ground.width,height:ground.height},roof];
      const box={x:10,y:20,w:100,h:200};
      const features=before.data.features.map((f:{id:string;kind:string;label:string;x:number;y:number;w:number;h:number;floor_id:string})=>({id:f.id,kind:f.kind,label:f.label,x:f.x,y:f.y,w:f.w,h:f.h,floor_id:f.floor_id}));
      const stairs={id:randomUUID(),kind:"tangga",label:"",x:300,y:0,w:40,h:60,floor_id:roof.id};
      const plan=(courts:unknown[],extra:object={})=>({venue:{grid},floors:floorPlan,courts,features:[...features,stairs],...extra});
      assert.equal((await request("/operations/layout","PUT",plan([{id:courtId,floor_id:ground.id,...box},{id:upperId,floor_id:ground.id,...box}]),admin)).status,409,"dua lapangan di lantai yang sama tidak boleh menimpa");
      const saved=await request("/operations/layout","PUT",plan([{id:courtId,floor_id:ground.id,...box},{id:upperId,floor_id:roof.id,...box}]),admin);
      assert.equal(saved.status,200,"koordinat sama di lantai berbeda boleh");
      assert.deepEqual(saved.data.floors.map((f:{name:string})=>f.name),[ground.name,"Rooftop"]);
      assert.equal(saved.data.courts.find((c:{id:string})=>c.id===upperId).floor_id,roof.id);
      assert.equal((await request("/operations/layout","PUT",plan([{id:upperId,floor_id:roof.id,x:350,y:0,w:100,h:200}]),admin)).status,400,"batas area dicek terhadap ukuran lantainya sendiri");
      assert.equal((await request("/operations/layout","PUT",plan([],{floors:[...floorPlan,{id:"lain",name:"rooftop",width:300,height:300}]}),admin)).status,409,"nama lantai tidak boleh sama");
      assert.equal((await request("/operations/layout","PUT",plan([],{floors:[floorPlan[0]]}),admin)).status,409,"lantai yang masih berisi tidak boleh dihapus");
      const open=await request("/public/availability?date="+tomorrow,"GET");
      assert.equal(open.data.floors.length,2,"pelanggan menerima daftar lantai");
      assert.equal(open.data.courts.find((entry:{court:{id:string}})=>entry.court.id===upperId).court.floor_id,roof.id);
      assert.equal(open.data.features.find((f:{id:string})=>f.id===stairs.id).floor_id,roof.id);
      // Kosongkan lantai atas, lalu lantainya boleh dihapus.
      assert.equal((await request("/operations/courts/"+upperId,"DELETE",undefined,admin)).status,204);
      const removed=await request("/operations/layout","PUT",{venue:{grid},floors:[floorPlan[0]],courts:[],features},admin);
      assert.equal(removed.status,200);assert.equal(removed.data.floors.length,1);
    });
    await t.test("tarif khusus: harga per slot, tolak tumpang tindih, dan tidak mengubah booking lama",async()=>{
      const day=new Date(tomorrow+"T12:00:00Z").getUTCDay(),other=(day+1)%7;
      const rule={label:"Jam sibuk",court_ids:[courtId],days:[day],start_time:"18:00",end_time:"20:00",hourly_rate:500000};
      assert.equal((await request("/operations/price-rules","POST",rule,staff)).status,403,"peran tanpa menu courts tidak boleh mengatur tarif");
      assert.equal((await request("/operations/price-rules","POST",{...rule,start_time:"20:00",end_time:"18:00"},admin)).status,400);
      assert.equal((await request("/operations/price-rules","POST",{...rule,court_ids:["tidak-ada"]},admin)).status,404);
      const created=await request("/operations/price-rules","POST",rule,admin);
      assert.equal(created.status,201);
      const ruleId=created.data.price_rules[0].id;
      const clash=await request("/operations/price-rules","POST",{...rule,label:"Promo",start_time:"19:30",end_time:"21:00"},admin);
      assert.equal(clash.status,409,"dua tarif pada lapangan, hari, dan jam yang sama harus ditolak");
      assert.match(clash.data.message,/Jam sibuk/);
      assert.equal((await request("/operations/price-rules","POST",{...rule,label:"Hari lain",days:[other]},admin)).status,201,"hari berbeda tidak bentrok");
      // 17:30–18:30 = 30 menit tarif dasar 400.000 + 30 menit tarif khusus 500.000.
      const mixed=await request("/operations/bookings","POST",booking({start_time:"17:30",end_time:"18:30"}),admin);
      assert.equal(mixed.status,201);assert.equal(mixed.data.booking.total,450000);
      const open=await request("/public/availability?date="+tomorrow,"GET");
      const slots=open.data.courts.find((entry:{court:{id:string}})=>entry.court.id===courtId).slots;
      const at=(start:string)=>slots.find((slot:{start:string})=>slot.start===start);
      assert.equal(at("18:00").rate,500000);assert.equal(at("18:00").rule,"Jam sibuk");
      assert.equal(at("17:00").rate,400000);assert.equal(at("17:00").rule,null);
      const info=await request("/public/info","GET");
      const court=info.data.courts.find((c:{id:string})=>c.id===courtId);
      assert.equal(court.rate_min,400000);assert.equal(court.rate_max,500000);
      assert.equal((await request("/operations/price-rules/"+ruleId,"DELETE",undefined,admin)).status,204);
      assert.equal((await request("/operations/bookings/"+mixed.data.booking.id,"GET",undefined,admin)).data.booking.total,450000,"menghapus tarif tidak mengubah tagihan yang sudah dibuat");
    });
    await t.test("foto lapangan: hanya gambar asli, dibatasi jumlahnya, dan dapat dilihat publik",async()=>{
      const upload=(body:Buffer,type="image/png",cookie=admin)=>fetch(`${base}/operations/courts/${courtId}/photos`,{method:"POST",headers:{"Content-Type":type,Cookie:cookie,Origin:"http://localhost:3000"},body:new Uint8Array(body)});
      const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64,1)]);
      assert.equal((await upload(png,"image/png",staff)).status,403);
      assert.equal((await upload(Buffer.from("<svg onload=alert(1)>"),"image/svg+xml")).status,415,"SVG dapat berisi skrip, jadi ditolak");
      assert.equal((await upload(Buffer.from("bukan gambar sama sekali"),"image/png")).status,400,"isi berkas harus cocok dengan tipenya");
      let photos:{id:string}[]=[];
      for(let i=0;i<6;i++){const response=await upload(png);assert.equal(response.status,201);photos=(await response.json()).photos;}
      assert.equal((await upload(png)).status,409,"maksimal 6 foto per lapangan");
      const reversed=photos.map(p=>p.id).reverse();
      assert.equal((await request(`/operations/courts/${courtId}/photos/order`,"PUT",{ids:reversed.slice(1)},admin)).status,409,"urutan harus memuat semua foto");
      const ordered=await request(`/operations/courts/${courtId}/photos/order`,"PUT",{ids:reversed},admin);
      assert.deepEqual(ordered.data.photos.map((p:{id:string})=>p.id),reversed);
      const file=await fetch(`${base}/public/photos/${reversed[0]}`);
      assert.equal(file.status,200);assert.equal(file.headers.get("content-type"),"image/png");
      assert.ok(Buffer.from(await file.arrayBuffer()).equals(png));
      const removed=await request(`/operations/courts/${courtId}/photos/${reversed[0]}`,"DELETE",undefined,admin);
      assert.equal(removed.data.photos.length,5);assert.equal(removed.data.photos[0].position,0);
      const info=await request("/public/info","GET");
      assert.equal(info.data.courts.find((c:{id:string})=>c.id===courtId).photos[0],reversed[1],"sampul pindah ke foto berikutnya");
    });
    await t.test("sewa & tambahan: stok sewa per jam, stok jual, tagihan, pengembalian, dan pembatalan",async()=>{
      assert.ok((await request("/auth/navigation","GET",undefined,admin)).data.menus.some((m:{id:string})=>m.id==="addons"),"menu tambahan tersedia untuk admin");
      const courtA=(await request("/operations/courts","POST",{name:"Court Sewa A",hourly_rate:200000,opens_at:"06:00",closes_at:"23:00",active:true},admin)).data.court.id;
      const courtB=(await request("/operations/courts","POST",{name:"Court Sewa B",hourly_rate:200000,opens_at:"06:00",closes_at:"23:00",active:true},admin)).data.court.id;
      const item=(overrides={})=>({name:"Sewa raket",category:"raket",type:"sewa",pricing:"per_booking",price:30000,stock:2,low_stock:0,max_per_booking:2,description:"",active:true,online:true,...overrides});
      assert.equal((await request("/operations/addons","POST",item(),staff)).status,403,"peran tanpa menu tambahan tidak boleh mengubah katalog");
      assert.equal((await request("/operations/addons","POST",item({price:-1}),admin)).status,400);
      assert.equal((await request("/operations/addons","POST",item({type:"jual",pricing:"per_hour"}),admin)).status,400,"barang jual tidak dihitung per jam");
      const raket=(await request("/operations/addons","POST",item(),admin)).data.addon;
      assert.equal((await request("/operations/addons","POST",item({name:"sewa RAKET"}),admin)).status,409);
      const bolaData=item({name:"Bola padel",category:"bola",type:"jual",stock:5,low_stock:2,max_per_booking:10});
      const bola=(await request("/operations/addons","POST",bolaData,admin)).data.addon;
      const pelatih=(await request("/operations/addons","POST",item({name:"Pelatih",category:"pelatih",type:"layanan",pricing:"per_hour",price:200000,stock:1,max_per_booking:1,online:false}),admin)).data.addon;
      const slot=(court:string,start:string,end:string,addons:unknown[]=[])=>({court_id:court,customer:"Penyewa Uji",phone:"081234567899",date:tomorrow,start_time:start,end_time:end,notes:"",addons});

      const first=await request("/operations/bookings","POST",slot(courtA,"12:00","13:00",[{addon_id:raket.id,quantity:2},{addon_id:bola.id,quantity:3}]),staff);
      assert.equal(first.status,201,"kasir dengan akses booking boleh menambahkan tambahan");
      assert.equal(first.data.booking.court_total,200000);
      assert.equal(first.data.booking.total,200000+2*30000+3*30000);
      assert.equal((await request("/operations/bookings","POST",slot(courtB,"12:00","13:00",[{addon_id:raket.id,quantity:3}]),staff)).status,400,"melebihi batas per booking");
      const clash=await request("/operations/bookings","POST",slot(courtB,"12:30","13:30",[{addon_id:raket.id,quantity:1}]),staff);
      assert.equal(clash.status,409,"raket yang sedang dipakai booking lain tidak boleh disewakan ganda");
      assert.match(clash.data.message,/tersisa 0/);
      const listed=(await request("/operations/bookings","GET",undefined,staff)).data.bookings;
      assert.ok(!listed.some((b:{court_id:string;start_time:string})=>b.court_id===courtB&&b.start_time==="12:30"),"booking yang gagal karena stok tidak boleh tersimpan sebagian");
      const later=await request("/operations/bookings","POST",slot(courtB,"13:00","14:30",[{addon_id:raket.id,quantity:2},{addon_id:pelatih.id,quantity:1}]),staff);
      assert.equal(later.status,201,"raket tersedia lagi setelah jam main booking sebelumnya");
      assert.equal(later.data.booking.total,300000+60000+300000,"pelatih per jam dikali durasi 1,5 jam");

      const options=await request(`/operations/addons/options?date=${tomorrow}&start=12:00&end=13:00`,"GET",undefined,staff);
      assert.equal(options.status,200);
      const available=(list:{id:string;available:number|null}[],id:string)=>list.find(a=>a.id===id)?.available;
      assert.equal(available(options.data.addons,raket.id),0);
      assert.equal(available(options.data.addons,bola.id),2,"stok bola terpotong 3");
      const own=await request(`/operations/addons/options?date=${tomorrow}&start=12:00&end=13:00&booking=${first.data.booking.id}`,"GET",undefined,staff);
      assert.equal(available(own.data.addons,raket.id),2,"barang milik booking sendiri dihitung tersedia saat mengubah");
      const pub=await request(`/public/addons?date=${tomorrow}&start=12:00&end=13:00`,"GET");
      assert.equal(pub.status,200);
      assert.ok(!pub.data.addons.some((a:{id:string})=>a.id===pelatih.id),"item yang tidak tampil online disembunyikan dari pelanggan");
      assert.equal(available(pub.data.addons,raket.id),0);
      assert.ok(!JSON.stringify(pub.data).includes("Penyewa Uji"));

      const bookingId=first.data.booking.id;
      const lines=(await request(`/operations/bookings/${bookingId}`,"GET",undefined,staff)).data.addons as {id:string;addon_id:string}[];
      const raketLine=lines.find(l=>l.addon_id===raket.id)!,bolaLine=lines.find(l=>l.addon_id===bola.id)!;
      const edit=(body:unknown,id=bookingId)=>request(`/operations/bookings/${id}/addons`,"PUT",body,staff);
      assert.equal((await edit({lines:[{id:raketLine.id,quantity:2},{id:bolaLine.id,quantity:3},{addon_id:bola.id,quantity:1}]})).status,400,"item yang sama tidak boleh dua baris");
      assert.equal((await edit({lines:[{id:raketLine.id,quantity:2},{id:bolaLine.id,quantity:6}]})).status,409,"stok bola tidak cukup");
      assert.equal((await request(`/operations/addons/${bola.id}`,"PUT",{...bolaData,stock:2,price:50000},admin)).status,200);
      const changed=await edit({lines:[{id:bolaLine.id,quantity:1},{name:"Ganti grip",unit_price:15000,quantity:1}]});
      assert.equal(changed.status,200);
      assert.equal(changed.data.booking.total,200000+30000+15000,"raket dihapus, bola tetap harga lama, biaya lain ikut ditagih");
      const stockOf=async(id:string)=>(await request("/operations/addons","GET",undefined,admin)).data.addons.find((a:{id:string})=>a.id===id).stock;
      assert.equal(await stockOf(bola.id),4,"mengurangi bola mengembalikan stok");
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`,"POST",payment(240000),staff)).status,201);
      assert.equal((await edit({lines:[]})).status,409,"tagihan tidak boleh turun di bawah pembayaran yang diterima");

      assert.equal((await request(`/operations/addons/${bola.id}/stock`,"POST",{reason:"rusak",quantity:1,note:""},admin)).status,400,"barang rusak wajib diberi keterangan");
      assert.equal((await request(`/operations/addons/${bola.id}/stock`,"POST",{reason:"rusak",quantity:9,note:"Kempes"},admin)).status,400);
      const opname=await request(`/operations/addons/${bola.id}/stock`,"POST",{reason:"koreksi",quantity:2,note:"Hitung fisik"},admin);
      assert.equal(opname.status,201);assert.equal(opname.data.addon.stock,2);
      assert.deepEqual(opname.data.moves.map((m:{reason:string})=>m.reason),["koreksi","kembali","terpakai","awal"]);
      assert.ok((await request("/operations/addons","GET",undefined,admin)).data.summary.low_stock.some((a:{id:string})=>a.id===bola.id),"stok di batas minimum masuk daftar menipis");

      const sale=await request("/operations/bookings","POST",slot(courtA,"15:00","16:00",[{addon_id:bola.id,quantity:2}]),staff);
      assert.equal(sale.status,201);
      assert.equal((await request("/operations/bookings","POST",slot(courtA,"16:00","17:00",[{addon_id:bola.id,quantity:1}]),staff)).status,409,"stok habis");
      assert.equal((await request(`/operations/bookings/${sale.data.booking.id}/status`,"PATCH",{status:"cancelled",reason:"Batal main"},staff)).status,200);
      assert.equal(await stockOf(bola.id),2,"pembatalan mengembalikan stok barang jual");
      assert.equal((await edit({lines:[]},sale.data.booking.id)).status,409,"booking yang dibatalkan tidak dapat diubah");
      assert.equal((await request(`/operations/bookings/${sale.data.booking.id}`,"GET",undefined,staff)).data.addons.length,1,"baris tetap tersimpan sebagai riwayat");

      const laterId=later.data.booking.id;
      const laterLines=(await request(`/operations/bookings/${laterId}`,"GET",undefined,staff)).data.addons as {id:string;addon_id:string;returned_at:string|null}[];
      const rent=laterLines.find(l=>l.addon_id===raket.id)!,coach=laterLines.find(l=>l.addon_id===pelatih.id)!;
      assert.equal((await request(`/operations/bookings/${laterId}/addons/returned`,"PATCH",{line_ids:[coach.id],returned:true},staff)).status,400,"hanya barang sewa yang dikembalikan");
      const yesterday=new Date(localClock().date+"T12:00:00Z");yesterday.setUTCDate(yesterday.getUTCDate()-1);
      db.prepare("UPDATE bookings SET date=? WHERE id=?").run(yesterday.toISOString().slice(0,10),laterId);
      assert.ok((await request("/operations/addons","GET",undefined,admin)).data.summary.unreturned.some((l:{id:string})=>l.id===rent.id),"raket dari jadwal yang sudah lewat masuk daftar belum kembali");
      const returned=await request(`/operations/bookings/${laterId}/addons/returned`,"PATCH",{line_ids:[rent.id],returned:true},staff);
      assert.equal(returned.status,200);
      assert.ok(returned.data.addons.find((l:{id:string})=>l.id===rent.id).returned_at);
      assert.ok(!(await request("/operations/addons","GET",undefined,admin)).data.summary.unreturned.some((l:{id:string})=>l.id===rent.id));
      assert.equal((await request("/dashboard/summary","GET",undefined,admin)).data.addons.unreturned,0);

      assert.equal((await request(`/operations/addons/${bola.id}`,"DELETE",undefined,admin)).status,409,"item yang sudah dipakai tidak boleh dihapus");
      assert.equal((await request(`/operations/addons/${raket.id}`,"PUT",{...item(),type:"jual"},admin)).status,409,"jenis tidak boleh diubah setelah dipakai");
      const handuk=(await request("/operations/addons","POST",item({name:"Handuk",category:"handuk"}),admin)).data.addon;
      const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32,2)]);
      const uploaded=await fetch(`${base}/operations/addons/${handuk.id}/photo`,{method:"POST",headers:{"Content-Type":"image/png",Cookie:admin,Origin:"http://localhost:3000"},body:new Uint8Array(png)});
      assert.equal(uploaded.status,201);
      const photoId=(await uploaded.json()).addon.photo_id;
      assert.ok(Buffer.from(await (await fetch(`${base}/public/photos/${photoId}`)).arrayBuffer()).equals(png),"foto item memakai endpoint foto publik");
      const order=(await request("/operations/addons","GET",undefined,admin)).data.addons.map((a:{id:string})=>a.id).reverse();
      assert.deepEqual((await request("/operations/addons/order","PUT",{ids:order},admin)).data.addons.map((a:{id:string})=>a.id),order);
      assert.equal((await request(`/operations/addons/${handuk.id}`,"DELETE",undefined,admin)).status,204,"item yang belum dipakai boleh dihapus");
      assert.ok((await request("/public/info","GET")).data.addons.some((a:{id:string})=>a.id===raket.id),"katalog ikut di info publik");
    });
    await t.test("info venue, kebijakan, dan FAQ: tervalidasi dan tampil di endpoint publik",async()=>{
      const empty=await request("/public/info","GET");
      assert.equal(empty.status,200);assert.equal(empty.data.info.address,"");assert.deepEqual(empty.data.faqs,[]);
      const info={name:"Arena Uji",address:"Jl. Uji No. 1",whatsapp:"0812-3456-7890",instagram:"https://instagram.com/arena.uji/",facilities:["parkir","wifi","parkir"],maps_url:""};
      assert.equal((await request("/operations/content/info","PUT",info,staff)).status,403,"peran tanpa menu info tidak boleh mengubah");
      assert.equal((await request("/operations/content/info","PUT",{...info,maps_url:"javascript:alert(1)"},admin)).status,400,"tautan peta wajib https");
      assert.equal((await request("/operations/content/info","PUT",{...info,whatsapp:"12345"},admin)).status,400);
      const saved=await request("/operations/content/info","PUT",info,admin);
      assert.equal(saved.status,200);
      assert.equal(saved.data.info.whatsapp,"6281234567890","nomor WhatsApp diseragamkan agar siap dipakai wa.me");
      assert.equal(saved.data.info.instagram,"arena.uji");
      assert.deepEqual(saved.data.info.facilities,["parkir","wifi"]);
      assert.equal((await request("/operations/content/policies","PUT",{refund_tiers:[{hours:6,percent:100},{hours:24,percent:50}]},admin)).status,400,"refund tidak boleh naik saat makin dekat jam main");
      const policies=await request("/operations/content/policies","PUT",{refund_tiers:[{hours:6,percent:50},{hours:24,percent:100}],reschedule:"yes",reschedule_hours:12,terms:"Datang tepat waktu."},admin);
      assert.equal(policies.status,200);
      assert.deepEqual(policies.data.policies.refund_tiers.map((t:{hours:number})=>t.hours),[24,6],"tingkat diurutkan dari batas terjauh");
      assert.equal((await request("/operations/content/faqs","PUT",{items:[{id:"a",question:"Bisa sewa raket?",answer:""}]},admin)).status,400,"FAQ tanpa jawaban ditolak");
      assert.equal((await request("/operations/content/faqs","PUT",{items:[{id:"a",question:"Bisa sewa raket?",answer:"Bisa, di resepsionis."}]},admin)).status,200);
      const pub=await request("/public/info","GET");
      assert.equal(pub.data.info.name,"Arena Uji");assert.equal(pub.data.policies.reschedule_hours,12);
      assert.equal(pub.data.faqs[0].answer,"Bisa, di resepsionis.");assert.ok(pub.data.info.updated_at);
      const manage=await request("/operations/content","GET",undefined,admin);
      assert.equal(manage.status,200);assert.ok(Array.isArray(manage.data.courts));
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

test("nama menu bawaan diterjemahkan tanpa menimpa nama yang sudah diubah admin",()=>{
  const legacy=mkdtempSync(path.join(tmpdir(),"padelix-menu-test-"));
  const stamp="2026-01-01T00:00:00Z";
  const menus=[
    {id:"dashboard",name:"Overview",path:"/admin",icon:"LayoutDashboard",group:"Workspace",order:1,active:true,createdAt:stamp},
    {id:"bookings",name:"Jadwal Lapangan",path:"/admin/bookings",icon:"CalendarDays",group:"Workspace",order:2,active:true,createdAt:stamp},
    {id:"users",name:"Users",path:"/admin/users",icon:"UsersRound",group:"Access Control",order:5,active:true,createdAt:stamp},
    {id:"laporan",name:"Laporan",path:"/admin/laporan",icon:"Circle",group:"Workspace",order:9,active:true,createdAt:stamp},
  ];
  writeFileSync(path.join(legacy,"menus.json"),JSON.stringify(menus));
  const script="const {getMenus,db}=await import('./src/store.ts');console.log(JSON.stringify(getMenus()));db.close();";
  try {
    const run=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{env:{...process.env,DATA_DIR:legacy},encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    const byId=Object.fromEntries((JSON.parse(run.stdout.trim()) as {id:string;name:string;group:string}[]).map(menu=>[menu.id,menu]));
    assert.equal(byId.dashboard.name,"Ringkasan");
    assert.equal(byId.users.name,"Pengguna");
    assert.equal(byId.layout.name,"Denah Venue","menu yang ditambahkan migrasi 3 ikut diterjemahkan");
    assert.equal(byId.bookings.name,"Jadwal Lapangan","nama yang sudah diubah admin harus dipertahankan");
    assert.equal(byId.users.group,"Hak Akses");
    assert.equal(byId.laporan.group,"Operasional","menu kustom tetap satu grup dengan menu bawaan");
  } finally {
    assert.ok(path.resolve(legacy).startsWith(path.resolve(tmpdir())+path.sep+"padelix-menu-test-"));
    rmSync(legacy,{recursive:true,force:true});
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
    assert.equal(one("SELECT count(*) n FROM floors").n, 1, "denah lama menjadi satu lantai");
    assert.ok(one("SELECT floor_id FROM courts WHERE id='c1'").floor_id, "lapangan lama masuk ke lantai pertama");

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

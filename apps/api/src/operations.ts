import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db,transaction,audit,defaultVenue,type VenueLayout } from "./store.js";
import { check } from "./errors.js";
import { venueTimezone } from "./config.js";
import { photoIndex } from "./photos.js";

export interface Court {id:string;name:string;hourly_rate:number;opens_at:string;closes_at:string;active:number;created_at:string;layout_x:number;layout_y:number;layout_w:number;layout_h:number;description:string;environment:""|"indoor"|"outdoor";surface:string}
export type BookingStatus="pending"|"confirmed"|"completed"|"cancelled"|"expired";
export interface Booking {id:string;court_id:string;court_name:string;customer_id:string|null;customer:string;phone:string;date:string;start_time:string;end_time:string;total:number;status:BookingStatus;source:"staff"|"online";hold_expires_at:number|null;notes:string;created_by:string|null;created_at:string;cancel_reason:string;paid:number}
export interface Maintenance {id:string;court_id:string;court_name:string;date:string;start_time:string;end_time:string;reason:string}
export interface Payment {id:string;booking_id:string;amount:number;kind:"payment"|"refund";method:string;source:"staff"|"gateway";gateway_ref:string|null;note:string;created_at:string;created_by:string|null}
export function localClock(value:Date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:venueTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`,timezone:venueTimezone};
}
export const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export const clockLabel=(value:number)=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const date=new Date(v+"T00:00:00Z");return !isNaN(date.getTime())&&date.toISOString().slice(0,10)===v},"Tanggal tidak valid.");
export const timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/,"Jam harus menggunakan interval 30 menit.");
const closeSchema=z.union([timeSchema,z.literal("24:00")]);
// Detail untuk pelanggan bersifat opsional: bila tidak dikirim, nilai tersimpan dipertahankan.
export const courtSchema=z.object({name:z.string().trim().min(2).max(60),hourly_rate:z.number().int().min(1000).max(10000000),opens_at:timeSchema,closes_at:closeSchema,active:z.boolean(),description:z.string().trim().max(600,"Deskripsi maksimal 600 karakter.").optional(),environment:z.enum(["","indoor","outdoor"]).optional(),surface:z.string().trim().max(40,"Jenis permukaan maksimal 40 karakter.").optional()}).refine(v=>v.opens_at<v.closes_at,"Jam tutup harus setelah jam buka.");
export const bookingSchema=z.object({court_id:z.string().min(1),customer:z.string().trim().min(2).max(80),phone:z.string().trim().min(9).max(18),date:dateSchema,start_time:timeSchema,end_time:closeSchema,notes:z.string().trim().max(500).default("")});
export const maintenanceSchema=z.object({court_id:z.string().min(1),date:dateSchema,start_time:timeSchema,end_time:closeSchema,reason:z.string().trim().min(3).max(200)});
export const paymentSchema=z.object({id:z.uuid(),amount:z.number().int().positive().max(240000000),kind:z.enum(["payment","refund"]),method:z.enum(["cash","transfer","qris"]),note:z.string().trim().max(200).default("")});
export function courts(){return db.prepare("SELECT * FROM courts ORDER BY name").all() as unknown as Court[]}
export function maintenances(date?:string){return db.prepare("SELECT m.*,c.name court_name FROM maintenance m JOIN courts c ON c.id=m.court_id WHERE (? IS NULL OR m.date=?) ORDER BY m.date,m.start_time").all(date||null,date||null) as unknown as Maintenance[]}
const bookingSelect="SELECT b.*,c.name court_name,COALESCE((SELECT SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) FROM payments WHERE booking_id=b.id),0) paid FROM bookings b JOIN courts c ON c.id=b.court_id";
export function bookings(date?:string){return db.prepare(bookingSelect+" WHERE (? IS NULL OR b.date=?) ORDER BY b.date DESC,b.start_time,b.created_at").all(date||null,date||null) as unknown as Booking[]}
export function getBooking(id:string){
  const booking=db.prepare(bookingSelect+" WHERE b.id=?").get(id) as unknown as Booking|undefined;
  check(booking,404,"Booking tidak ditemukan.");return booking;
}
export function payments(id:string){return db.prepare("SELECT * FROM payments WHERE booking_id=? ORDER BY created_at,id").all(id) as unknown as Payment[]}
function future(date:string,start:string){const now=localClock();check(date>now.date||(date===now.date&&start>=now.time),400,"Jadwal tidak boleh berada di masa lalu.");}
function schedule(courtId:string,date:string,start:string,end:string){
  check(start<end,400,"Jam selesai harus setelah jam mulai.");future(date,start);
  const court=courts().find(c=>c.id===courtId);check(court,404,"Lapangan tidak ditemukan.");
  check(court.active,409,"Lapangan sedang tidak aktif.");
  check(start>=court.opens_at&&end<=court.closes_at,400,"Jadwal di luar jam operasional lapangan.");
  return court;
}
export function saveCourt(input:unknown,actor:string,id?:string){
  const data=courtSchema.parse(input);
  return transaction(()=>{
    const existing=id?courts().find(c=>c.id===id):undefined;check(!id||existing,404,"Lapangan tidak ditemukan.");
    check(!courts().some(c=>c.id!==id&&c.name.toLowerCase()===data.name.toLowerCase()),409,"Nama lapangan sudah digunakan.");
    if(id){
      const now=localClock();
      const upcoming=bookings().filter(b=>b.court_id===id&&b.status==="confirmed"&&(b.date>now.date||(b.date===now.date&&b.end_time>now.time)));
      check(!upcoming.some(b=>!data.active||b.start_time<data.opens_at||b.end_time>data.closes_at),409,"Perubahan bertentangan dengan booking aktif. Batalkan booking terkait terlebih dahulu.");
      check(!maintenances().some(m=>m.court_id===id&&m.date>=now.date&&(m.start_time<data.opens_at||m.end_time>data.closes_at)),409,"Jam operasional bertentangan dengan maintenance.");
      db.prepare("UPDATE courts SET name=?,hourly_rate=?,opens_at=?,closes_at=?,active=?,description=?,environment=?,surface=? WHERE id=?").run(data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),data.description??existing!.description,data.environment??existing!.environment,data.surface??existing!.surface,id);
    }else{
      id=randomUUID();db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,active,created_at,description,environment,surface) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id,data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),new Date().toISOString(),data.description??"",data.environment??"",data.surface??"");
    }
    audit(actor,existing?"court.update":"court.create",id!);return courts().find(c=>c.id===id)!;
  });
}
export function createBooking(input:unknown,actor:string){
  const data=bookingSchema.parse(input);
  return transaction(()=>{
    const court=schedule(data.court_id,data.date,data.start_time,data.end_time),id=randomUUID();
    const total=quote(court,priceRules(),data.date,data.start_time,data.end_time);
    db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id,data.court_id,data.customer,data.phone,data.date,data.start_time,data.end_time,total,"confirmed",data.notes,actor,new Date().toISOString());
    audit(actor,"booking.create",id);return getBooking(id);
  });
}
export function createMaintenance(input:unknown,actor:string){
  const data=maintenanceSchema.parse(input);
  return transaction(()=>{
    schedule(data.court_id,data.date,data.start_time,data.end_time);const id=randomUUID();
    db.prepare("INSERT INTO maintenance (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)").run(id,data.court_id,data.date,data.start_time,data.end_time,data.reason);
    audit(actor,"maintenance.create",id);return maintenances(data.date).find(m=>m.id===id)!;
  });
}
export function removeMaintenance(id:string,actor:string){transaction(()=>{
  check(db.prepare("DELETE FROM maintenance WHERE id=?").run(id).changes,404,"Maintenance tidak ditemukan.");
  audit(actor,"maintenance.delete",id);
})}
export function changeBookingStatus(id:string,input:unknown,actor:string){
  const data=z.object({status:z.enum(["completed","cancelled"]),reason:z.string().trim().max(200).default("")}).parse(input);
  return transaction(()=>{
    const booking=getBooking(id);check(booking.status==="confirmed",409,"Status booking ini tidak dapat diubah lagi.");
    if(data.status==="cancelled")check(data.reason.length>=3,400,"Isi alasan pembatalan.");
    if(data.status==="completed"){
      const now=localClock();check(booking.date<now.date||(booking.date===now.date&&booking.end_time<=now.time),409,"Sesi belum selesai.");
      check(booking.paid===booking.total,409,"Lunasi pembayaran sebelum menyelesaikan booking.");
    }
    db.prepare("UPDATE bookings SET status=?,cancel_reason=? WHERE id=?").run(data.status,data.reason,id);
    audit(actor,"booking."+data.status,id);return getBooking(id);
  });
}
export function recordPayment(id:string,input:unknown,actor:string){
  const data=paymentSchema.parse(input);
  return transaction(()=>{
    const booking=getBooking(id);
    const duplicate=db.prepare("SELECT * FROM payments WHERE id=?").get(data.id) as unknown as Payment|undefined;
    if(duplicate){
      check(duplicate.booking_id===id&&duplicate.amount===data.amount&&duplicate.kind===data.kind&&duplicate.method===data.method&&duplicate.note===data.note,409,"ID pembayaran sudah digunakan untuk transaksi berbeda.");
      return {booking,payments:payments(id)};
    }
    if(data.kind==="payment"){
      check(booking.status==="confirmed",409,"Pembayaran hanya untuk booking aktif.");
      check(data.amount<=booking.total-booking.paid,400,"Pembayaran melebihi sisa tagihan.");
    }else{
      check(booking.status==="cancelled",409,"Batalkan booking sebelum mencatat pengembalian.");
      check(data.amount<=booking.paid,400,"Pengembalian melebihi pembayaran yang diterima.");
      check(data.note.length>=3,400,"Isi catatan pengembalian.");
    }
    db.prepare("INSERT INTO payments (id,booking_id,amount,kind,method,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)").run(data.id,id,data.amount,data.kind,data.method,data.note,actor,new Date().toISOString());
    audit(actor,data.kind,data.id);return {booking:getBooking(id),payments:payments(id)};
  });
}


// --- Layout venue ----------------------------------------------------------
// Satuan kanvas: 1 unit = 0,1 meter. Tidak ada rotasi; lapangan mendatar dibuat
// dengan menukar lebar dan tinggi, sehingga kotak selalu sejajar sumbu dan
// pemeriksaan tumpang tindih tetap sederhana dan benar.
export const venueSchema=z.object({width:z.number().int().min(200).max(5000),height:z.number().int().min(200).max(5000),grid:z.number().int().min(5).max(50)});
/** Jenis elemen penjelas. Menambah jenis cukup di sini, tanpa migrasi. */
export const featureKinds=["jalan","kantin","tempat-duduk","toilet","parkir","resepsionis","loker","lainnya"] as const;
export type FeatureKind=typeof featureKinds[number];
export interface VenueFeature {id:string;kind:FeatureKind;label:string;x:number;y:number;w:number;h:number;created_at:string}
const boxSchema={x:z.number().int().min(0).max(5000),y:z.number().int().min(0).max(5000),w:z.number().int().min(10).max(5000),h:z.number().int().min(10).max(5000)};
export const layoutSchema=z.object({
  venue:venueSchema,
  courts:z.array(z.object({id:z.string().min(1),...boxSchema,w:z.number().int().min(20).max(2000),h:z.number().int().min(20).max(2000)})).max(60),
  // Daftar lengkap: elemen yang tidak ikut terkirim dianggap dihapus.
  features:z.array(z.object({id:z.string().min(1).max(64),kind:z.enum(featureKinds),label:z.string().trim().max(40).default(""),...boxSchema})).max(80).optional(),
});
export function getVenue():VenueLayout{
  const row=db.prepare("SELECT document FROM settings WHERE key='venue'").get() as {document:string}|undefined;
  return row?JSON.parse(row.document) as VenueLayout:defaultVenue;
}
export function features(){return db.prepare("SELECT * FROM venue_features ORDER BY created_at,id").all() as unknown as VenueFeature[]}
export function layout(){return {venue:getVenue(),courts:courts(),features:features()}}
const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function saveLayout(input:unknown,actor:string){
  const data=layoutSchema.parse(input);
  return transaction(()=>{
    const all=courts();
    for(const item of data.courts)check(all.some(c=>c.id===item.id),404,"Ada lapangan yang tidak ditemukan. Muat ulang halaman.");
    // Lapangan yang tidak ikut dikirim tetap menempati ruang, jadi ikut divalidasi.
    const named=all.map(court=>{
      const moved=data.courts.find(item=>item.id===court.id);
      const box=moved?{x:moved.x,y:moved.y,w:moved.w,h:moved.h}:{x:court.layout_x,y:court.layout_y,w:court.layout_w,h:court.layout_h};
      check(box.x+box.w<=data.venue.width&&box.y+box.h<=data.venue.height,400,`Posisi ${court.name} keluar dari area venue.`);
      return {...box,name:court.name};
    });
    for(let i=0;i<named.length;i++)for(let j=i+1;j<named.length;j++)
      check(!overlaps(named[i],named[j]),409,`${named[i].name} dan ${named[j].name} saling menimpa. Geser salah satunya.`);
    // Elemen penjelas hanya dijaga agar tetap di dalam area. Saling menimpa
    // dibiarkan, karena menaruh kursi di dalam area lounge itu wajar dan
    // elemen ini tidak memengaruhi jadwal sama sekali.
    for(const item of data.features??[])
      check(item.x+item.w<=data.venue.width&&item.y+item.h<=data.venue.height,400,`Elemen ${item.label||item.kind} keluar dari area venue.`);

    db.prepare("UPDATE settings SET document=? WHERE key='venue'").run(JSON.stringify(data.venue));
    for(const item of data.courts)db.prepare("UPDATE courts SET layout_x=?,layout_y=?,layout_w=?,layout_h=? WHERE id=?").run(item.x,item.y,item.w,item.h,item.id);
    if(data.features){
      const keep=new Set(data.features.map(item=>item.id));
      for(const existing of features())if(!keep.has(existing.id))db.prepare("DELETE FROM venue_features WHERE id=?").run(existing.id);
      const upsert=db.prepare("INSERT INTO venue_features (id,kind,label,x,y,w,h,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,x=excluded.x,y=excluded.y,w=excluded.w,h=excluded.h");
      for(const item of data.features)upsert.run(item.id,item.kind,item.label,item.x,item.y,item.w,item.h,new Date().toISOString());
    }
    audit(actor,"layout.update","venue");return layout();
  });
}
export function removeCourt(id:string,actor:string){transaction(()=>{
  const court=courts().find(c=>c.id===id);check(court,404,"Lapangan tidak ditemukan.");
  const used=db.prepare("SELECT count(*) n FROM bookings WHERE court_id=?").get(id) as {n:number};
  check(!used.n,409,"Lapangan ini sudah memiliki riwayat booking. Nonaktifkan saja agar data lama tetap utuh.");
  db.prepare("DELETE FROM maintenance WHERE court_id=?").run(id);
  // Foto dan tautan tarif khusus ikut terhapus lewat ON DELETE CASCADE.
  db.prepare("DELETE FROM courts WHERE id=?").run(id);
  db.prepare("DELETE FROM price_rules WHERE id NOT IN (SELECT rule_id FROM price_rule_courts)").run();
  audit(actor,"court.delete",id);
})}

// --- Tarif khusus ----------------------------------------------------------
// Tarif dasar lapangan berlaku kecuali ada tarif khusus yang cocok dengan hari dan
// jamnya. Tarif khusus pada lapangan yang sama tidak boleh tumpang tindih, sehingga
// setiap slot selalu punya tepat satu harga dan pelanggan tidak pernah ditagih ganda.
export interface PriceRule {id:string;label:string;days:number[];start_time:string;end_time:string;hourly_rate:number;court_ids:string[];created_at:string}
export const priceRuleSchema=z.object({
  label:z.string().trim().min(2,"Isi nama tarif, misalnya Jam sibuk.").max(40,"Nama tarif maksimal 40 karakter."),
  court_ids:z.array(z.string().min(1)).min(1,"Pilih minimal satu lapangan.").max(60),
  days:z.array(z.number().int().min(0).max(6)).min(1,"Pilih minimal satu hari.").max(7),
  start_time:timeSchema,end_time:closeSchema,
  hourly_rate:z.number().int().min(1000).max(10000000),
}).refine(v=>v.start_time<v.end_time,"Jam selesai harus setelah jam mulai.");
const dayNames=["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
/** 0 = Minggu … 6 = Sabtu, sama dengan Date#getDay. */
export const weekday=(date:string)=>new Date(date+"T12:00:00Z").getUTCDay();
export function priceRules():PriceRule[]{
  const links=db.prepare("SELECT rule_id,court_id FROM price_rule_courts").all() as {rule_id:string;court_id:string}[];
  const rows=db.prepare("SELECT * FROM price_rules ORDER BY start_time,created_at").all() as unknown as (Omit<PriceRule,"days"|"court_ids">&{days:string})[];
  return rows.map(rule=>({...rule,days:JSON.parse(rule.days) as number[],court_ids:links.filter(link=>link.rule_id===rule.id).map(link=>link.court_id)}));
}
/** Tarif per jam untuk slot 30 menit yang dimulai pada `start`. */
export function rateAt(court:Pick<Court,"id"|"hourly_rate">,rules:PriceRule[],date:string,start:string){
  const day=weekday(date);
  const rule=rules.find(r=>r.court_ids.includes(court.id)&&r.days.includes(day)&&r.start_time<=start&&r.end_time>start);
  return rule?{rate:rule.hourly_rate,rule:rule.label}:{rate:court.hourly_rate,rule:null};
}
/** Total sewa: jumlah tarif setiap slot 30 menit, dibulatkan ke rupiah terdekat. */
export function quote(court:Pick<Court,"id"|"hourly_rate">,rules:PriceRule[],date:string,start:string,end:string){
  let sum=0;
  for(let value=minutes(start);value<minutes(end);value+=30)sum+=rateAt(court,rules,date,clockLabel(value)).rate;
  return Math.round(sum/2);
}
export function savePriceRule(input:unknown,actor:string,id?:string){
  const data=priceRuleSchema.parse(input);
  const days=[...new Set(data.days)].sort((a,b)=>a-b),courtIds=[...new Set(data.court_ids)];
  return transaction(()=>{
    const rules=priceRules();
    check(!id||rules.some(r=>r.id===id),404,"Tarif khusus tidak ditemukan.");
    const all=courts();
    check(courtIds.every(courtId=>all.some(c=>c.id===courtId)),404,"Ada lapangan yang tidak ditemukan. Muat ulang halaman.");
    for(const other of rules){
      if(other.id===id||!(other.start_time<data.end_time&&other.end_time>data.start_time))continue;
      const court=all.find(c=>courtIds.includes(c.id)&&other.court_ids.includes(c.id));
      const day=days.find(d=>other.days.includes(d));
      if(court&&day!==undefined)check(false,409,`Bentrok dengan tarif "${other.label}" di ${court.name} pada hari ${dayNames[day]} pukul ${other.start_time}–${other.end_time}. Ubah jam atau harinya.`);
    }
    if(id)db.prepare("UPDATE price_rules SET label=?,days=?,start_time=?,end_time=?,hourly_rate=? WHERE id=?").run(data.label,JSON.stringify(days),data.start_time,data.end_time,data.hourly_rate,id);
    else{id=randomUUID();db.prepare("INSERT INTO price_rules (id,label,days,start_time,end_time,hourly_rate,created_at) VALUES (?,?,?,?,?,?,?)").run(id,data.label,JSON.stringify(days),data.start_time,data.end_time,data.hourly_rate,new Date().toISOString());}
    db.prepare("DELETE FROM price_rule_courts WHERE rule_id=?").run(id);
    for(const courtId of courtIds)db.prepare("INSERT INTO price_rule_courts (rule_id,court_id) VALUES (?,?)").run(id,courtId);
    audit(actor,"price_rule.save",id);return priceRules();
  });
}
export function removePriceRule(id:string,actor:string){transaction(()=>{
  check(db.prepare("DELETE FROM price_rules WHERE id=?").run(id).changes,404,"Tarif khusus tidak ditemukan.");
  audit(actor,"price_rule.delete",id);
})}

/** Data lapangan untuk pelanggan, termasuk kisaran tarif sepanjang minggu. */
function publicCourt(court:Court,rules:PriceRule[],photos:Map<string,string[]>){
  let low=Infinity,high=0;
  for(let day=0;day<7;day++){
    // Tanggal acuan mana pun dengan hari yang sama menghasilkan tarif yang sama.
    const date=new Date(Date.UTC(2024,0,7+day)).toISOString().slice(0,10);
    for(let value=minutes(court.opens_at);value+30<=minutes(court.closes_at);value+=30){
      const {rate}=rateAt(court,rules,date,clockLabel(value));low=Math.min(low,rate);high=Math.max(high,rate);
    }
  }
  return {id:court.id,name:court.name,hourly_rate:court.hourly_rate,opens_at:court.opens_at,closes_at:court.closes_at,
    description:court.description,environment:court.environment,surface:court.surface,photos:photos.get(court.id)??[],
    rate_min:Number.isFinite(low)?low:court.hourly_rate,rate_max:high||court.hourly_rate,
    layout:{x:court.layout_x,y:court.layout_y,w:court.layout_w,h:court.layout_h}};
}
export function publicCourts(){
  const rules=priceRules(),photos=photoIndex();
  return courts().filter(c=>c.active).map(court=>publicCourt(court,rules,photos));
}

// --- Ketersediaan publik ---------------------------------------------------
// Sengaja tidak memuat nama, telepon, atau catatan pemesan.
// `rate` adalah tarif per jam slot itu; `rule` berisi nama tarif khusus bila berlaku.
export type PublicSlot={start:string;end:string;state:"available"|"booked"|"maintenance"|"past";rate:number;rule:string|null};
export function publicAvailability(date:string){
  const now=localClock();
  const active=courts().filter(c=>c.active);
  const taken=bookings(date).filter(b=>b.status==="confirmed"||b.status==="completed"||(b.status==="pending"&&(b.hold_expires_at??0)*1000>Date.now()));
  const care=maintenances(date);
  const rules=priceRules(),photos=photoIndex();
  const courtsOut=active.map(court=>{
    const slots:PublicSlot[]=[];
    for(let value=minutes(court.opens_at);value+30<=minutes(court.closes_at);value+=30){
      const start=clockLabel(value),end=clockLabel(value+30);
      const busy=taken.some(b=>b.court_id===court.id&&b.start_time<=start&&b.end_time>start);
      const fixing=care.some(m=>m.court_id===court.id&&m.start_time<=start&&m.end_time>start);
      const past=date<now.date||(date===now.date&&start<now.time);
      slots.push({start,end,state:busy?"booked":fixing?"maintenance":past?"past":"available",...rateAt(court,rules,date,start)});
    }
    return {court:publicCourt(court,rules,photos),slots};
  });
  return {date,today:now.date,time:now.time,timezone:now.timezone,venue:getVenue(),features:features(),courts:courtsOut};
}

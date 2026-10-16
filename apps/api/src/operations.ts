import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db,transaction,audit,defaultVenue,type VenueLayout } from "./store.js";
import { check } from "./errors.js";
import { photoIndex } from "./photos.js";
import { clockLabel,localClock,minutes,shiftDate } from "./clock.js";
import { applyLines,bookingAddons,linesSchema,moveLines,releaseAddons,saveMovedLines,setReturned } from "./addons.js";
import { syncBooking } from "./finance.js";
import { billOf,taxSnapshot } from "./bill.js";
import { ensureOpen } from "./finance.js";
import { getPolicies } from "./content.js";
import { notifyCancelled,notifyReschedule } from "./notifications.js";
export { clockLabel,localClock,minutes };

export interface Court {id:string;name:string;hourly_rate:number;opens_at:string;closes_at:string;active:number;created_at:string;layout_x:number;layout_y:number;layout_w:number;layout_h:number;description:string;environment:""|"indoor"|"outdoor";surface:string;floor_id:string|null}
export type BookingStatus="pending"|"confirmed"|"completed"|"cancelled"|"expired";
export interface Booking {id:string;court_id:string;court_name:string;customer_id:string|null;customer:string;phone:string;date:string;start_time:string;end_time:string;total:number;status:BookingStatus;source:"staff"|"online";hold_expires_at:number|null;notes:string;created_by:string|null;created_at:string;cancel_reason:string;paid:number;
  /** Porsi sewa lapangan; `total` = court_total + tambahan. */
  court_total:number;addon_count:number;
  /** Potongan harga dan pajak sudah termasuk dalam `total`; `tax_rate` dalam basis poin (1000 = 10%). */
  discount:number;discount_note:string;tax:number;tax_rate:number;tax_inclusive:number;tax_label:string;
  /** Bagian pembayaran booking batal yang ditahan venue sebagai denda, bukan dikembalikan. */
  forfeited:number;forfeited_at:string|null;
  /** Email pelanggan isian staf; booking online memakai email pesanan atau akun. */
  email:string;reschedule_count:number;order_id:string|null;account_id:string|null}
export interface Maintenance {id:string;court_id:string;court_name:string;date:string;start_time:string;end_time:string;reason:string}
export interface Payment {id:string;booking_id:string;amount:number;kind:"payment"|"refund";method:string;source:"staff"|"gateway";gateway_ref:string|null;note:string;created_at:string;created_by:string|null}
export const dateSchema=z.string("Pilih tanggal.").regex(/^\d{4}-\d{2}-\d{2}$/,"Tanggal tidak valid.").refine(v=>{const date=new Date(v+"T00:00:00Z");return !isNaN(date.getTime())&&date.toISOString().slice(0,10)===v},"Tanggal tidak valid.");
export const timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/,"Jam harus menggunakan interval 30 menit.");
/** Nomor telepon kontak: angka dengan spasi, tanda hubung, kurung, atau awalan +, berisi 9–15 digit. */
export const contactPhoneSchema=z.string().trim().max(20,"Nomor telepon maksimal 20 karakter.")
  .refine(v=>/^\+?[0-9][0-9 ().-]*$/.test(v)&&/^\d{9,15}$/.test(v.replace(/\D/g,"")),"Nomor telepon tidak valid. Contoh: 0812 3456 7890.");
export const closeSchema=z.union([timeSchema,z.literal("24:00")]);
// Detail untuk pelanggan bersifat opsional: bila tidak dikirim, nilai tersimpan dipertahankan.
export const courtSchema=z.object({name:z.string().trim().min(2,"Nama lapangan minimal 2 karakter.").max(60,"Nama lapangan maksimal 60 karakter."),hourly_rate:z.number("Isi tarif per jam.").int("Tarif harus bilangan bulat.").min(1000,"Tarif minimal Rp1.000 per jam.").max(10000000,"Tarif maksimal Rp10.000.000 per jam."),opens_at:timeSchema,closes_at:closeSchema,active:z.boolean(),description:z.string().trim().max(600,"Deskripsi maksimal 600 karakter.").optional(),environment:z.enum(["","indoor","outdoor"]).optional(),surface:z.string().trim().max(40,"Jenis permukaan maksimal 40 karakter.").optional()}).refine(v=>v.opens_at<v.closes_at,"Jam tutup harus setelah jam buka.");
export const bookingSchema=z.object({court_id:z.string().min(1,"Pilih lapangan."),customer:z.string().trim().min(2,"Nama pelanggan minimal 2 karakter.").max(80,"Nama pelanggan maksimal 80 karakter."),phone:contactPhoneSchema,date:dateSchema,start_time:timeSchema,end_time:closeSchema,notes:z.string().trim().max(500,"Catatan maksimal 500 karakter.").default(""),email:z.union([z.email("Email pelanggan tidak valid."),z.literal("")]).default(""),addons:linesSchema.default([])});
export const maintenanceSchema=z.object({court_id:z.string().min(1,"Pilih lapangan."),date:dateSchema,start_time:timeSchema,end_time:closeSchema,reason:z.string().trim().min(3,"Alasan perawatan minimal 3 karakter.").max(200,"Alasan perawatan maksimal 200 karakter.")});
export const paymentSchema=z.object({id:z.uuid(),amount:z.number("Isi nominal.").int("Nominal harus bilangan bulat.").positive("Nominal harus lebih dari 0.").max(240000000),kind:z.enum(["payment","refund"]),method:z.enum(["cash","transfer","qris"],"Pilih metode pembayaran."),note:z.string().trim().max(200,"Catatan maksimal 200 karakter.").default("")});
export function courts(){return db.prepare("SELECT * FROM courts ORDER BY name").all() as unknown as Court[]}
export function maintenances(date?:string){return db.prepare("SELECT m.*,c.name court_name FROM maintenance m JOIN courts c ON c.id=m.court_id WHERE (? IS NULL OR m.date=?) ORDER BY m.date,m.start_time").all(date||null,date||null) as unknown as Maintenance[]}
const bookingSelect="SELECT b.*,c.name court_name,COALESCE((SELECT SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) FROM payments WHERE booking_id=b.id),0) paid,(SELECT count(*) FROM booking_addons WHERE booking_id=b.id) addon_count FROM bookings b JOIN courts c ON c.id=b.court_id";
export function bookings(date?:string){return db.prepare(bookingSelect+" WHERE (? IS NULL OR b.date=?) ORDER BY b.date DESC,b.start_time,b.created_at").all(date||null,date||null) as unknown as Booking[]}
/**
 * Daftar booking untuk panel admin: per tanggal atau rentang, dengan pencarian nama, telepon,
 * lapangan, atau kode. Dibatasi agar respons tidak tumbuh mengikuti seluruh riwayat venue.
 */
export const bookingListSchema=z.object({
  date:dateSchema.optional(),from:dateSchema.optional(),to:dateSchema.optional(),
  status:z.enum(["pending","confirmed","completed","cancelled","expired"]).optional(),
  q:z.string().trim().max(80).optional(),
  /** `recent`: 30 hari terakhir sampai 90 hari ke depan menurut jam venue, tampilan bawaan panel. */
  window:z.enum(["recent"]).optional(),
  limit:z.coerce.number().int().min(1).max(500).default(300),
});
export function searchBookings(input:unknown){
  const query=bookingListSchema.parse(input);
  const where:string[]=[],params:(string|number)[]=[];
  if(query.window==="recent"&&!query.date&&!query.q){const today=localClock().date;where.push("b.date BETWEEN ? AND ?");params.push(shiftDate(today,-30),shiftDate(today,90))}
  if(query.date){where.push("b.date=?");params.push(query.date)}
  if(query.from){where.push("b.date>=?");params.push(query.from)}
  if(query.to){where.push("b.date<=?");params.push(query.to)}
  if(query.status){where.push("b.status=?");params.push(query.status)}
  if(query.q){
    const term=`%${query.q.toLowerCase().replace(/[\\%_]/g,m=>"\\"+m)}%`;
    where.push("(lower(b.customer) LIKE ? ESCAPE '\\' OR b.phone LIKE ? ESCAPE '\\' OR lower(c.name) LIKE ? ESCAPE '\\' OR lower(b.id) LIKE ? ESCAPE '\\')");
    params.push(term,term,term,term);
  }
  const rows=db.prepare(bookingSelect+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY b.date DESC,b.start_time,b.created_at LIMIT ?").all(...params,query.limit+1) as unknown as Booking[];
  return {bookings:rows.slice(0,query.limit),truncated:rows.length>query.limit};
}
export function getBooking(id:string){
  const booking=db.prepare(bookingSelect+" WHERE b.id=?").get(id) as unknown as Booking|undefined;
  check(booking,404,"Booking tidak ditemukan.");return booking;
}
/** Booking yang menempati slotnya: aktif, selesai, atau hold online yang belum kedaluwarsa. */
export const occupies=(b:Pick<Booking,"status"|"hold_expires_at">)=>b.status==="confirmed"||b.status==="completed"||(b.status==="pending"&&(b.hold_expires_at??0)*1000>Date.now());
export function payments(id:string){return db.prepare("SELECT * FROM payments WHERE booking_id=? ORDER BY created_at,id").all(id) as unknown as Payment[]}
function future(date:string,start:string){const now=localClock();check(date>now.date||(date===now.date&&start>=now.time),400,"Jadwal tidak boleh berada di masa lalu.");}
/** Validasi slot: lapangan aktif, di dalam jam operasional, dan bukan masa lalu. */
export function ensureSlot(courtId:string,date:string,start:string,end:string){
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
      // Hold online yang belum dibayar ikut dijaga: begitu dibayar, booking itu langsung aktif.
      const upcoming=bookings().filter(b=>b.court_id===id&&(b.status==="confirmed"||(b.status==="pending"&&occupies(b)))&&(b.date>now.date||(b.date===now.date&&b.end_time>now.time)));
      check(!upcoming.some(b=>!data.active||b.start_time<data.opens_at||b.end_time>data.closes_at),409,"Perubahan bertentangan dengan booking aktif. Batalkan booking terkait terlebih dahulu.");
      check(!maintenances().some(m=>m.court_id===id&&m.date>=now.date&&(m.start_time<data.opens_at||m.end_time>data.closes_at)),409,"Jam operasional bertentangan dengan maintenance.");
      db.prepare("UPDATE courts SET name=?,hourly_rate=?,opens_at=?,closes_at=?,active=?,description=?,environment=?,surface=? WHERE id=?").run(data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),data.description??existing!.description,data.environment??existing!.environment,data.surface??existing!.surface,id);
    }else{
      // Lapangan baru masuk ke lantai pertama; editor denah dapat memindahkannya.
      id=randomUUID();db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,active,created_at,description,environment,surface,floor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id,data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),new Date().toISOString(),data.description??"",data.environment??"",data.surface??"",floors()[0]?.id??null);
    }
    audit(actor,existing?"court.update":"court.create",id!);return courts().find(c=>c.id===id)!;
  });
}
export function createBooking(input:unknown,actor:string){
  const data=bookingSchema.parse(input);
  return transaction(()=>{
    const court=ensureSlot(data.court_id,data.date,data.start_time,data.end_time),id=randomUUID();
    const courtTotal=quote(court,priceRules(),data.date,data.start_time,data.end_time),snapshot=taxSnapshot(),bill=billOf(courtTotal,0,snapshot);
    db.prepare("INSERT INTO bookings (id,court_id,customer,phone,email,date,start_time,end_time,total,court_total,tax,tax_rate,tax_inclusive,tax_label,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,data.court_id,data.customer,data.phone,data.email.toLowerCase(),data.date,data.start_time,data.end_time,bill.total,courtTotal,bill.tax,snapshot.tax_rate,snapshot.tax_inclusive,snapshot.tax_label,"confirmed",data.notes,actor,new Date().toISOString());
    if(data.addons.length)applyLines(getBooking(id),data.addons,actor);
    syncBooking(id);
    audit(actor,"booking.create",id);return getBooking(id);
  });
}
export function createMaintenance(input:unknown,actor:string){
  const data=maintenanceSchema.parse(input);
  return transaction(()=>{
    ensureSlot(data.court_id,data.date,data.start_time,data.end_time);const id=randomUUID();
    db.prepare("INSERT INTO maintenance (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)").run(id,data.court_id,data.date,data.start_time,data.end_time,data.reason);
    audit(actor,"maintenance.create",id);return maintenances(data.date).find(m=>m.id===id)!;
  });
}
export function removeMaintenance(id:string,actor:string){transaction(()=>{
  check(db.prepare("DELETE FROM maintenance WHERE id=?").run(id).changes,404,"Maintenance tidak ditemukan.");
  audit(actor,"maintenance.delete",id);
})}
export function changeBookingStatus(id:string,input:unknown,actor:string){
  const data=z.object({status:z.enum(["completed","cancelled"]),reason:z.string().trim().max(200,"Alasan maksimal 200 karakter.").default("")}).parse(input);
  return transaction(()=>{
    const booking=getBooking(id);check(booking.status==="confirmed",409,"Status booking ini tidak dapat diubah lagi.");
    if(data.status==="cancelled")check(data.reason.length>=3,400,"Isi alasan pembatalan.");
    if(data.status==="completed"){
      const now=localClock();check(booking.date<now.date||(booking.date===now.date&&booking.end_time<=now.time),409,"Sesi belum selesai.");
      check(booking.paid===booking.total,409,"Lunasi pembayaran sebelum menyelesaikan booking.");
    }
    db.prepare("UPDATE bookings SET status=?,cancel_reason=? WHERE id=?").run(data.status,data.reason,id);
    if(data.status==="cancelled"){
      releaseAddons(id,actor);
      notifyCancelled({booking_id:id,code:id.slice(0,8).toUpperCase(),customer:booking.customer,order_id:booking.order_id,session:booking,reason:data.reason,paid:booking.paid});
    }
    syncBooking(id);
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
      // Booking batal/kedaluwarsa: seluruh pembayaran boleh dikembalikan. Booking aktif hanya kelebihan
      // bayarnya, mis. link tagihan dan pembayaran tunai yang masuk bersamaan.
      const closed=booking.status==="cancelled"||booking.status==="expired";
      check(closed||booking.paid>booking.total,409,"Batalkan booking sebelum mencatat pengembalian.");
      check(data.amount<=refundable(booking),400,closed?(booking.forfeited?"Pengembalian melebihi pembayaran yang tidak ditahan sebagai denda.":"Pengembalian melebihi pembayaran yang diterima."):"Pengembalian melebihi kelebihan bayar booking ini.");
      check(data.note.length>=3,400,"Isi catatan pengembalian.");
    }
    db.prepare("INSERT INTO payments (id,booking_id,amount,kind,method,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)").run(data.id,id,data.amount,data.kind,data.method,data.note,actor,new Date().toISOString());
    syncBooking(id);
    audit(actor,data.kind,data.id);return {booking:getBooking(id),payments:payments(id)};
  });
}
/** Uang yang masih boleh dikembalikan ke pelanggan. */
export const refundable=(booking:Pick<Booking,"status"|"paid"|"total"|"forfeited">)=>
  booking.status==="cancelled"||booking.status==="expired"?Math.max(0,booking.paid-booking.forfeited):Math.max(0,booking.paid-booking.total);

/** Potongan harga untuk booking aktif. Pajak dihitung ulang dari harga setelah potongan. */
export const discountSchema=z.object({amount:z.number().int().min(0).max(240000000),note:z.string().trim().max(120).default("")});
export function setBookingDiscount(id:string,input:unknown,actor:string){
  const data=discountSchema.parse(input);
  return transaction(()=>{
    const booking=getBooking(id);
    check(booking.status==="confirmed",409,"Potongan harga hanya dapat diubah pada booking yang masih aktif.");
    if(data.amount>0)check(data.note.length>=3,400,"Isi alasan potongan, misalnya \"Member\" atau \"Kompensasi lampu mati\".");
    const extras=(db.prepare("SELECT COALESCE(SUM(subtotal),0) n FROM booking_addons WHERE booking_id=?").get(id) as {n:number}).n;
    const subtotal=booking.court_total+extras;
    check(data.amount<subtotal,400,"Potongan tidak boleh sebesar atau melebihi seluruh tagihan.");
    const bill=billOf(subtotal,data.amount,booking);
    check(bill.total>=booking.paid,409,"Tagihan setelah potongan lebih kecil dari pembayaran yang sudah diterima. Catat pengembaliannya dulu atau kecilkan potongannya.");
    db.prepare("UPDATE bookings SET discount=?,discount_note=?,total=?,tax=? WHERE id=?").run(data.amount,data.amount?data.note:"",bill.total,bill.tax,id);
    syncBooking(id);
    audit(actor,"booking.discount",id);return getBooking(id);
  });
}

/**
 * Booking batal yang uangnya tidak dikembalikan seluruhnya: bagian yang ditahan menjadi pendapatan
 * pembatalan, sisanya tetap boleh dikembalikan. Nilai 0 membatalkan penahanan.
 */
export const forfeitSchema=z.object({amount:z.number().int().min(0).max(240000000)});
export function forfeitBooking(id:string,input:unknown,actor:string){
  const data=forfeitSchema.parse(input);
  return transaction(()=>{
    const booking=getBooking(id);
    check(booking.status==="cancelled"||booking.status==="expired",409,"Hanya pembayaran booking yang batal yang dapat ditahan sebagai denda.");
    check(data.amount<=booking.paid,400,`Yang dapat ditahan paling banyak ${booking.paid.toLocaleString("id-ID")}, yaitu uang yang belum dikembalikan.`);
    db.prepare("UPDATE bookings SET forfeited=?,forfeited_at=? WHERE id=?").run(data.amount,data.amount?localClock().date:null,id);
    syncBooking(id);
    audit(actor,"booking.forfeit",id);return getBooking(id);
  });
}

/** Ubah sewa & tambahan booking aktif. Tagihan ikut berubah, tetapi tidak boleh di bawah pembayaran. */
export function updateBookingAddons(id:string,input:unknown,actor:string){
  const {lines}=z.object({lines:linesSchema}).parse(input);
  return transaction(()=>{
    const booking=getBooking(id);
    check(booking.status==="confirmed",409,"Tambahan hanya dapat diubah pada booking yang masih aktif.");
    applyLines(booking,lines,actor);
    syncBooking(id);
    audit(actor,"booking.addons",id);return {booking:getBooking(id),addons:bookingAddons(id)};
  });
}
/**
 * Pindah jadwal booking aktif ke lapangan, tanggal, atau jam lain. Pembayaran, tambahan, dan
 * potongan harga ikut pindah; harga sewa dihitung ulang dengan tarif slot baru, harga tambahan
 * per jam mengikuti durasi baru, dan stok barang sewa diperiksa di jam baru. Bentrok jadwal
 * dijaga trigger `booking_overlap_move`, jadi dua pemindahan bersamaan tidak bisa sama-sama lolos.
 *
 * Pelanggan (`byCustomer`) hanya boleh bila kebijakan venue mengizinkan, paling lambat
 * `reschedule_hours` jam sebelum main, sekali per booking, dan dengan durasi yang sama.
 */
export const rescheduleSchema=z.object({court_id:z.string().min(1,"Pilih lapangan."),date:dateSchema,start_time:timeSchema,end_time:closeSchema});
export const customerMaxReschedules=1;
const rupiahText=(value:number)=>"Rp"+value.toLocaleString("id-ID");
export function rescheduleBooking(id:string,input:unknown,actor:string,byCustomer=false){
  const data=rescheduleSchema.parse(input);
  return transaction(()=>{
    const booking=getBooking(id),now=localClock();
    check(booking.status==="confirmed",409,"Hanya booking aktif yang dapat dipindah jadwalnya.");
    check(booking.date>now.date||(booking.date===now.date&&booking.end_time>now.time),409,"Sesi ini sudah selesai, jadwalnya tidak dapat dipindah.");
    check(data.court_id!==booking.court_id||data.date!==booking.date||data.start_time!==booking.start_time||data.end_time!==booking.end_time,400,"Jadwal baru masih sama dengan jadwal sekarang.");
    if(byCustomer){
      const policy=getPolicies();
      check(policy.reschedule==="yes",403,"Venue ini tidak melayani pindah jadwal lewat situs. Hubungi venue untuk bantuan.");
      check(booking.reschedule_count<customerMaxReschedules,409,"Booking ini sudah pernah dipindah jadwalnya. Hubungi venue untuk perubahan berikutnya.");
      const startsIn=(Date.parse(`${booking.date}T${booking.start_time}:00Z`)-Date.parse(`${now.date}T${now.time}:00Z`))/3600000;
      check(startsIn>=policy.reschedule_hours,409,policy.reschedule_hours?`Pindah jadwal paling lambat ${policy.reschedule_hours} jam sebelum main. Hubungi venue untuk bantuan.`:"Sesi ini sudah dimulai, jadwalnya tidak dapat dipindah.");
      check(minutes(data.end_time)-minutes(data.start_time)===minutes(booking.end_time)-minutes(booking.start_time),400,"Durasi jadwal baru harus sama dengan booking semula.");
    }
    const court=ensureSlot(data.court_id,data.date,data.start_time,data.end_time);
    // Pendapatan booking dicatat pada tanggal mainnya, jadi kedua tanggal harus berada di periode terbuka.
    ensureOpen(booking.date);ensureOpen(data.date);
    const lines=moveLines(id,{date:data.date,start:data.start_time,end:data.end_time});
    const courtTotal=quote(court,priceRules(),data.date,data.start_time,data.end_time);
    const subtotal=courtTotal+lines.reduce((sum,line)=>sum+line.subtotal,0);
    check(booking.discount<subtotal,409,`Potongan harga ${rupiahText(booking.discount)} lebih besar dari tagihan di jadwal baru. Ubah potongannya terlebih dahulu.`);
    const bill=billOf(subtotal,booking.discount,booking);
    // Staf boleh memindah ke slot yang lebih murah: kelebihan bayarnya tampil sebagai "Perlu pengembalian"
    // dan dicatat lewat refund biasa. Pelanggan tidak, agar venue tidak tiba-tiba berutang pengembalian.
    if(byCustomer)check(bill.total>=booking.paid,409,"Tagihan di jadwal baru lebih kecil dari pembayaran Anda. Pilih jadwal lain atau hubungi venue.");
    db.prepare("UPDATE bookings SET court_id=?,date=?,start_time=?,end_time=?,court_total=?,total=?,tax=?,reschedule_count=reschedule_count+1 WHERE id=?")
      .run(data.court_id,data.date,data.start_time,data.end_time,courtTotal,bill.total,bill.tax,id);
    saveMovedLines(lines);
    syncBooking(id);
    audit(actor,byCustomer?"booking.reschedule.customer":"booking.reschedule",id);
    const after=getBooking(id);
    notifyReschedule({booking_id:id,count:after.reschedule_count,code:id.slice(0,8).toUpperCase(),customer:booking.customer,order_id:booking.order_id,
      before:booking,after,total:after.total,paid:after.paid,by_customer:byCustomer});
    return after;
  });
}
/** Tandai barang sewa sudah (atau belum) dikembalikan pelanggan. */
export function returnBookingAddons(id:string,input:unknown,actor:string){
  return transaction(()=>{
    const booking=getBooking(id);
    check(booking.status==="confirmed"||booking.status==="completed",409,"Booking ini sudah tidak aktif.");
    setReturned(id,input);
    audit(actor,"booking.addons.return",id);return {booking:getBooking(id),addons:bookingAddons(id)};
  });
}


// --- Layout venue ----------------------------------------------------------
// Satuan kanvas: 1 unit = 0,1 meter. Tidak ada rotasi; lapangan mendatar dibuat
// dengan menukar lebar dan tinggi, sehingga kotak selalu sejajar sumbu dan
// pemeriksaan tumpang tindih tetap sederhana dan benar.
// Venue bertingkat punya satu denah per lantai. Posisi x/y berlaku di dalam lantainya,
// jadi dua lapangan boleh berada di koordinat yang sama asalkan beda lantai.
const sideSchema=z.number().int().min(200).max(5000);
/** Lebar dan panjang adalah format lama (satu lantai) dan hanya dipakai bila `floors` tidak dikirim. */
export const venueSchema=z.object({width:sideSchema.optional(),height:sideSchema.optional(),grid:z.number().int().min(5).max(50)});
/** Jenis elemen penjelas. Menambah jenis cukup di sini, tanpa migrasi. */
export const featureKinds=["jalan","pintu-masuk","kantin","tempat-duduk","toilet","parkir","resepsionis","loker","tangga","lift","lainnya"] as const;
export type FeatureKind=typeof featureKinds[number];
export interface VenueFeature {id:string;kind:FeatureKind;label:string;x:number;y:number;w:number;h:number;floor_id:string|null;created_at:string}
export interface Floor {id:string;name:string;position:number;width:number;height:number;created_at:string}
type FloorPlan={id:string;name:string;width:number;height:number};
const boxSchema={x:z.number().int().min(0).max(5000),y:z.number().int().min(0).max(5000),w:z.number().int().min(10).max(5000),h:z.number().int().min(10).max(5000)};
const floorRef=z.string().min(1).max(64).optional();
export const layoutSchema=z.object({
  venue:venueSchema,
  // Daftar lengkap lantai sesuai urutan tampil; lantai yang tidak dikirim dianggap dihapus.
  floors:z.array(z.object({id:z.string().min(1).max(64),name:z.string().trim().min(1,"Isi nama lantai.").max(30,"Nama lantai maksimal 30 karakter."),width:sideSchema,height:sideSchema}))
    .min(1,"Venue minimal punya satu lantai.").max(10,"Maksimal 10 lantai.").optional(),
  courts:z.array(z.object({id:z.string().min(1),floor_id:floorRef,...boxSchema,w:z.number().int().min(20).max(2000),h:z.number().int().min(20).max(2000)})).max(60),
  // Daftar lengkap: elemen yang tidak ikut terkirim dianggap dihapus.
  features:z.array(z.object({id:z.string().min(1).max(64),kind:z.enum(featureKinds),label:z.string().trim().max(40).default(""),floor_id:floorRef,...boxSchema})).max(80).optional(),
});
export function floors(){return db.prepare("SELECT * FROM floors ORDER BY position,created_at").all() as unknown as Floor[]}
function storedVenue(){
  const row=db.prepare("SELECT document FROM settings WHERE key='venue'").get() as {document:string}|undefined;
  return row?JSON.parse(row.document) as VenueLayout:defaultVenue;
}
/** Ukuran lantai pertama beserta kisi, untuk klien yang belum mengenal lantai. */
export function getVenue():VenueLayout{
  const first=floors()[0],stored=storedVenue();
  return first?{width:first.width,height:first.height,grid:stored.grid}:stored;
}
/** Baris tanpa lantai (seharusnya tidak ada setelah migrasi 7) dianggap berada di lantai pertama. */
function withFloor<T extends {floor_id:string|null}>(items:T[]){
  const first=floors()[0]?.id??null;
  return items.map(item=>({...item,floor_id:item.floor_id??first}));
}
export function features(){return withFloor(db.prepare("SELECT * FROM venue_features ORDER BY created_at,id").all() as unknown as VenueFeature[])}
export function layout(){return {venue:getVenue(),floors:floors(),courts:withFloor(courts()),features:features()}}
const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function saveLayout(input:unknown,actor:string){
  const data=layoutSchema.parse(input);
  return transaction(()=>{
    const before=floors();
    check(before.length,500,"Data lantai belum tersedia. Jalankan ulang API agar migrasi berjalan.");
    const plan:FloorPlan[]=data.floors??before.map((floor,index)=>index===0&&data.venue.width&&data.venue.height?{...floor,width:data.venue.width,height:data.venue.height}:floor);
    check(new Set(plan.map(floor=>floor.id)).size===plan.length,400,"Ada lantai dengan id ganda.");
    check(new Set(plan.map(floor=>floor.name.toLowerCase())).size===plan.length,409,"Nama lantai tidak boleh sama.");
    /** Lantai tujuan harus ada di rencana; lantai yang dihapus tidak boleh masih berisi apa pun. */
    const target=(floorId:string|null,what:string):FloorPlan=>{
      const floor=plan.find(item=>item.id===floorId);
      if(floor)return floor;
      const removed=before.find(item=>item.id===floorId);
      check(!removed,409,`${removed?.name} masih berisi ${what}. Pindahkan atau hapus isinya sebelum menghapus lantai.`);
      check(false,400,`Lantai untuk ${what} tidak ditemukan. Muat ulang halaman.`);
    };
    const first=before[0].id;
    const all=courts();
    for(const item of data.courts)check(all.some(c=>c.id===item.id),404,"Ada lapangan yang tidak ditemukan. Muat ulang halaman.");
    // Lapangan yang tidak ikut dikirim tetap menempati ruang, jadi ikut divalidasi.
    const placed=all.map(court=>{
      const moved=data.courts.find(item=>item.id===court.id);
      const box=moved?{x:moved.x,y:moved.y,w:moved.w,h:moved.h}:{x:court.layout_x,y:court.layout_y,w:court.layout_w,h:court.layout_h};
      const floor=target(moved?.floor_id??court.floor_id??first,court.name);
      check(box.x+box.w<=floor.width&&box.y+box.h<=floor.height,400,`Posisi ${court.name} keluar dari area ${floor.name}.`);
      return {...box,id:court.id,name:court.name,floor};
    });
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)
      if(placed[i].floor.id===placed[j].floor.id)
        check(!overlaps(placed[i],placed[j]),409,`${placed[i].name} dan ${placed[j].name} saling menimpa di ${placed[i].floor.name}. Geser salah satunya.`);
    // Elemen penjelas hanya dijaga agar tetap di dalam area lantainya. Saling menimpa
    // dibiarkan, karena menaruh kursi di dalam area lounge itu wajar dan
    // elemen ini tidak memengaruhi jadwal sama sekali.
    const existingFeatures=features();
    const source:{id:string;kind:FeatureKind;label:string;x:number;y:number;w:number;h:number;floor_id?:string|null}[]=data.features??existingFeatures;
    const featurePlan=source.map(item=>{
      const floor=target(item.floor_id??existingFeatures.find(existing=>existing.id===item.id)?.floor_id??first,`elemen ${item.label||item.kind}`);
      check(item.x+item.w<=floor.width&&item.y+item.h<=floor.height,400,`Elemen ${item.label||item.kind} keluar dari area ${floor.name}.`);
      return {...item,floor_id:floor.id};
    });

    // Ukuran di settings disamakan dengan lantai pertama untuk klien lama.
    db.prepare("UPDATE settings SET document=? WHERE key='venue'").run(JSON.stringify({width:plan[0].width,height:plan[0].height,grid:data.venue.grid}));
    const upsertFloor=db.prepare("INSERT INTO floors (id,name,position,width,height,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position,width=excluded.width,height=excluded.height");
    plan.forEach((floor,index)=>upsertFloor.run(floor.id,floor.name,index,floor.width,floor.height,new Date().toISOString()));
    for(const item of placed)db.prepare("UPDATE courts SET layout_x=?,layout_y=?,layout_w=?,layout_h=?,floor_id=? WHERE id=?").run(item.x,item.y,item.w,item.h,item.floor.id,item.id);
    const keep=new Set(featurePlan.map(item=>item.id));
    for(const existing of existingFeatures)if(!keep.has(existing.id))db.prepare("DELETE FROM venue_features WHERE id=?").run(existing.id);
    const upsert=db.prepare("INSERT INTO venue_features (id,kind,label,x,y,w,h,floor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,x=excluded.x,y=excluded.y,w=excluded.w,h=excluded.h,floor_id=excluded.floor_id");
    for(const item of featurePlan)upsert.run(item.id,item.kind,item.label,item.x,item.y,item.w,item.h,item.floor_id,new Date().toISOString());
    // Lantai dihapus paling akhir, setelah tidak ada lagi lapangan atau elemen yang merujuknya.
    const keepFloors=new Set(plan.map(floor=>floor.id));
    for(const floor of before)if(!keepFloors.has(floor.id))db.prepare("DELETE FROM floors WHERE id=?").run(floor.id);
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
  hourly_rate:z.number("Isi tarif per jam.").int("Tarif harus bilangan bulat.").min(1000,"Tarif minimal Rp1.000 per jam.").max(10000000,"Tarif maksimal Rp10.000.000 per jam."),
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
function publicCourt(court:Court,rules:PriceRule[],photos:Map<string,string[]>,firstFloor:string|null){
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
    floor_id:court.floor_id??firstFloor,
    layout:{x:court.layout_x,y:court.layout_y,w:court.layout_w,h:court.layout_h}};
}
/** Lantai untuk pelanggan: cukup nama dan ukuran denahnya. */
export const publicFloors=()=>floors().map(({id,name,width,height})=>({id,name,width,height}));
export function publicCourts(){
  const rules=priceRules(),photos=photoIndex(),first=floors()[0]?.id??null;
  return courts().filter(c=>c.active).map(court=>publicCourt(court,rules,photos,first));
}

// --- Ketersediaan publik ---------------------------------------------------
// Sengaja tidak memuat nama, telepon, atau catatan pemesan.
// `rate` adalah tarif per jam slot itu; `rule` berisi nama tarif khusus bila berlaku.
export type PublicSlot={start:string;end:string;state:"available"|"booked"|"maintenance"|"past";rate:number;rule:string|null};
export function publicAvailability(date:string){
  const now=localClock();
  const active=courts().filter(c=>c.active);
  const taken=bookings(date).filter(occupies);
  const care=maintenances(date);
  const rules=priceRules(),photos=photoIndex(),first=floors()[0]?.id??null;
  const courtsOut=active.map(court=>{
    const slots:PublicSlot[]=[];
    for(let value=minutes(court.opens_at);value+30<=minutes(court.closes_at);value+=30){
      const start=clockLabel(value),end=clockLabel(value+30);
      const busy=taken.some(b=>b.court_id===court.id&&b.start_time<=start&&b.end_time>start);
      const fixing=care.some(m=>m.court_id===court.id&&m.start_time<=start&&m.end_time>start);
      const past=date<now.date||(date===now.date&&start<now.time);
      slots.push({start,end,state:busy?"booked":fixing?"maintenance":past?"past":"available",...rateAt(court,rules,date,start)});
    }
    return {court:publicCourt(court,rules,photos,first),slots};
  });
  return {date,today:now.date,time:now.time,timezone:now.timezone,venue:getVenue(),floors:publicFloors(),features:features(),courts:courtsOut};
}

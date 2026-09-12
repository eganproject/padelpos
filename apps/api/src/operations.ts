import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db,transaction,audit } from "./store.js";
import { check } from "./errors.js";
import { venueTimezone } from "./config.js";

export interface Court {id:string;name:string;hourly_rate:number;opens_at:string;closes_at:string;active:number;created_at:string}
export interface Booking {id:string;court_id:string;court_name:string;customer:string;phone:string;date:string;start_time:string;end_time:string;total:number;status:"confirmed"|"completed"|"cancelled";notes:string;created_by:string;created_at:string;cancel_reason:string;paid:number}
export interface Maintenance {id:string;court_id:string;court_name:string;date:string;start_time:string;end_time:string;reason:string}
export interface Payment {id:string;booking_id:string;amount:number;kind:"payment"|"refund";method:string;note:string;created_at:string;created_by:string}
export function localClock(value:Date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:venueTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`,timezone:venueTimezone};
}
export const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const date=new Date(v+"T00:00:00Z");return !isNaN(date.getTime())&&date.toISOString().slice(0,10)===v},"Tanggal tidak valid.");
export const timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/,"Jam harus menggunakan interval 30 menit.");
const closeSchema=z.union([timeSchema,z.literal("24:00")]);
export const courtSchema=z.object({name:z.string().trim().min(2).max(60),hourly_rate:z.number().int().min(1000).max(10000000),opens_at:timeSchema,closes_at:closeSchema,active:z.boolean()}).refine(v=>v.opens_at<v.closes_at,"Jam tutup harus setelah jam buka.");
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
      db.prepare("UPDATE courts SET name=?,hourly_rate=?,opens_at=?,closes_at=?,active=? WHERE id=?").run(data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),id);
    }else{
      id=randomUUID();db.prepare("INSERT INTO courts VALUES (?,?,?,?,?,?,?)").run(id,data.name,data.hourly_rate,data.opens_at,data.closes_at,Number(data.active),new Date().toISOString());
    }
    audit(actor,existing?"court.update":"court.create",id!);return courts().find(c=>c.id===id)!;
  });
}
export function createBooking(input:unknown,actor:string){
  const data=bookingSchema.parse(input);
  return transaction(()=>{
    const court=schedule(data.court_id,data.date,data.start_time,data.end_time),id=randomUUID();
    const total=Math.round(court.hourly_rate*(minutes(data.end_time)-minutes(data.start_time))/60);
    db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id,data.court_id,data.customer,data.phone,data.date,data.start_time,data.end_time,total,"confirmed",data.notes,actor,new Date().toISOString());
    audit(actor,"booking.create",id);return getBooking(id);
  });
}
export function createMaintenance(input:unknown,actor:string){
  const data=maintenanceSchema.parse(input);
  return transaction(()=>{
    schedule(data.court_id,data.date,data.start_time,data.end_time);const id=randomUUID();
    db.prepare("INSERT INTO maintenance VALUES (?,?,?,?,?,?)").run(id,data.court_id,data.date,data.start_time,data.end_time,data.reason);
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
    db.prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?)").run(data.id,id,data.amount,data.kind,data.method,data.note,actor,new Date().toISOString());
    audit(actor,data.kind,data.id);return {booking:getBooking(id),payments:payments(id)};
  });
}


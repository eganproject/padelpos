import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, getUsers, transaction } from "./store.js";
import { check } from "./errors.js";
import { clockLabel, localClock, minutes } from "./clock.js";
import { checkImage } from "./photos.js";
import { billOf } from "./bill.js";

/**
 * Sewa & tambahan yang ditagihkan bersama booking: raket, bola, sepatu, pelatih, dan sejenisnya.
 *
 *  - sewa     barang dipinjam lalu dikembalikan. `stock` = jumlah unit yang dimiliki. Unit hanya
 *             terpakai selama jam main booking yang memakainya, jadi raket yang sama bisa dipakai
 *             booking pukul 08.00 lalu booking pukul 10.00.
 *  - layanan  diperlakukan sama seperti sewa, tetapi berupa jasa (pelatih, wasit). `stock` = kapasitas
 *             pada jam yang sama, misalnya jumlah pelatih.
 *  - jual     habis pakai (bola, minuman). `stock` = sisa stok. Berkurang saat ditambahkan ke booking,
 *             kembali bila barisnya dihapus atau booking dibatalkan.
 *
 * `stock` bernilai null berarti jumlahnya tidak dibatasi. Setiap baris booking menyimpan salinan nama
 * dan harga, sehingga mengubah katalog tidak pernah mengubah tagihan yang sudah dibuat.
 */
export const addonCategories=["raket","bola","sepatu","handuk","minuman","pelatih","dokumentasi","perlengkapan","lainnya"] as const;
export const addonTypes=["sewa","jual","layanan"] as const;
export const addonPricings=["per_booking","per_hour"] as const;
export type AddonType=typeof addonTypes[number];
export type AddonPricing=typeof addonPricings[number];
export interface Addon {id:string;name:string;category:typeof addonCategories[number];type:AddonType;pricing:AddonPricing;price:number;stock:number|null;low_stock:number;max_per_booking:number;description:string;active:number;online:number;position:number;photo_id:string|null;created_at:string}
export interface BookingAddon {id:string;booking_id:string;addon_id:string|null;name:string;type:AddonType|"lainnya";pricing:AddonPricing;unit_price:number;quantity:number;subtotal:number;returned_at:string|null;created_at:string}
type StockReason="awal"|"restok"|"koreksi"|"rusak"|"terpakai"|"kembali";

/** Booking yang sedang memegang barang: aktif, selesai, atau hold online yang belum kedaluwarsa. */
const holding="(b.status IN ('confirmed','completed') OR (b.status='pending' AND b.hold_expires_at>unixepoch()))";
const columns="id,name,category,type,pricing,price,stock,low_stock,max_per_booking,description,active,online,position,photo_id,created_at";
const rupiah=(value:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);

export const addonSchema=z.object({
  name:z.string().trim().min(2,"Nama item minimal 2 karakter.").max(60,"Nama item maksimal 60 karakter."),
  category:z.enum(addonCategories),
  type:z.enum(addonTypes),
  pricing:z.enum(addonPricings),
  price:z.number().int().min(0,"Harga tidak boleh negatif.").max(10000000,"Harga maksimal Rp10.000.000."),
  stock:z.number().int().min(0,"Stok tidak boleh negatif.").max(100000,"Stok maksimal 100.000.").nullable(),
  low_stock:z.number().int().min(0).max(100000).default(0),
  max_per_booking:z.number().int().min(1,"Batas per booking minimal 1.").max(99,"Batas per booking maksimal 99."),
  description:z.string().trim().max(300,"Deskripsi maksimal 300 karakter.").default(""),
  active:z.boolean(),
  online:z.boolean(),
}).refine(v=>v.type!=="jual"||v.pricing==="per_booking",{message:"Barang jual dihitung per pcs, bukan per jam.",path:["pricing"]});

export function addons(){return db.prepare(`SELECT ${columns} FROM addons ORDER BY position,created_at`).all() as unknown as Addon[]}
function getAddon(id:string){
  const addon=addons().find(item=>item.id===id);
  check(addon,404,"Item tambahan tidak ditemukan.");
  return addon;
}
const usedInBooking=(id:string)=>!!db.prepare("SELECT 1 FROM booking_addons WHERE addon_id=? LIMIT 1").get(id);
/** Katalog untuk admin. `in_use` menandai item yang sudah tercatat di booking sehingga tidak dapat dihapus. */
export function manageAddons(){
  const used=new Set((db.prepare("SELECT DISTINCT addon_id FROM booking_addons WHERE addon_id IS NOT NULL").all() as {addon_id:string}[]).map(row=>row.addon_id));
  return addons().map(addon=>({...addon,in_use:used.has(addon.id)}));
}
const managed=(id:string)=>manageAddons().find(addon=>addon.id===id)!;

function recordMove(addonId:string,delta:number,reason:StockReason,stockAfter:number,actor:string,note="",bookingId:string|null=null){
  db.prepare("INSERT INTO addon_stock_moves (id,addon_id,delta,reason,note,booking_id,stock_after,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(),addonId,delta,reason,note,bookingId,stockAfter,actor,new Date().toISOString());
}

export function saveAddon(input:unknown,actor:string,id?:string){
  const data=addonSchema.parse(input);
  return transaction(()=>{
    const all=addons(),existing=id?all.find(item=>item.id===id):undefined;
    check(!id||existing,404,"Item tambahan tidak ditemukan.");
    check(!all.some(item=>item.id!==id&&item.name.toLowerCase()===data.name.toLowerCase()),409,"Nama item sudah digunakan.");
    if(existing){
      // Stok barang jual sudah dipotong oleh booking lama; mengganti jenis akan merusak hitungannya.
      check(existing.type===data.type||!usedInBooking(existing.id),409,"Jenis item tidak dapat diubah setelah dipakai di booking. Buat item baru bila perlu.");
      db.prepare("UPDATE addons SET name=?,category=?,type=?,pricing=?,price=?,stock=?,low_stock=?,max_per_booking=?,description=?,active=?,online=? WHERE id=?")
        .run(data.name,data.category,data.type,data.pricing,data.price,data.stock,data.low_stock,data.max_per_booking,data.description,Number(data.active),Number(data.online),existing.id);
      if(data.stock!==null&&data.stock!==existing.stock)
        recordMove(existing.id,data.stock-(existing.stock??0),existing.stock===null?"awal":"koreksi",data.stock,actor,existing.stock===null?"Stok mulai dilacak":"Diubah dari formulir item");
    }else{
      id=randomUUID();
      const position=all.length?Math.max(...all.map(item=>item.position))+1:0;
      db.prepare("INSERT INTO addons (id,name,category,type,pricing,price,stock,low_stock,max_per_booking,description,active,online,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id,data.name,data.category,data.type,data.pricing,data.price,data.stock,data.low_stock,data.max_per_booking,data.description,Number(data.active),Number(data.online),position,new Date().toISOString());
      if(data.stock!==null)recordMove(id,data.stock,"awal",data.stock,actor);
    }
    audit(actor,existing?"addon.update":"addon.create",id!);
    return managed(id!);
  });
}

export function removeAddon(id:string,actor:string){transaction(()=>{
  getAddon(id);
  check(!usedInBooking(id),409,"Item ini sudah tercatat di booking. Nonaktifkan saja agar riwayat tagihan tetap utuh.");
  // Riwayat stok ikut terhapus lewat ON DELETE CASCADE.
  db.prepare("DELETE FROM addons WHERE id=?").run(id);
  audit(actor,"addon.delete",id);
})}

export function orderAddons(input:unknown,actor:string){
  const {ids}=z.object({ids:z.array(z.string().min(1)).max(500)}).parse(input);
  return transaction(()=>{
    const current=addons().map(item=>item.id);
    check(ids.length===current.length&&new Set(ids).size===ids.length&&ids.every(id=>current.includes(id)),409,"Daftar item sudah berubah. Muat ulang lalu coba lagi.");
    const update=db.prepare("UPDATE addons SET position=? WHERE id=?");
    ids.forEach((id,position)=>update.run(position,id));
    audit(actor,"addon.order","addons");
    return manageAddons();
  });
}

/** Satu foto per item. Id foto selalu baru agar cache browser untuk foto lama tidak terpakai. */
export function setAddonPhoto(id:string,contentType:string|undefined,body:unknown,actor:string){
  const type=checkImage(contentType,body);
  return transaction(()=>{
    getAddon(id);
    db.prepare("UPDATE addons SET photo_id=?,photo_mime=?,photo_data=? WHERE id=?").run(randomUUID(),type,body as Buffer,id);
    audit(actor,"addon.photo.set",id);
    return managed(id);
  });
}
export function removeAddonPhoto(id:string,actor:string){
  return transaction(()=>{
    getAddon(id);
    db.prepare("UPDATE addons SET photo_id=NULL,photo_mime=NULL,photo_data=NULL WHERE id=?").run(id);
    audit(actor,"addon.photo.delete",id);
    return managed(id);
  });
}

// --- Stok -------------------------------------------------------------------
export const stockSchema=z.object({
  reason:z.enum(["restok","koreksi","rusak"]),
  quantity:z.number().int().min(0,"Jumlah tidak boleh negatif.").max(100000,"Jumlah maksimal 100.000."),
  note:z.string().trim().max(200,"Keterangan maksimal 200 karakter.").default(""),
});
/** restok menambah, rusak mengurangi, koreksi menyetel stok ke hasil hitung fisik. */
export function adjustStock(id:string,input:unknown,actor:string){
  const data=stockSchema.parse(input);
  return transaction(()=>{
    const addon=getAddon(id);
    check(addon.stock!==null,409,"Stok item ini tidak dibatasi. Isi jumlah stok di formulir item untuk mulai melacaknya.");
    const current=addon.stock;
    if(data.reason!=="koreksi")check(data.quantity>0,400,"Jumlah minimal 1.");
    const next=data.reason==="koreksi"?data.quantity:data.reason==="restok"?current+data.quantity:current-data.quantity;
    check(next>=0,400,`Jumlah melebihi stok yang tercatat (${current}).`);
    check(next<=100000,400,"Stok maksimal 100.000.");
    check(next!==current,400,"Jumlah stok tidak berubah.");
    if(data.reason==="rusak")check(data.note.length>=3,400,"Isi keterangan barang rusak atau hilang.");
    db.prepare("UPDATE addons SET stock=? WHERE id=?").run(next,id);
    recordMove(id,next-current,data.reason,next,actor,data.note);
    audit(actor,"addon.stock",id);
    return {addon:managed(id),moves:stockMoves(id)};
  });
}
export function stockMoves(id:string){
  getAddon(id);
  const names=new Map(getUsers().map(user=>[user.id,user.name]));
  const rows=db.prepare("SELECT m.id,m.delta,m.reason,m.note,m.booking_id,m.stock_after,m.created_by,m.created_at,b.customer booking_customer,b.date booking_date FROM addon_stock_moves m LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.addon_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT 60").all(id) as {created_by:string|null}[];
  return rows.map(row=>({...row,actor:row.created_by?names.get(row.created_by)??"":""}));
}

// --- Ketersediaan -----------------------------------------------------------
export type AddonWindow={date:string;start:string;end:string};
/** Unit yang dipakai booking lain pada slot 30 menit tersibuk di dalam rentang. */
function peakUse(addonId:string,window:AddonWindow,excludeBooking:string){
  const rows=db.prepare(`SELECT b.start_time,b.end_time,SUM(l.quantity) quantity FROM booking_addons l JOIN bookings b ON b.id=l.booking_id WHERE l.addon_id=? AND b.date=? AND ${holding} AND b.start_time<? AND b.end_time>? AND b.id<>? GROUP BY b.id`)
    .all(addonId,window.date,window.end,window.start,excludeBooking) as {start_time:string;end_time:string;quantity:number}[];
  let peak=0;
  for(let value=minutes(window.start);value<minutes(window.end);value+=30){
    const at=clockLabel(value);
    peak=Math.max(peak,rows.filter(row=>row.start_time<=at&&row.end_time>at).reduce((sum,row)=>sum+row.quantity,0));
  }
  return peak;
}
/** Jumlah yang masih bisa dipakai booking ini. Barang yang sudah dipegang booking ini dihitung tersedia. */
function remaining(addon:Addon,window:AddonWindow,bookingId=""){
  if(addon.stock===null)return null;
  if(addon.type==="jual"){
    const own=bookingId?(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM booking_addons WHERE booking_id=? AND addon_id=?").get(bookingId,addon.id) as {n:number}).n:0;
    return addon.stock+own;
  }
  return Math.max(0,addon.stock-peakUse(addon.id,window,bookingId));
}
const optionShape=(addon:Addon)=>({id:addon.id,name:addon.name,category:addon.category,type:addon.type,pricing:addon.pricing,price:addon.price,description:addon.description,photo_id:addon.photo_id,max_per_booking:addon.max_per_booking});
/** Pilihan untuk formulir booking staf: semua item aktif, termasuk yang tidak tampil online. */
export function addonOptions(window:AddonWindow,bookingId=""){
  return addons().filter(addon=>addon.active).map(addon=>({...optionShape(addon),online:!!addon.online,available:remaining(addon,window,bookingId)}));
}
/** Pilihan untuk pelanggan. Tanpa rentang jam, `available` untuk sewa adalah jumlah unit. */
export function publicAddons(window?:AddonWindow){
  return addons().filter(addon=>addon.active&&addon.online).map(addon=>({...optionShape(addon),available:window?remaining(addon,window):addon.stock}));
}

// --- Tambahan pada booking --------------------------------------------------
export const lineTotal=(price:number,quantity:number,pricing:AddonPricing,duration:number)=>
  pricing==="per_hour"?Math.round(price*quantity*duration/60):price*quantity;
export const lineSchema=z.object({
  /** Baris yang sudah ada: hanya jumlahnya yang dapat diubah. */
  id:z.string().min(1).max(64).optional(),
  /** Baris baru dari katalog, memakai harga katalog saat ini. */
  addon_id:z.string().min(1).max(64).optional(),
  /** Baris baru di luar katalog, mis. biaya ganti grip yang rusak. */
  name:z.string().trim().min(2,"Nama biaya lain minimal 2 karakter.").max(60,"Nama biaya lain maksimal 60 karakter.").optional(),
  unit_price:z.number().int().min(0,"Harga tidak boleh negatif.").max(10000000).optional(),
  quantity:z.number().int().min(1,"Jumlah minimal 1.").max(99,"Jumlah maksimal 99."),
});
export const linesSchema=z.array(lineSchema).max(30,"Maksimal 30 baris tambahan per booking.");
export function bookingAddons(bookingId:string){
  return db.prepare("SELECT id,booking_id,addon_id,name,type,pricing,unit_price,quantity,subtotal,returned_at,created_at FROM booking_addons WHERE booking_id=? ORDER BY created_at,rowid").all(bookingId) as unknown as BookingAddon[];
}
/** Potong (atau kembalikan bila negatif) stok barang jual yang dilacak. */
function consume(addonId:string|null,quantity:number,bookingId:string,actor:string,note=""){
  if(!addonId||quantity===0)return;
  const row=db.prepare("UPDATE addons SET stock=stock-? WHERE id=? AND type='jual' AND stock IS NOT NULL RETURNING stock").get(quantity,addonId) as {stock:number}|undefined;
  if(row)recordMove(addonId,-quantity,quantity>0?"terpakai":"kembali",row.stock,actor,note,bookingId);
}

export type BookingRef={id:string;date:string;start_time:string;end_time:string;paid:number;court_total:number;discount:number;tax_rate:number;tax_inclusive:number};
/**
 * Ganti seluruh tambahan booking dengan daftar baru, lalu perbarui total tagihan.
 * Harus dipanggil di dalam transaksi. Baris lama yang tidak ikut dikirim dihapus.
 */
export function applyLines(booking:BookingRef,input:unknown,actor:string){
  const lines=linesSchema.parse(input);
  const current=bookingAddons(booking.id),catalog=addons();
  const duration=minutes(booking.end_time)-minutes(booking.start_time);
  const window={date:booking.date,start:booking.start_time,end:booking.end_time};
  type Plan={line?:BookingAddon;addon?:Addon;name:string;type:BookingAddon["type"];pricing:AddonPricing;unit_price:number;quantity:number};
  const plan:Plan[]=[];
  for(const item of lines){
    if(item.id){
      const line=current.find(entry=>entry.id===item.id);
      check(line,409,"Daftar tambahan booking sudah berubah. Muat ulang lalu coba lagi.");
      check(!plan.some(entry=>entry.line?.id===line.id),400,"Ada baris tambahan yang terkirim dua kali.");
      plan.push({line,addon:catalog.find(addon=>addon.id===line.addon_id),name:line.name,type:line.type,pricing:line.pricing,unit_price:line.unit_price,quantity:item.quantity});
    }else if(item.addon_id){
      const addon=catalog.find(entry=>entry.id===item.addon_id);
      check(addon,404,"Item tambahan tidak ditemukan. Muat ulang halaman.");
      check(addon.active,409,`${addon.name} sedang tidak tersedia.`);
      plan.push({addon,name:addon.name,type:addon.type,pricing:addon.pricing,unit_price:addon.price,quantity:item.quantity});
    }else{
      check(item.name!==undefined&&item.unit_price!==undefined,400,"Biaya lain wajib punya nama dan harga.");
      plan.push({name:item.name!,type:"lainnya",pricing:"per_booking",unit_price:item.unit_price!,quantity:item.quantity});
    }
  }
  const seen=new Set<string>();
  for(const entry of plan){
    const addonId=entry.line?entry.line.addon_id:entry.addon?.id;
    if(!addonId)continue;
    check(!seen.has(addonId),400,`${entry.name} tercatat dua kali. Ubah jumlah pada baris yang sudah ada.`);
    seen.add(addonId);
  }
  // Batas hanya diperiksa saat jumlah bertambah, agar booking lama tetap bisa dikurangi
  // walau stok atau batas per booking sudah diturunkan admin.
  for(const entry of plan){
    const addon=entry.addon,previous=entry.line?.quantity??0;
    if(!addon||entry.quantity<=previous)continue;
    check(addon.active,409,`${addon.name} sedang tidak tersedia, jumlahnya hanya dapat dikurangi.`);
    check(entry.quantity<=addon.max_per_booking,400,`${addon.name} maksimal ${addon.max_per_booking} per booking.`);
    if(addon.stock===null)continue;
    if(addon.type==="jual")check(addon.stock>=entry.quantity-previous,409,`Stok ${addon.name} hanya cukup untuk ${addon.stock+previous}.`);
    else{
      const use=peakUse(addon.id,window,booking.id);
      check(use+entry.quantity<=addon.stock,409,`${addon.name} tersisa ${Math.max(0,addon.stock-use)} pada ${booking.start_time}–${booking.end_time}.`);
    }
  }
  const subtotal=booking.court_total+plan.reduce((sum,entry)=>sum+lineTotal(entry.unit_price,entry.quantity,entry.pricing,duration),0);
  check(booking.discount<=subtotal,409,`Potongan harga ${rupiah(booking.discount)} lebih besar dari tagihan baru. Ubah potongannya terlebih dahulu.`);
  const {total,tax}=billOf(subtotal,booking.discount,booking);
  check(total>=booking.paid,409,`Total baru ${rupiah(total)} lebih kecil dari pembayaran yang sudah diterima (${rupiah(booking.paid)}).`);

  const kept=new Set(plan.flatMap(entry=>entry.line?[entry.line.id]:[]));
  for(const line of current){
    if(kept.has(line.id))continue;
    db.prepare("DELETE FROM booking_addons WHERE id=?").run(line.id);
    if(line.type==="jual")consume(line.addon_id,-line.quantity,booking.id,actor,"Dihapus dari booking");
  }
  const now=new Date().toISOString();
  for(const entry of plan){
    const subtotal=lineTotal(entry.unit_price,entry.quantity,entry.pricing,duration);
    if(entry.line){
      if(entry.line.quantity===entry.quantity)continue;
      // Barang sewa yang jumlahnya ditambah belum kembali semuanya.
      db.prepare("UPDATE booking_addons SET quantity=?,subtotal=?,returned_at=CASE WHEN ?>quantity THEN NULL ELSE returned_at END WHERE id=?").run(entry.quantity,subtotal,entry.quantity,entry.line.id);
      if(entry.type==="jual")consume(entry.line.addon_id,entry.quantity-entry.line.quantity,booking.id,actor);
    }else{
      db.prepare("INSERT INTO booking_addons (id,booking_id,addon_id,name,type,pricing,unit_price,quantity,subtotal,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(),booking.id,entry.addon?.id??null,entry.name,entry.type,entry.pricing,entry.unit_price,entry.quantity,subtotal,actor,now);
      if(entry.type==="jual")consume(entry.addon!.id,entry.quantity,booking.id,actor);
    }
  }
  db.prepare("UPDATE bookings SET total=?,tax=? WHERE id=?").run(total,tax,booking.id);
  return total;
}

/** Booking dibatalkan: stok barang jual kembali. Barisnya tetap tersimpan sebagai riwayat tagihan. */
export function releaseAddons(bookingId:string,actor:string){
  for(const line of bookingAddons(bookingId))if(line.type==="jual")consume(line.addon_id,-line.quantity,bookingId,actor,"Booking dibatalkan");
}

export const returnSchema=z.object({line_ids:z.array(z.string().min(1)).min(1,"Pilih barang yang dikembalikan.").max(30),returned:z.boolean()});
export function setReturned(bookingId:string,input:unknown){
  const data=returnSchema.parse(input);
  const lines=bookingAddons(bookingId);
  for(const id of data.line_ids){
    const line=lines.find(entry=>entry.id===id);
    check(line,404,"Barang tidak ditemukan pada booking ini. Muat ulang halaman.");
    check(line.type==="sewa",400,`${line.name} bukan barang sewa.`);
  }
  const update=db.prepare("UPDATE booking_addons SET returned_at=? WHERE id=? AND booking_id=?");
  const stamp=data.returned?new Date().toISOString():null;
  for(const id of data.line_ids)update.run(stamp,id,bookingId);
}

// --- Ringkasan --------------------------------------------------------------
export function addonSummary(){
  const now=localClock();
  const start=new Date(now.date+"T12:00:00Z");start.setUTCDate(start.getUTCDate()-29);
  const since=start.toISOString().slice(0,10);
  const counted="b.status IN ('confirmed','completed')";
  const top=db.prepare(`SELECT l.addon_id,l.name,l.type,SUM(l.quantity) quantity,SUM(l.subtotal) revenue,COUNT(DISTINCT l.booking_id) bookings FROM booking_addons l JOIN bookings b ON b.id=l.booking_id WHERE ${counted} AND b.date BETWEEN ? AND ? GROUP BY COALESCE(l.addon_id,'lain:'||lower(l.name)) ORDER BY revenue DESC,quantity DESC LIMIT 10`).all(since,now.date);
  const sum=(from:string,to:string)=>(db.prepare(`SELECT COALESCE(SUM(l.subtotal),0) n FROM booking_addons l JOIN bookings b ON b.id=l.booking_id WHERE ${counted} AND b.date BETWEEN ? AND ?`).get(from,to) as {n:number}).n;
  // Barang sewa dianggap sedang dibawa pelanggan sejak jam main dimulai.
  const unreturned=db.prepare(`SELECT l.id,l.name,l.quantity,b.id booking_id,b.customer,b.phone,b.date,b.start_time,b.end_time,c.name court_name FROM booking_addons l JOIN bookings b ON b.id=l.booking_id JOIN courts c ON c.id=b.court_id WHERE l.type='sewa' AND l.returned_at IS NULL AND ${counted} AND (b.date<? OR (b.date=? AND b.start_time<=?)) ORDER BY b.date,b.start_time LIMIT 100`).all(now.date,now.date,now.time);
  const lowStock=addons().filter(addon=>addon.active&&addon.stock!==null&&(addon.stock===0||(addon.type==="jual"&&addon.stock<=addon.low_stock)))
    .map(addon=>({id:addon.id,name:addon.name,type:addon.type,stock:addon.stock,low_stock:addon.low_stock}));
  return {since,revenue:sum(since,now.date),today:sum(now.date,now.date),top,unreturned,low_stock:lowStock};
}

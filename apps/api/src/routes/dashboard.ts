import { Router } from "express";
import { requireMenu,type AuthRequest } from "../auth.js";
import { db,getMenus,getRoles } from "../store.js";
import { overview as financeOverview } from "../finance.js";
import { addonSummary,unreturnedRentals } from "../addons.js";
import { bookings,courts,localClock,maintenances,minutes,occupies } from "../operations.js";
import { shiftDate } from "../clock.js";
const router=Router();
router.get("/summary",requireMenu("dashboard"),async (req:AuthRequest,res)=>{
  const now=localClock(),allCourts=await courts(),today=(await bookings(now.date)).filter(occupies);
  // Hanya pembayaran sekitar 7 hari terakhir yang dibaca. Batas bawahnya dilebarkan sehari agar
  // selisih zona waktu venue dengan UTC tidak memotong pembayaran pagi hari pertama.
  const first=shiftDate(now.date,-6);
  const recent=await db.prepare("SELECT amount,kind,created_at FROM payments WHERE created_at>=?").all(shiftDate(first,-1)+"T00:00:00.000Z") as {amount:number;kind:string;created_at:string}[];
  const byDate=new Map<string,number>();
  for(const p of recent){const date=localClock(new Date(p.created_at)).date;byDate.set(date,(byDate.get(date)??0)+(p.kind==="refund"?-p.amount:p.amount))}
  // Transaksi kasir masuk pada saat lunas (Midtrans bisa menyusul); pembatalannya mengembalikan uang pada hari dibatalkan.
  // Transaksi Midtrans yang tidak jadi dibayar tidak pernah punya paid_at.
  const sales=await db.prepare("SELECT total,paid_at,voided_at FROM counter_sales WHERE paid_at IS NOT NULL AND (paid_at>=? OR voided_at>=?)").all(shiftDate(first,-1)+"T00:00:00.000Z",shiftDate(first,-1)+"T00:00:00.000Z") as {total:number;paid_at:string;voided_at:string|null}[];
  const add=(stamp:string,amount:number)=>{const date=localClock(new Date(stamp)).date;byDate.set(date,(byDate.get(date)??0)+amount)};
  for(const sale of sales){add(sale.paid_at,Number(sale.total));if(sale.voided_at)add(sale.voided_at,-Number(sale.total))}
  const daily=Array.from({length:7},(_,index)=>{const date=shiftDate(first,index);return {date,amount:byDate.get(date)??0}});
  const active=allCourts.filter(c=>c.active);
  const maintenance=await maintenances(now.date);
  const availableMinutes=active.reduce((sum,c)=>sum+minutes(c.closes_at)-minutes(c.opens_at)-maintenance.filter(m=>m.court_id===c.id).reduce((n,m)=>n+minutes(m.end_time)-minutes(m.start_time),0),0);
  const occupiedMinutes=today.filter(b=>active.some(c=>c.id===b.court_id)).reduce((sum,b)=>sum+minutes(b.end_time)-minutes(b.start_time),0);
  // Dihitung di SQLite agar tidak memuat seluruh riwayat booking ke memori.
  // Piutang: hanya booking yang benar-benar berjalan; booking online yang batal bayar bukan utang pelanggan.
  // Pengembalian: pembayaran booking batal/kedaluwarsa yang tidak ditahan, dan kelebihan bayar (sama dengan `refundable`).
  const balances=await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN GREATEST(0,b.total-COALESCE(p.paid,0)) ELSE 0 END),0) receivable,
      COALESCE(SUM(CASE WHEN b.status IN ('cancelled','expired') THEN GREATEST(0,COALESCE(p.paid,0)-b.forfeited) ELSE GREATEST(0,COALESCE(p.paid,0)-b.total) END),0) refunds
    FROM bookings b LEFT JOIN (SELECT booking_id,SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) paid FROM payments GROUP BY booking_id) p ON p.booking_id=b.id`).get() as {receivable:number;refunds:number};
  const extras=await addonSummary(),{unreturned}=await unreturnedRentals();
  // Angka pembukuan hanya untuk staf yang memang boleh membuka menu Keuangan.
  const role=(await getRoles()).find(r=>r.slug===req.auth!.role);
  const money=role&&role.menuIds.includes("finance")&&(await getMenus()).some(m=>m.id==="finance"&&m.active)?await financeOverview({}):null;
  const finance=money?{from:money.from,to:money.to,income:money.income,expense:money.expense,net:money.net,cash_total:money.cash_total,payable:money.payable}:null;
  res.json({finance,...now,addons:{today:extras.today,unreturned:unreturned.reduce((sum,line)=>sum+line.quantity,0),low_stock:extras.low_stock},revenueToday:daily[6].amount,revenueWeek:daily.reduce((sum,d)=>sum+d.amount,0),bookingsToday:today.length,occupancy:availableMinutes?Math.round(occupiedMinutes/availableMinutes*100):0,receivable:balances.receivable,refundsDue:balances.refunds,daily,bookings:today,courts:allCourts.map(c=>{
    const maintenanceNow=maintenance.find(m=>m.court_id===c.id&&m.start_time<=now.time&&m.end_time>now.time);
    const bookingNow=today.find(b=>b.court_id===c.id&&b.start_time<=now.time&&b.end_time>now.time);
    return {...c,state:!c.active?"Nonaktif":maintenanceNow?"Maintenance":now.time<c.opens_at||now.time>=c.closes_at?"Tutup":bookingNow?"Digunakan":"Tersedia",until:maintenanceNow?.end_time||bookingNow?.end_time||null};
  })});
});
export default router;

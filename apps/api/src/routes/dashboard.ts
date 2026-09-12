import { Router } from "express";
import { requireMenu } from "../auth.js";
import { db } from "../store.js";
import { bookings,courts,localClock,maintenances,minutes,type Payment } from "../operations.js";
const router=Router();
router.get("/summary",requireMenu("dashboard"),(_req,res)=>{
  const now=localClock(),allBookings=bookings(),allCourts=courts(),today=allBookings.filter(b=>b.date===now.date&&b.status!=="cancelled");
  const allPayments=db.prepare("SELECT * FROM payments").all() as unknown as Payment[];
  const daily=Array.from({length:7},(_,index)=>{
    const day=new Date(now.date+"T12:00:00Z");day.setUTCDate(day.getUTCDate()-6+index);const date=day.toISOString().slice(0,10);
    const amount=allPayments.filter(p=>localClock(new Date(p.created_at)).date===date).reduce((sum,p)=>sum+(p.kind==="refund"?-p.amount:p.amount),0);
    return {date,amount};
  });
  const active=allCourts.filter(c=>c.active);
  const maintenance=maintenances(now.date);
  const availableMinutes=active.reduce((sum,c)=>sum+minutes(c.closes_at)-minutes(c.opens_at)-maintenance.filter(m=>m.court_id===c.id).reduce((n,m)=>n+minutes(m.end_time)-minutes(m.start_time),0),0);
  const occupiedMinutes=today.filter(b=>active.some(c=>c.id===b.court_id)).reduce((sum,b)=>sum+minutes(b.end_time)-minutes(b.start_time),0);
  const receivable=allBookings.filter(b=>b.status!=="cancelled").reduce((sum,b)=>sum+b.total-b.paid,0);
  const refundsDue=allBookings.filter(b=>b.status==="cancelled").reduce((sum,b)=>sum+b.paid,0);
  res.json({...now,revenueToday:daily[6].amount,revenueWeek:daily.reduce((sum,d)=>sum+d.amount,0),bookingsToday:today.length,occupancy:availableMinutes?Math.round(occupiedMinutes/availableMinutes*100):0,receivable,refundsDue,daily,bookings:today,courts:allCourts.map(c=>{
    const maintenanceNow=maintenance.find(m=>m.court_id===c.id&&m.start_time<=now.time&&m.end_time>now.time);
    const bookingNow=today.find(b=>b.court_id===c.id&&b.start_time<=now.time&&b.end_time>now.time);
    return {...c,state:!c.active?"Nonaktif":maintenanceNow?"Maintenance":now.time<c.opens_at||now.time>=c.closes_at?"Tutup":bookingNow?"Digunakan":"Tersedia",until:maintenanceNow?.end_time||bookingNow?.end_time||null};
  })});
});
export default router;


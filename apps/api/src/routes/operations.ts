import { Router } from "express";
import { requireAnyMenu,requireMenu,type AuthRequest } from "../auth.js";
import * as ops from "../operations.js";
const router=Router();
router.get("/context",requireAnyMenu(["bookings","courts"]),(req,res)=>{
  const date=req.query.date===undefined?ops.localClock().date:ops.dateSchema.parse(req.query.date);
  res.json({courts:ops.courts(),maintenance:ops.maintenances(date),schedule:ops.bookings(date).filter(b=>b.status!=="cancelled").map(b=>({id:b.id,court_id:b.court_id,start_time:b.start_time,end_time:b.end_time})),...ops.localClock()});
});
router.get("/courts",requireMenu("courts"),(_req,res)=>res.json({courts:ops.courts(),maintenance:ops.maintenances().filter(m=>m.date>=ops.localClock().date),...ops.localClock()}));
router.post("/courts",requireMenu("courts"),(req:AuthRequest,res)=>res.status(201).json({court:ops.saveCourt(req.body,req.auth!.sub)}));
router.put("/courts/:id",requireMenu("courts"),(req:AuthRequest,res)=>res.json({court:ops.saveCourt(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/courts/:id",requireMenu("courts"),(req:AuthRequest,res)=>{ops.removeCourt(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/layout",requireMenu("layout"),(_req,res)=>res.json(ops.layout()));
router.put("/layout",requireMenu("layout"),(req:AuthRequest,res)=>res.json(ops.saveLayout(req.body,req.auth!.sub)));
router.post("/maintenance",requireMenu("courts"),(req:AuthRequest,res)=>res.status(201).json({maintenance:ops.createMaintenance(req.body,req.auth!.sub)}));
router.delete("/maintenance/:id",requireMenu("courts"),(req:AuthRequest,res)=>{ops.removeMaintenance(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/bookings",requireMenu("bookings"),(req,res)=>{
  const date=req.query.date===undefined?undefined:ops.dateSchema.parse(req.query.date);
  res.json({bookings:ops.bookings(date),...ops.localClock()});
});
router.post("/bookings",requireMenu("bookings"),(req:AuthRequest,res)=>res.status(201).json({booking:ops.createBooking(req.body,req.auth!.sub)}));
router.get("/bookings/:id",requireMenu("bookings"),(req,res)=>{const booking=ops.getBooking(String(req.params.id));res.json({booking,payments:ops.payments(booking.id)})});
router.patch("/bookings/:id/status",requireMenu("bookings"),(req:AuthRequest,res)=>res.json({booking:ops.changeBookingStatus(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/bookings/:id/payments",requireMenu("bookings"),(req:AuthRequest,res)=>res.status(201).json(ops.recordPayment(String(req.params.id),req.body,req.auth!.sub)));
export default router;


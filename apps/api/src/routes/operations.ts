import express, { Router } from "express";
import { requireAnyMenu,requireMenu,type AuthRequest } from "../auth.js";
import * as ops from "../operations.js";
import * as content from "../content.js";
import { addPhoto,maxPhotoSize,orderPhotos,photoIndex,photoTypes,removePhoto } from "../photos.js";
import * as addons from "../addons.js";
import * as finance from "../finance.js";
import { adminPayment,savePaymentSettings,testCredentials } from "../midtrans.js";
import { bookingIntents,createPaymentLink,expireHolds,recentIntents,refreshIntent } from "../payments.js";
import { z } from "zod";
import { check } from "../errors.js";
const router=Router();
router.get("/payments",requireMenu("payments"),(_req,res)=>res.json({settings:adminPayment(),intents:recentIntents(),...ops.localClock()}));
router.put("/payments/settings",requireMenu("payments"),(req:AuthRequest,res)=>res.json({settings:savePaymentSettings(req.body,req.auth!.sub)}));
router.post("/payments/test",requireMenu("payments"),async(_req,res)=>res.json(await testCredentials()));
router.post("/payments/intents/:orderId/refresh",requireMenu("payments"),async(req,res)=>{
  await refreshIntent(String(req.params.orderId));
  res.json({settings:adminPayment(),intents:recentIntents()});
});
const windowQuery=z.object({date:ops.dateSchema,start:ops.timeSchema,end:z.union([ops.timeSchema,z.literal("24:00")]),booking:z.string().min(1).max(64).optional()})
  .refine(v=>v.start<v.end,"Jam selesai harus setelah jam mulai.");
router.get("/addons",requireMenu("addons"),(_req,res)=>res.json({addons:addons.manageAddons(),summary:addons.addonSummary(),...ops.localClock()}));
router.post("/addons",requireMenu("addons"),(req:AuthRequest,res)=>res.status(201).json({addon:addons.saveAddon(req.body,req.auth!.sub)}));
router.put("/addons/order",requireMenu("addons"),(req:AuthRequest,res)=>res.json({addons:addons.orderAddons(req.body,req.auth!.sub)}));
// Pilihan untuk formulir booking: staf kasir cukup punya akses booking.
router.get("/addons/options",requireAnyMenu(["bookings","addons"]),(req,res)=>{
  const query=windowQuery.parse(req.query);
  res.json({addons:addons.addonOptions({date:query.date,start:query.start,end:query.end},query.booking)});
});
router.put("/addons/:id",requireMenu("addons"),(req:AuthRequest,res)=>res.json({addon:addons.saveAddon(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/addons/:id",requireMenu("addons"),(req:AuthRequest,res)=>{addons.removeAddon(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/addons/:id/photo",requireMenu("addons"),express.raw({type:[...photoTypes],limit:maxPhotoSize}),(req:AuthRequest,res)=>res.status(201).json({addon:addons.setAddonPhoto(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.delete("/addons/:id/photo",requireMenu("addons"),(req:AuthRequest,res)=>res.json({addon:addons.removeAddonPhoto(String(req.params.id),req.auth!.sub)}));
router.get("/addons/:id/stock",requireMenu("addons"),(req,res)=>res.json({moves:addons.stockMoves(String(req.params.id))}));
router.post("/addons/:id/stock",requireMenu("addons"),(req:AuthRequest,res)=>res.status(201).json(addons.adjustStock(String(req.params.id),req.body,req.auth!.sub)));
router.get("/context",requireAnyMenu(["bookings","courts"]),(req,res)=>{
  const date=req.query.date===undefined?ops.localClock().date:ops.dateSchema.parse(req.query.date);
  expireHolds();
  res.json({courts:ops.courts(),maintenance:ops.maintenances(date),price_rules:ops.priceRules(),schedule:ops.bookings(date).filter(b=>b.status!=="cancelled").map(b=>({id:b.id,court_id:b.court_id,start_time:b.start_time,end_time:b.end_time})),...ops.localClock()});
});
router.get("/courts",requireMenu("courts"),(_req,res)=>{
  const photos=photoIndex();
  res.json({courts:ops.courts().map(court=>({...court,photos:photos.get(court.id)??[]})),floors:ops.floors(),maintenance:ops.maintenances().filter(m=>m.date>=ops.localClock().date),price_rules:ops.priceRules(),...ops.localClock()});
});
router.post("/courts",requireMenu("courts"),(req:AuthRequest,res)=>res.status(201).json({court:ops.saveCourt(req.body,req.auth!.sub)}));
router.put("/courts/:id",requireMenu("courts"),(req:AuthRequest,res)=>res.json({court:ops.saveCourt(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/courts/:id",requireMenu("courts"),(req:AuthRequest,res)=>{ops.removeCourt(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/courts/:id/photos",requireMenu("courts"),express.raw({type:[...photoTypes],limit:maxPhotoSize}),(req:AuthRequest,res)=>res.status(201).json({photos:addPhoto(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.put("/courts/:id/photos/order",requireMenu("courts"),(req:AuthRequest,res)=>res.json({photos:orderPhotos(String(req.params.id),req.body,req.auth!.sub)}));
router.delete("/courts/:id/photos/:photoId",requireMenu("courts"),(req:AuthRequest,res)=>res.json({photos:removePhoto(String(req.params.id),String(req.params.photoId),req.auth!.sub)}));
router.post("/price-rules",requireMenu("courts"),(req:AuthRequest,res)=>res.status(201).json({price_rules:ops.savePriceRule(req.body,req.auth!.sub)}));
router.put("/price-rules/:id",requireMenu("courts"),(req:AuthRequest,res)=>res.json({price_rules:ops.savePriceRule(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/price-rules/:id",requireMenu("courts"),(req:AuthRequest,res)=>{ops.removePriceRule(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/layout",requireMenu("layout"),(_req,res)=>res.json(ops.layout()));
router.put("/layout",requireMenu("layout"),(req:AuthRequest,res)=>res.json(ops.saveLayout(req.body,req.auth!.sub)));
router.get("/content",requireMenu("info"),(_req,res)=>{
  // Data lapangan ikut dikirim untuk daftar kelengkapan (foto dan deskripsi).
  const photos=photoIndex();
  res.json({...content.content(),courts:ops.courts().filter(c=>c.active).map(c=>({id:c.id,name:c.name,photos:(photos.get(c.id)??[]).length,description:c.description!==""}))});
});
router.put("/content/info",requireMenu("info"),(req:AuthRequest,res)=>res.json({info:content.saveInfo(req.body,req.auth!.sub)}));
router.put("/content/policies",requireMenu("info"),(req:AuthRequest,res)=>res.json({policies:content.savePolicies(req.body,req.auth!.sub)}));
router.put("/content/faqs",requireMenu("info"),(req:AuthRequest,res)=>res.json({faqs:content.saveFaqs(req.body,req.auth!.sub)}));
router.post("/maintenance",requireMenu("courts"),(req:AuthRequest,res)=>res.status(201).json({maintenance:ops.createMaintenance(req.body,req.auth!.sub)}));
router.delete("/maintenance/:id",requireMenu("courts"),(req:AuthRequest,res)=>{ops.removeMaintenance(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/bookings",requireMenu("bookings"),(req,res)=>{
  const date=req.query.date===undefined?undefined:ops.dateSchema.parse(req.query.date);
  expireHolds();
  res.json({bookings:ops.bookings(date),...ops.localClock()});
});
router.post("/bookings",requireMenu("bookings"),(req:AuthRequest,res)=>res.status(201).json({booking:ops.createBooking(req.body,req.auth!.sub)}));
router.get("/bookings/:id",requireMenu("bookings"),(req,res)=>{const booking=ops.getBooking(String(req.params.id));res.json({booking,payments:ops.payments(booking.id),addons:addons.bookingAddons(booking.id),intents:bookingIntents(booking.id)})});
router.post("/bookings/:id/payment-link",requireMenu("bookings"),async(req:AuthRequest,res)=>res.status(201).json({intent:await createPaymentLink(String(req.params.id),req.body,req.auth!.sub)}));
router.patch("/bookings/:id/status",requireMenu("bookings"),(req:AuthRequest,res)=>res.json({booking:ops.changeBookingStatus(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/bookings/:id/payments",requireMenu("bookings"),(req:AuthRequest,res)=>res.status(201).json(ops.recordPayment(String(req.params.id),req.body,req.auth!.sub)));
router.put("/bookings/:id/addons",requireMenu("bookings"),(req:AuthRequest,res)=>res.json(ops.updateBookingAddons(String(req.params.id),req.body,req.auth!.sub)));
router.patch("/bookings/:id/addons/returned",requireMenu("bookings"),(req:AuthRequest,res)=>res.json(ops.returnBookingAddons(String(req.params.id),req.body,req.auth!.sub)));
// --- Keuangan --------------------------------------------------------------
const money=requireMenu("finance");
router.get("/finance/overview",money,(req,res)=>res.json(finance.overview(req.query)));
router.get("/finance/setup",money,(_req,res)=>res.json(finance.setup()));
router.put("/finance/settings",money,(req:AuthRequest,res)=>res.json({settings:finance.saveSettings(req.body,req.auth!.sub)}));
router.post("/finance/accounts",money,(req:AuthRequest,res)=>res.status(201).json({account:finance.saveAccount(req.body,req.auth!.sub)}));
router.put("/finance/accounts/:id",money,(req:AuthRequest,res)=>res.json({account:finance.saveAccount(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/accounts/:id",money,(req:AuthRequest,res)=>{finance.removeAccount(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/partners",money,(req:AuthRequest,res)=>res.status(201).json({partner:finance.savePartner(req.body,req.auth!.sub)}));
router.put("/finance/partners/:id",money,(req:AuthRequest,res)=>res.json({partner:finance.savePartner(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/partners/:id",money,(req:AuthRequest,res)=>{finance.removePartner(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/finance/records",money,(req,res)=>res.json(finance.records(req.query)));
router.post("/finance/records",money,(req:AuthRequest,res)=>res.status(201).json({record:finance.saveRecord(req.body,req.auth!.sub)}));
router.put("/finance/records/:id",money,(req:AuthRequest,res)=>res.json({record:finance.saveRecord(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/records/:id",money,(req:AuthRequest,res)=>{finance.removeRecord(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/records/:id/settle",money,(req:AuthRequest,res)=>res.json({record:finance.settleRecord(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/finance/records/:id/unsettle",money,(req:AuthRequest,res)=>res.json({record:finance.unsettleRecord(String(req.params.id),req.auth!.sub)}));
// Bukti pengeluaran memuat data internal, jadi tidak ikut rute foto publik.
router.get("/finance/records/:id/receipt",money,(req,res)=>{
  const receipt=finance.receiptFile(String(req.params.id));
  check(receipt,404,"Bukti belum diunggah.");
  res.set("Cache-Control","private, max-age=60").type(receipt.mime).send(Buffer.from(receipt.data));
});
router.post("/finance/records/:id/receipt",money,express.raw({type:[...photoTypes],limit:maxPhotoSize}),(req:AuthRequest,res)=>res.status(201).json({record:finance.setReceipt(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.delete("/finance/records/:id/receipt",money,(req:AuthRequest,res)=>res.json({record:finance.removeReceipt(String(req.params.id),req.auth!.sub)}));
router.get("/finance/journal",money,(req,res)=>res.json(finance.journal(req.query)));
router.post("/finance/journal",money,(req:AuthRequest,res)=>res.status(201).json({entry:finance.saveJournal(req.body,req.auth!.sub)}));
router.put("/finance/journal/:id",money,(req:AuthRequest,res)=>res.json({entry:finance.saveJournal(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/journal/:id",money,(req:AuthRequest,res)=>{finance.removeJournal(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/transfer",money,(req:AuthRequest,res)=>res.status(201).json(finance.createTransfer(req.body,req.auth!.sub)));
router.post("/finance/equity",money,(req:AuthRequest,res)=>res.status(201).json(finance.createEquity(req.body,req.auth!.sub)));
router.get("/finance/reports/laba-rugi",money,(req,res)=>res.json(finance.profitLoss(req.query)));
router.get("/finance/reports/neraca",money,(req,res)=>res.json(finance.balanceSheet(req.query)));
router.get("/finance/reports/buku-besar",money,(req,res)=>res.json(finance.generalLedger(req.query)));
router.get("/finance/reports/pembantu",money,(req,res)=>res.json(finance.subsidiaryLedger(req.query)));
export default router;

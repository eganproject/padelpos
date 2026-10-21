import express, { Router } from "express";
import { requireAnyMenu,requireMenu,type AuthRequest } from "../auth.js";
import * as ops from "../operations.js";
import * as content from "../content.js";
import { addPhoto,maxPhotoSize,orderPhotos,photoIndex,photoTypes,removePhoto } from "../photos.js";
import * as addons from "../addons.js";
import * as finance from "../finance.js";
import * as notifications from "../notifications.js";
import * as whatsapp from "../whatsapp.js";
import { taxSnapshot } from "../bill.js";
import { adminAccounts, adminLogin, bookingAccount, linkBooking, saveLoginSettings, testLogin } from "../customers.js";
import { adminPayment,savePaymentSettings,testCredentials } from "../midtrans.js";
import { bookingIntents,createPaymentLink,expireHolds,recentIntents,refreshIntent } from "../payments.js";
import { z } from "zod";
import { check } from "../errors.js";
import { audit } from "../store.js";
import { auditFilters, auditLog } from "../auditlog.js";
import * as backups from "../backups.js";
import * as receipts from "../receipts.js";
import * as members from "../membership.js";
import * as counter from "../counter.js";
import * as brand from "../brand.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
const router=Router();
router.get("/payments",requireMenu("payments"),async (_req,res)=>res.json({settings:await adminPayment(),intents:await recentIntents(),...ops.localClock()}));
router.put("/payments/settings",requireMenu("payments"),async (req:AuthRequest,res)=>res.json({settings:await savePaymentSettings(req.body,req.auth!.sub)}));
router.post("/payments/test",requireMenu("payments"),async(_req,res)=>res.json(await testCredentials()));
router.post("/payments/intents/:orderId/refresh",requireMenu("payments"),async(req,res)=>{
  await refreshIntent(String(req.params.orderId));
  res.json({settings:await adminPayment(),intents:await recentIntents()});
});
const windowQuery=z.object({date:ops.dateSchema,start:ops.timeSchema,end:z.union([ops.timeSchema,z.literal("24:00")]),booking:z.string().min(1).max(64).optional()})
  .refine(v=>v.start<v.end,"Jam selesai harus setelah jam mulai.");
router.get("/addons",requireMenu("addons"),async (_req,res)=>res.json({addons:await addons.manageAddons(),summary:await addons.addonSummary(),...ops.localClock()}));
router.post("/addons",requireMenu("addons"),async (req:AuthRequest,res)=>res.status(201).json({addon:await addons.saveAddon(req.body,req.auth!.sub)}));
router.put("/addons/order",requireMenu("addons"),async (req:AuthRequest,res)=>res.json({addons:await addons.orderAddons(req.body,req.auth!.sub)}));
// Pilihan untuk formulir booking: staf kasir cukup punya akses booking.
router.get("/addons/options",requireAnyMenu(["bookings","addons"]),async (req,res)=>{
  const query=windowQuery.parse(req.query);
  res.json({addons:await addons.addonOptions({date:query.date,start:query.start,end:query.end},query.booking)});
});
router.put("/addons/:id",requireMenu("addons"),async (req:AuthRequest,res)=>res.json({addon:await addons.saveAddon(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/addons/:id",requireMenu("addons"),async (req:AuthRequest,res)=>{await addons.removeAddon(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/addons/:id/photo",requireMenu("addons"),express.raw({type:[...photoTypes],limit:maxPhotoSize}),async (req:AuthRequest,res)=>res.status(201).json({addon:await addons.setAddonPhoto(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.delete("/addons/:id/photo",requireMenu("addons"),async (req:AuthRequest,res)=>res.json({addon:await addons.removeAddonPhoto(String(req.params.id),req.auth!.sub)}));
router.get("/addons/:id/stock",requireMenu("addons"),async (req,res)=>res.json({moves:await addons.stockMoves(String(req.params.id))}));
router.post("/addons/:id/stock",requireMenu("addons"),async (req:AuthRequest,res)=>res.status(201).json(await addons.adjustStock(String(req.params.id),req.body,req.auth!.sub)));
router.get("/context",requireAnyMenu(["bookings","courts"]),async (req,res)=>{
  const date=req.query.date===undefined?ops.localClock().date:ops.dateSchema.parse(req.query.date);
  await expireHolds();
  res.json({courts:await ops.courts(),maintenance:await ops.maintenances(date),price_rules:await ops.priceRules(),tax:await taxSnapshot(),schedule:(await ops.bookings(date)).filter(ops.occupies).map(b=>({id:b.id,court_id:b.court_id,start_time:b.start_time,end_time:b.end_time})),...ops.localClock()});
});
router.get("/courts",requireMenu("courts"),async (_req,res)=>{
  const photos=await photoIndex();
  res.json({courts:(await ops.courts()).map(court=>({...court,photos:photos.get(court.id)??[]})),floors:await ops.floors(),maintenance:(await ops.maintenances()).filter(m=>m.date>=ops.localClock().date),price_rules:await ops.priceRules(),...ops.localClock()});
});
router.post("/courts",requireMenu("courts"),async (req:AuthRequest,res)=>res.status(201).json({court:await ops.saveCourt(req.body,req.auth!.sub)}));
router.put("/courts/:id",requireMenu("courts"),async (req:AuthRequest,res)=>res.json({court:await ops.saveCourt(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/courts/:id",requireMenu("courts"),async (req:AuthRequest,res)=>{await ops.removeCourt(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/courts/:id/photos",requireMenu("courts"),express.raw({type:[...photoTypes],limit:maxPhotoSize}),async (req:AuthRequest,res)=>res.status(201).json({photos:await addPhoto(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.put("/courts/:id/photos/order",requireMenu("courts"),async (req:AuthRequest,res)=>res.json({photos:await orderPhotos(String(req.params.id),req.body,req.auth!.sub)}));
router.delete("/courts/:id/photos/:photoId",requireMenu("courts"),async (req:AuthRequest,res)=>res.json({photos:await removePhoto(String(req.params.id),String(req.params.photoId),req.auth!.sub)}));
router.post("/price-rules",requireMenu("courts"),async (req:AuthRequest,res)=>res.status(201).json({price_rules:await ops.savePriceRule(req.body,req.auth!.sub)}));
router.put("/price-rules/:id",requireMenu("courts"),async (req:AuthRequest,res)=>res.json({price_rules:await ops.savePriceRule(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/price-rules/:id",requireMenu("courts"),async (req:AuthRequest,res)=>{await ops.removePriceRule(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/layout",requireMenu("layout"),async (_req,res)=>res.json(await ops.layout()));
router.put("/layout",requireMenu("layout"),async (req:AuthRequest,res)=>res.json(await ops.saveLayout(req.body,req.auth!.sub)));
router.get("/content",requireMenu("info"),async (_req,res)=>{
  // Data lapangan ikut dikirim untuk daftar kelengkapan (foto dan deskripsi).
  const photos=await photoIndex();
  res.json({...await content.content(),courts:(await ops.courts()).filter(c=>c.active).map(c=>({id:c.id,name:c.name,photos:(photos.get(c.id)??[]).length,description:c.description!==""}))});
});
router.put("/content/info",requireMenu("info"),async (req:AuthRequest,res)=>res.json({info:await content.saveInfo(req.body,req.auth!.sub)}));
router.put("/content/policies",requireMenu("info"),async (req:AuthRequest,res)=>res.json({policies:await content.savePolicies(req.body,req.auth!.sub)}));
router.put("/content/faqs",requireMenu("info"),async (req:AuthRequest,res)=>res.json({faqs:await content.saveFaqs(req.body,req.auth!.sub)}));
// Pengaturan > Brand: nama, kontak, warna, logo, dan favicon. Logo diperkecil di browser sebelum diunggah.
router.get("/brand",requireMenu("brand"),async (_req,res)=>res.json(await brand.brandForAdmin()));
router.put("/brand",requireMenu("brand"),async (req:AuthRequest,res)=>res.json(await brand.saveBrand(req.body,req.auth!.sub)));
router.post("/brand/assets/:kind",requireMenu("brand"),express.raw({type:[...photoTypes],limit:brand.maxBrandAssetSize}),async (req:AuthRequest,res)=>res.json(await brand.setBrandAsset(String(req.params.kind),req.get("content-type"),req.body,req.auth!.sub)));
router.delete("/brand/assets/:kind",requireMenu("brand"),async (req:AuthRequest,res)=>res.json(await brand.removeBrandAsset(String(req.params.kind),req.auth!.sub)));
router.post("/maintenance",requireMenu("courts"),async (req:AuthRequest,res)=>res.status(201).json({maintenance:await ops.createMaintenance(req.body,req.auth!.sub)}));
router.delete("/maintenance/:id",requireMenu("courts"),async (req:AuthRequest,res)=>{await ops.removeMaintenance(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/bookings",requireMenu("bookings"),async (req,res)=>{
  await expireHolds();
  res.json({...await ops.searchBookings(req.query),...ops.localClock()});
});
router.post("/bookings",requireMenu("bookings"),async (req:AuthRequest,res)=>res.status(201).json({booking:await ops.createBooking(req.body,req.auth!.sub)}));
router.get("/bookings/:id",requireMenu("bookings"),async (req,res)=>{const booking=await ops.getBooking(String(req.params.id));res.json({booking,payments:await ops.payments(booking.id),addons:await addons.bookingAddons(booking.id),intents:await bookingIntents(booking.id),account:await bookingAccount(booking),sales:await counter.bookingSales(booking.id)})});
// Nota cetak: kasir yang membuka booking boleh mencetak; pengaturan bawaannya punya menu sendiri.
router.get("/bookings/:id/receipt",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await receipts.bookingReceipt(String(req.params.id),req.auth!.sub)));
router.get("/receipt-settings",requireAnyMenu(["receipts","bookings"]),async (_req,res)=>res.json({settings:await receipts.receiptSettings()}));
router.put("/receipt-settings",requireMenu("receipts"),async (req:AuthRequest,res)=>res.json({settings:await receipts.saveReceiptSettings(req.body,req.auth!.sub)}));
router.post("/bookings/:id/reschedule",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({booking:await ops.rescheduleBooking(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/bookings/:id/account",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({account:await linkBooking(String(req.params.id),req.body,req.auth!.sub)}));

// Notifikasi email: pengaturan SMTP, email uji, dan antrean kiriman.
router.get("/audit",requireMenu("audit"),async (req,res)=>res.json({...await auditLog(req.query),filters:await auditFilters()}));
router.get("/backups",requireMenu("backups"),async (_req,res)=>res.json(await backups.backupOverview()));
router.post("/backups",requireMenu("backups"),async (req:AuthRequest,res)=>{
  const result=await backups.createBackup("manual");
  await audit(req.auth!.sub,"backup.create",result.name,{rows:Object.values(result.counts).reduce((a,b)=>a+b,0)});
  res.status(201).json({...await backups.backupOverview(),created:result.name});
});
router.put("/backups/settings",requireMenu("backups"),async (req:AuthRequest,res)=>res.json(await backups.saveBackupSettings(req.body,req.auth!.sub)));
router.get("/backups/:name/download",requireMenu("backups"),async (req:AuthRequest,res)=>{
  const name=String(req.params.name),file=backups.backupPath(name);
  const info=await stat(file).catch(()=>undefined);check(info&&info.isFile(),404,"Berkas backup tidak ditemukan.");
  await audit(req.auth!.sub,"backup.download",name);
  res.setHeader("Content-Type","application/gzip");res.setHeader("Content-Length",String(info.size));
  res.setHeader("Content-Disposition",`attachment; filename="${name}"`);res.setHeader("Cache-Control","no-store");
  createReadStream(file).on("error",()=>res.destroy()).pipe(res);
});
router.delete("/backups/:name",requireMenu("backups"),async (req:AuthRequest,res)=>{await backups.removeBackup(String(req.params.name),req.auth!.sub);res.json(await backups.backupOverview())});
router.get("/notifications",requireMenu("notifications"),async (_req,res)=>res.json({settings:await notifications.adminEmail(),outbox:await notifications.outbox(),whatsapp:{settings:await whatsapp.adminWhatsApp(),outbox:await whatsapp.whatsappOutbox()}}));
// WhatsApp: penyedia, pesan uji, dan antrean kiriman. Didaftarkan sebelum rute ber-:id di bawah.
router.put("/notifications/whatsapp",requireMenu("notifications"),async (req:AuthRequest,res)=>res.json({settings:await whatsapp.saveWhatsAppSettings(req.body,req.auth!.sub)}));
router.post("/notifications/whatsapp/test",requireMenu("notifications"),async(req:AuthRequest,res)=>res.json(await whatsapp.sendTestWhatsApp(req.body,req.auth!.sub)));
router.post("/notifications/whatsapp/:id/retry",requireMenu("notifications"),async(req:AuthRequest,res)=>{await whatsapp.retryWhatsApp(String(req.params.id),req.auth!.sub);res.json({outbox:await whatsapp.whatsappOutbox()})});
router.put("/notifications/settings",requireMenu("notifications"),async (req:AuthRequest,res)=>res.json({settings:await notifications.saveEmailSettings(req.body,req.auth!.sub)}));
router.post("/notifications/test",requireMenu("notifications"),async(req:AuthRequest,res)=>res.json(await notifications.sendTestEmail(req.body,req.auth!.sub)));
router.post("/notifications/:id/retry",requireMenu("notifications"),async(req:AuthRequest,res)=>{await notifications.retryEmail(String(req.params.id),req.auth!.sub);res.json({outbox:await notifications.outbox()})});

// Akun pelanggan dan pengaturan login Google (Firebase).
router.get("/customers",requireMenu("customers"),async (_req,res)=>res.json({settings:await adminLogin(),accounts:await adminAccounts()}));
// Pengaturan login Firebase punya menu sendiri di grup Pengaturan, terpisah dari daftar pelanggan.
router.get("/customers/login",requireMenu("customer-login"),async (_req,res)=>res.json({settings:await adminLogin()}));
router.put("/customers/login",requireMenu("customer-login"),async (req:AuthRequest,res)=>res.json({settings:await saveLoginSettings(req.body,req.auth!.sub)}));
router.post("/customers/login/test",requireMenu("customer-login"),async(_req,res)=>res.json(await testLogin()));
router.post("/bookings/:id/payment-link",requireMenu("bookings"),async(req:AuthRequest,res)=>res.status(201).json({intent:await createPaymentLink(String(req.params.id),req.body,req.auth!.sub)}));
router.patch("/bookings/:id/status",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({booking:await ops.changeBookingStatus(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/bookings/:id/payments",requireMenu("bookings"),async (req:AuthRequest,res)=>res.status(201).json(await ops.recordPayment(String(req.params.id),req.body,req.auth!.sub)));
router.put("/bookings/:id/member",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({booking:await ops.setBookingMember(String(req.params.id),req.body,req.auth!.sub)}));
// Member: kasir cukup akses Booking untuk mencari member saat membuat booking.
router.get("/members/lookup",requireAnyMenu(["bookings","members"]),async (req,res)=>res.json({members:await members.lookupMembers(req.query)}));
router.get("/members",requireMenu("members"),async (req,res)=>res.json({...await members.listMembers(req.query),plans:await members.plans(),settings:await members.membershipSettings(),...ops.localClock()}));
router.post("/members",requireMenu("members"),async (req:AuthRequest,res)=>res.status(201).json(await members.registerMember(req.body,req.auth!.sub)));
router.put("/members/settings",requireMenu("members"),async (req:AuthRequest,res)=>res.json({settings:await members.saveMembershipSettings(req.body,req.auth!.sub)}));
router.post("/members/plans",requireMenu("members"),async (req:AuthRequest,res)=>res.status(201).json({plan:await members.savePlan(req.body,req.auth!.sub)}));
router.put("/members/plans/:id",requireMenu("members"),async (req:AuthRequest,res)=>res.json({plan:await members.savePlan(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/members/plans/:id",requireMenu("members"),async (req:AuthRequest,res)=>{await members.removePlan(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/members/:id",requireMenu("members"),async (req,res)=>res.json(await members.memberDetail(String(req.params.id))));
router.put("/members/:id",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.updateMember(String(req.params.id),req.body,req.auth!.sub)));
router.post("/members/:id/renew",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.renewMember(String(req.params.id),req.body,req.auth!.sub)));
router.post("/members/:id/invoices/:invoiceId/pay",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.payInvoice(String(req.params.id),String(req.params.invoiceId),req.body,req.auth!.sub)));
router.post("/members/:id/approve",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.approveMember(String(req.params.id),req.auth!.sub)));
router.post("/members/:id/freeze",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.freezeMember(String(req.params.id),req.body,req.auth!.sub)));
router.post("/members/:id/cancel",requireMenu("members"),async (req:AuthRequest,res)=>res.json(await members.cancelMember(String(req.params.id),req.body,req.auth!.sub)));
router.put("/bookings/:id/discount",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({booking:await ops.setBookingDiscount(String(req.params.id),req.body,req.auth!.sub)}));
router.put("/bookings/:id/forfeit",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json({booking:await ops.forfeitBooking(String(req.params.id),req.body,req.auth!.sub)}));
router.put("/bookings/:id/addons",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await ops.updateBookingAddons(String(req.params.id),req.body,req.auth!.sub)));
router.patch("/bookings/:id/addons/returned",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await ops.returnBookingAddons(String(req.params.id),req.body,req.auth!.sub)));
// Barang sewa yang belum kembali, dari booking maupun sewa langsung, ditampilkan di halaman Booking.
router.get("/rentals/unreturned",requireMenu("bookings"),async (_req,res)=>res.json(await addons.unreturnedRentals()));
// Transaksi langsung di kasir tanpa booking lapangan: sewa raket, beli bola, minuman, dan sejenisnya.
router.get("/counter",requireMenu("bookings"),async (req,res)=>res.json(await counter.listSales(req.query)));
router.get("/counter/options",requireMenu("bookings"),async (req,res)=>res.json(await counter.saleOptions(req.query)));
router.get("/counter/customers",requireMenu("bookings"),async (req,res)=>res.json(await counter.customerOptions(req.query)));
router.post("/counter",requireMenu("bookings"),async (req:AuthRequest,res)=>res.status(201).json(await counter.createSale(req.body,req.auth!.sub)));
router.get("/counter/:id",requireMenu("bookings"),async (req,res)=>res.json(await counter.detail(String(req.params.id))));
router.post("/counter/:id/refresh",requireMenu("bookings"),async (req,res)=>res.json(await counter.refreshSale(String(req.params.id))));
router.get("/counter/:id/receipt",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await receipts.saleReceipt(String(req.params.id),req.auth!.sub)));
router.patch("/counter/:id/returned",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await counter.returnSaleLines(String(req.params.id),req.body,req.auth!.sub)));
router.post("/counter/:id/void",requireMenu("bookings"),async (req:AuthRequest,res)=>res.json(await counter.voidSale(String(req.params.id),req.body,req.auth!.sub)));
// --- Keuangan --------------------------------------------------------------
// Keuangan dipecah menjadi beberapa menu; tiap menu hanya membuka endpoint yang dipakainya.
const money=requireMenu("finance"),records=requireMenu("finance-records"),journal=requireMenu("finance-journal"),reports=requireMenu("finance-reports"),books=requireMenu("finance-settings");
const anyFinance=requireAnyMenu(["finance","finance-records","finance-journal","finance-reports","finance-settings"]);
const partnerWrite=requireAnyMenu(["finance-settings","finance-records"]);
router.get("/finance/overview",money,async (req,res)=>res.json(await finance.overview(req.query)));
router.get("/finance/setup",anyFinance,async (_req,res)=>res.json(await finance.setup()));
router.put("/finance/settings",books,async (req:AuthRequest,res)=>res.json({settings:await finance.saveSettings(req.body,req.auth!.sub)}));
router.post("/finance/accounts",books,async (req:AuthRequest,res)=>res.status(201).json({account:await finance.saveAccount(req.body,req.auth!.sub)}));
router.put("/finance/accounts/:id",books,async (req:AuthRequest,res)=>res.json({account:await finance.saveAccount(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/accounts/:id",books,async (req:AuthRequest,res)=>{await finance.removeAccount(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/partners",partnerWrite,async (req:AuthRequest,res)=>res.status(201).json({partner:await finance.savePartner(req.body,req.auth!.sub)}));
router.put("/finance/partners/:id",partnerWrite,async (req:AuthRequest,res)=>res.json({partner:await finance.savePartner(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/partners/:id",books,async (req:AuthRequest,res)=>{await finance.removePartner(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.get("/finance/records",records,async (req,res)=>res.json(await finance.records(req.query)));
router.post("/finance/records",records,async (req:AuthRequest,res)=>res.status(201).json({record:await finance.saveRecord(req.body,req.auth!.sub)}));
router.put("/finance/records/:id",records,async (req:AuthRequest,res)=>res.json({record:await finance.saveRecord(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/records/:id",records,async (req:AuthRequest,res)=>{await finance.removeRecord(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/records/:id/settle",records,async (req:AuthRequest,res)=>res.json({record:await finance.settleRecord(String(req.params.id),req.body,req.auth!.sub)}));
router.post("/finance/records/:id/unsettle",records,async (req:AuthRequest,res)=>res.json({record:await finance.unsettleRecord(String(req.params.id),req.auth!.sub)}));
// Bukti pengeluaran memuat data internal, jadi tidak ikut rute foto publik.
router.get("/finance/records/:id/receipt",records,async (req,res)=>{
  const receipt=await finance.receiptFile(String(req.params.id));
  check(receipt,404,"Bukti belum diunggah.");
  res.set("Cache-Control","private, max-age=60").type(receipt.mime).send(Buffer.from(receipt.data));
});
router.post("/finance/records/:id/receipt",records,express.raw({type:[...photoTypes],limit:maxPhotoSize}),async (req:AuthRequest,res)=>res.status(201).json({record:await finance.setReceipt(String(req.params.id),req.get("content-type"),req.body,req.auth!.sub)}));
router.delete("/finance/records/:id/receipt",records,async (req:AuthRequest,res)=>res.json({record:await finance.removeReceipt(String(req.params.id),req.auth!.sub)}));
router.get("/finance/journal",journal,async (req,res)=>res.json(await finance.journal(req.query)));
router.post("/finance/journal",journal,async (req:AuthRequest,res)=>res.status(201).json({entry:await finance.saveJournal(req.body,req.auth!.sub)}));
router.put("/finance/journal/:id",journal,async (req:AuthRequest,res)=>res.json({entry:await finance.saveJournal(req.body,req.auth!.sub,String(req.params.id))}));
router.delete("/finance/journal/:id",journal,async (req:AuthRequest,res)=>{await finance.removeJournal(String(req.params.id),req.auth!.sub);res.status(204).send()});
router.post("/finance/transfer",records,async (req:AuthRequest,res)=>res.status(201).json(await finance.createTransfer(req.body,req.auth!.sub)));
router.post("/finance/equity",records,async (req:AuthRequest,res)=>res.status(201).json(await finance.createEquity(req.body,req.auth!.sub)));
router.get("/finance/reports/laba-rugi",reports,async (req,res)=>res.json(await finance.profitLoss(req.query)));
router.get("/finance/reports/neraca",reports,async (req,res)=>res.json(await finance.balanceSheet(req.query)));
router.get("/finance/reports/buku-besar",reports,async (req,res)=>res.json(await finance.generalLedger(req.query)));
router.get("/finance/reports/pembantu",reports,async (req,res)=>res.json(await finance.subsidiaryLedger(req.query)));
export default router;

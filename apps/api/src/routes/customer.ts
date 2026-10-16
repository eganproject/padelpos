import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { createCustomerSession, customerAccountId, endCustomerSession } from "../auth.js";
import { claim, deleteAccount, history, overview, publicAccount, rescheduleOwn, signIn, getAccount, updateProfile } from "../customers.js";

/** Area akun pelanggan. Terpisah dari sesi staf: cookie, batas permintaan, dan hak aksesnya sendiri. */
const router = Router();
const limit = (windowMinutes: number, max: number, message: string) =>
  rateLimit({ windowMs: windowMinutes * 60 * 1000, limit: max, standardHeaders: "draft-8", legacyHeaders: false, message: { message } });

router.use(limit(1, 90, "Terlalu banyak permintaan. Coba lagi sebentar lagi."));

type CustomerRequest = Request & { accountId?: string };
function requireCustomer(req: CustomerRequest, res: Response, next: NextFunction) {
  const accountId = customerAccountId(req);
  if (!accountId) return res.status(401).json({ message: "Silakan masuk dengan akun Google terlebih dahulu." });
  req.accountId = accountId;
  next();
}

/** Tukar ID token Firebase dengan sesi aplikasi. */
router.post("/session", limit(15, 30, "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit."), async (req, res) => {
  const { account, created } = await signIn(req.body?.id_token);
  createCustomerSession(res, account.id);
  res.status(created ? 201 : 200).json({ account: publicAccount(account), created });
});
/**
 * Status sesi untuk browser: tamu mendapat `account: null`, bukan 401. Setiap halaman
 * menanyakannya, dan 401 akan tercatat sebagai galat di konsol setiap pengunjung.
 */
router.get("/session", (req, res) => {
  const accountId = customerAccountId(req);
  let account = null;
  if (accountId) { try { account = publicAccount(getAccount(accountId)); } catch { account = null; } }
  res.json({ account });
});
router.post("/logout", (req, res) => { endCustomerSession(req, res); res.status(204).send(); });

router.get("/me", requireCustomer, (req: CustomerRequest, res) => res.json({ account: publicAccount(getAccount(req.accountId!)) }));
router.put("/me", requireCustomer, (req: CustomerRequest, res) => res.json({ account: updateProfile(req.accountId!, req.body) }));
router.delete("/me", requireCustomer, (req: CustomerRequest, res) => {
  deleteAccount(req.accountId!);
  endCustomerSession(req, res);
  res.status(204).send();
});
router.get("/overview", requireCustomer, (req: CustomerRequest, res) => res.json(overview(req.accountId!)));
router.get("/bookings", requireCustomer, (req: CustomerRequest, res) => res.json(history(req.accountId!, req.query.scope)));
router.post("/bookings/:id/reschedule", requireCustomer, limit(15, 10, "Terlalu banyak percobaan pindah jadwal. Coba lagi dalam 15 menit."),
  (req: CustomerRequest, res) => res.json({ booking: rescheduleOwn(req.accountId!, String(req.params.id), req.body) }));
router.post("/claim", requireCustomer, limit(15, 10, "Terlalu banyak percobaan klaim. Coba lagi dalam 15 menit."),
  (req: CustomerRequest, res) => res.json(claim(req.accountId!, req.body)));

export default router;

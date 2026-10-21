import express, { Router, type NextFunction, type Request, type Response } from "express";
import { limiter } from "../ratelimit.js";
import { maxAvatarSize, removeCustomerAvatar, setCustomerAvatar } from "../avatars.js";
import { photoTypes } from "../photos.js";
import { createCustomerSession, customerAccountId, endCustomerSession } from "../auth.js";
import { claim, deleteAccount, history, overview, publicAccount, rescheduleOwn, signIn, getAccount, updateProfile } from "../customers.js";
import { inbox, markRead, savePreferences, unreadCount } from "../inbox.js";
import { claimMembership, customerMembership, payAgain, refreshMine, renewOnline, signup } from "../membership.js";

/** Area akun pelanggan. Terpisah dari sesi staf: cookie, batas permintaan, dan hak aksesnya sendiri. */
const router = Router();
const limit = (windowMinutes: number, max: number, message: string) =>
  limiter(windowMinutes * 60 * 1000, max, message);

router.use(limit(1, 90, "Terlalu banyak permintaan. Coba lagi sebentar lagi."));

type CustomerRequest = Request & { accountId?: string };
async function requireCustomer(req: CustomerRequest, res: Response, next: NextFunction) {
  const accountId = await customerAccountId(req);
  if (!accountId) return res.status(401).json({ message: "Silakan masuk dengan akun Google terlebih dahulu." });
  req.accountId = accountId;
  next();
}

/** Tukar ID token Firebase dengan sesi aplikasi. */
router.post("/session", limit(15, 30, "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit."), async (req, res) => {
  const { account, created } = await signIn(req.body?.id_token);
  await createCustomerSession(res, account.id);
  res.status(created ? 201 : 200).json({ account: publicAccount(account), created });
});
/**
 * Status sesi untuk browser: tamu mendapat `account: null`, bukan 401. Setiap halaman
 * menanyakannya, dan 401 akan tercatat sebagai galat di konsol setiap pengunjung.
 */
router.get("/session", async (req, res) => {
  const accountId = await customerAccountId(req);
  let account = null;
  if (accountId) { try { account = publicAccount(await getAccount(accountId)); } catch { account = null; } }
  res.json({ account });
});
router.post("/logout", async (req, res) => { await endCustomerSession(req, res); res.status(204).send(); });

router.get("/me", requireCustomer, async (req: CustomerRequest, res) => res.json({ account: publicAccount(await getAccount(req.accountId!)) }));
router.put("/me", requireCustomer, async (req: CustomerRequest, res) => res.json({ account: await updateProfile(req.accountId!, req.body) }));
const avatarLimit = limit(15, 30, "Terlalu sering mengganti foto. Coba lagi dalam 15 menit.");
router.post("/me/avatar", requireCustomer, avatarLimit, express.raw({ type: [...photoTypes], limit: maxAvatarSize }), async (req: CustomerRequest, res) => {
  await setCustomerAvatar(req.accountId!, req.get("content-type"), req.body);
  res.json({ account: publicAccount(await getAccount(req.accountId!)) });
});
router.delete("/me/avatar", requireCustomer, avatarLimit, async (req: CustomerRequest, res) => {
  await removeCustomerAvatar(req.accountId!);
  res.json({ account: publicAccount(await getAccount(req.accountId!)) });
});
router.delete("/me", requireCustomer, async (req: CustomerRequest, res) => {
  await deleteAccount(req.accountId!);
  await endCustomerSession(req, res);
  res.status(204).send();
});
router.get("/overview", requireCustomer, async (req: CustomerRequest, res) => res.json(await overview(req.accountId!)));
router.get("/bookings", requireCustomer, async (req: CustomerRequest, res) => res.json(await history(req.accountId!, req.query.scope)));
router.post("/bookings/:id/reschedule", requireCustomer, limit(15, 10, "Terlalu banyak percobaan pindah jadwal. Coba lagi dalam 15 menit."),
  async (req: CustomerRequest, res) => res.json({ booking: await rescheduleOwn(req.accountId!, String(req.params.id), req.body) }));
/** Kotak masuk notifikasi: tagihan, kwitansi, pengingat, dan perubahan jadwal. */
router.get("/notifications", requireCustomer, async (req: CustomerRequest, res) => res.json(await inbox(req.accountId!, req.query)));
router.get("/notifications/unread", requireCustomer, async (req: CustomerRequest, res) => res.json({ unread: await unreadCount(req.accountId!) }));
router.post("/notifications/read", requireCustomer, async (req: CustomerRequest, res) => res.json(await markRead(req.accountId!, req.body)));
router.put("/me/notifications", requireCustomer, async (req: CustomerRequest, res) => {
  await savePreferences(req.accountId!, req.body);
  res.json({ account: publicAccount(await getAccount(req.accountId!)) });
});
router.post("/claim", requireCustomer, limit(15, 10, "Terlalu banyak percobaan klaim. Coba lagi dalam 15 menit."),
  async (req: CustomerRequest, res) => res.json(await claim(req.accountId!, req.body)));

/** Keanggotaan: daftar, perpanjang, bayar ulang tagihan, dan hubungkan kartu member dari kasir. */
router.get("/membership", requireCustomer, async (req: CustomerRequest, res) => res.json(await customerMembership(req.accountId!)));
const memberLimit = limit(15, 15, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
router.post("/membership", requireCustomer, memberLimit, async (req: CustomerRequest, res) => res.status(201).json(await signup(req.accountId!, req.body)));
router.post("/membership/renew", requireCustomer, memberLimit, async (req: CustomerRequest, res) => res.status(201).json(await renewOnline(req.accountId!, req.body)));
router.post("/membership/invoices/:id/pay", requireCustomer, memberLimit, async (req: CustomerRequest, res) => res.json(await payAgain(req.accountId!, String(req.params.id), req.body)));
router.post("/membership/refresh", requireCustomer, async (req: CustomerRequest, res) => res.json(await refreshMine(req.accountId!)));
router.post("/membership/claim", requireCustomer, limit(15, 10, "Terlalu banyak percobaan klaim. Coba lagi dalam 15 menit."),
  async (req: CustomerRequest, res) => res.json(await claimMembership(req.accountId!, req.body)));

export default router;

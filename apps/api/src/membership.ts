import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, isDuplicate, readSetting, saveSetting, transaction } from "./store.js";
import { check, HttpError } from "./errors.js";
import { daysBetween, localClock, shiftDate, shiftMonths } from "./clock.js";
import { publicUrl } from "./config.js";
import { billOf, taxSnapshot } from "./bill.js";
import { closeMembershipBooks, gatewayFee, syncMembershipInvoice, unearnedDues } from "./finance.js";
import { createSnapTransaction, fetchTransactionStatus, outcomeOf, paymentConfig, paymentMethod, type MidtransStatus } from "./midtrans.js";
import { notifyMemberApproved, notifyMemberBill, notifyMemberPaid, type MemberContact } from "./notifications.js";

/**
 * Keanggotaan berbayar.
 *
 * Member membeli paket (iuran untuk beberapa bulan, ditambah biaya daftar sekali). Selama aktif,
 * booking mendapat potongan member: lewat akun Google saat memesan online, atau dipilih kasir.
 * Nomor HP saja tidak pernah cukup, karena checkout tidak memverifikasi nomor yang diketik.
 *
 * Status tersimpan: menunggu bayar → (menunggu persetujuan) → aktif ⇄ dibekukan, atau batal.
 * "Berakhir" tidak disimpan: keanggotaan aktif yang tanggal berakhirnya sudah lewat. Perpanjangan
 * menyambung dari tanggal berakhir, jadi member yang memperpanjang lebih awal tidak rugi hari.
 *
 * Periode baru ditentukan saat tagihan lunas (atau saat admin menyetujui pendaftar online), bukan
 * saat tagihan dibuat, agar pelanggan yang baru membayar besok tidak kehilangan satu hari.
 */

// --- Pengaturan ----------------------------------------------------------------

export interface MembershipSettings { enabled: boolean; approval: boolean; terms: string; reminder_days: number; updated_at: string | null }
const defaults: MembershipSettings = { enabled: true, approval: false, terms: "", reminder_days: 7, updated_at: null };
export const membershipSettings = async (): Promise<MembershipSettings> => ({ ...defaults, ...(await readSetting<Partial<MembershipSettings>>("membership") ?? {}) });
export const membershipSettingsSchema = z.object({
  enabled: z.boolean(),
  approval: z.boolean(),
  terms: z.string().trim().max(3000, "Syarat & ketentuan maksimal 3.000 karakter.").default(""),
  reminder_days: z.number().int().min(0).max(30, "Pengingat paling awal 30 hari sebelum berakhir.").default(7),
});
export async function saveMembershipSettings(input: unknown, actor: string) {
  const data = membershipSettingsSchema.parse(input);
  return await transaction(async () => {
    const next: MembershipSettings = { ...data, updated_at: new Date().toISOString() };
    await saveSetting("membership", next);
    await audit(actor, "membership.settings", "membership");
    return next;
  });
}

// --- Paket ---------------------------------------------------------------------

export interface Plan {
  id: string; name: string; description: string; price: number; registration_fee: number; duration_months: number;
  court_discount: number; addon_discount: number; online: number; active: number; position: number; created_at: string;
}
const percent = (label: string) => z.number(`Isi diskon ${label}.`).min(0, `Diskon ${label} tidak boleh negatif.`).max(100, `Diskon ${label} paling besar 100%.`)
  .transform(value => Math.round(value * 100));
const rupiahField = (label: string, min: number) => z.number(`Isi ${label}.`).int(`${label} harus bilangan bulat.`).min(min, `${label} minimal Rp${min.toLocaleString("id-ID")}.`).max(100_000_000, `${label} terlalu besar.`);
export const planSchema = z.object({
  name: z.string().trim().min(2, "Nama paket minimal 2 karakter.").max(60, "Nama paket maksimal 60 karakter."),
  description: z.string().trim().max(400, "Deskripsi maksimal 400 karakter.").default(""),
  price: rupiahField("Iuran", 1000),
  registration_fee: rupiahField("Biaya daftar", 0).default(0),
  duration_months: z.number("Pilih masa berlaku.").int().min(1, "Masa berlaku minimal 1 bulan.").max(24, "Masa berlaku maksimal 24 bulan."),
  court_discount: percent("sewa lapangan"),
  addon_discount: percent("tambahan").default(0),
  online: z.boolean().default(true),
  active: z.boolean().default(true),
});
export async function plans() {
  return await db.prepare(`SELECT p.*,(SELECT count(*) FROM memberships m WHERE m.plan_id=p.id AND m.status IN ('active','frozen')) members
    FROM membership_plans p ORDER BY p.position,p.created_at`).all() as (Plan & { members: number })[];
}
async function getPlan(id: string) {
  const plan = await db.prepare("SELECT * FROM membership_plans WHERE id=?").get(id) as Plan | undefined;
  check(plan, 404, "Paket member tidak ditemukan.");
  return plan;
}
export async function savePlan(input: unknown, actor: string, id?: string) {
  const data = planSchema.parse(input);
  return await transaction(async () => {
    const before = id ? await getPlan(id) : undefined;
    check(!await db.prepare("SELECT 1 FROM membership_plans WHERE name=? AND id<>?").get(data.name, id ?? ""), 409, "Nama paket sudah dipakai.");
    if (before) {
      await db.prepare("UPDATE membership_plans SET name=?,description=?,price=?,registration_fee=?,duration_months=?,court_discount=?,addon_discount=?,online=?,active=? WHERE id=?")
        .run(data.name, data.description, data.price, data.registration_fee, data.duration_months, data.court_discount, data.addon_discount, Number(data.online), Number(data.active), id!);
    } else {
      id = randomUUID();
      const position = Number((await db.prepare("SELECT COALESCE(MAX(position),0)+1 n FROM membership_plans").get() as { n: number }).n);
      await db.prepare("INSERT INTO membership_plans (id,name,description,price,registration_fee,duration_months,court_discount,addon_discount,online,active,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, data.name, data.description, data.price, data.registration_fee, data.duration_months, data.court_discount, data.addon_discount, Number(data.online), Number(data.active), position, new Date().toISOString());
    }
    // Booking yang sudah dibuat menyimpan salinan tarifnya, jadi mengubah diskon tidak mengubah tagihan lama.
    await audit(actor, before ? "membership.plan.update" : "membership.plan.create", id!, before ? { before: { price: before.price, court_discount: before.court_discount, addon_discount: before.addon_discount }, after: { price: data.price, court_discount: data.court_discount, addon_discount: data.addon_discount } } : undefined);
    return await getPlan(id!);
  });
}
export async function removePlan(id: string, actor: string) {
  await transaction(async () => {
    await getPlan(id);
    check(!await db.prepare("SELECT 1 FROM memberships WHERE plan_id=? UNION SELECT 1 FROM membership_invoices WHERE plan_id=? LIMIT 1").get(id, id), 409,
      "Paket ini sudah pernah dipakai member. Nonaktifkan saja agar riwayatnya tetap utuh.");
    await db.prepare("DELETE FROM membership_plans WHERE id=?").run(id);
    await audit(actor, "membership.plan.delete", id);
  });
}

// --- Data member -----------------------------------------------------------------

export type MemberStatus = "pending_payment" | "pending_approval" | "active" | "frozen" | "cancelled";
export type MemberState = MemberStatus | "expired";
interface Membership {
  id: string; code: string; plan_id: string; account_id: string | null; customer_id: string | null; name: string; phone: string; email: string;
  status: MemberStatus; source: "staff" | "online"; starts_on: string | null; ends_on: string | null; frozen_on: string | null; notes: string;
  cancel_reason: string; cancelled_at: string | null; refund_amount: number; created_by: string | null; created_at: string;
}
interface Invoice {
  id: string; number: string; membership_id: string; kind: "daftar" | "perpanjang"; plan_id: string; plan_name: string; months: number; dues: number;
  registration_fee: number; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string; amount: number; status: "pending" | "paid" | "cancelled";
  method: string | null; fee: number; paid_at: string | null; period_start: string | null; period_end: string | null; order_id: string | null;
  snap_token: string | null; redirect_url: string | null; payment_type: string | null; transaction_id: string | null; expires_at: number | null;
  created_by: string | null; created_at: string; updated_at: string;
}

const today = () => localClock().date;
export const stateOf = (member: Pick<Membership, "status" | "ends_on">, on = today()): MemberState =>
  member.status === "active" && member.ends_on && member.ends_on < on ? "expired" : member.status;
/** 628123456789 → 0812-3456-789. */
const showPhone = (phone: string) => (phone.startsWith("62") ? "0" + phone.slice(2) : phone).replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
export function normalizePhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : "62" + digits;
}
const phoneSchema = z.string().trim().max(20).transform(normalizePhone).refine(value => /^628\d{7,12}$/.test(value), "Masukkan nomor HP Indonesia yang aktif, mis. 0812 3456 7890.");
const contact = (member: Membership): MemberContact => ({ id: member.id, code: member.code, name: member.name, email: member.email, phone: member.phone, account_id: member.account_id });

async function getMember(id: string) {
  const member = await db.prepare("SELECT * FROM memberships WHERE id=?").get(id) as Membership | undefined;
  check(member, 404, "Member tidak ditemukan.");
  return member;
}
const invoicesOf = async (membershipId: string) =>
  await db.prepare("SELECT * FROM membership_invoices WHERE membership_id=? ORDER BY created_at DESC").all(membershipId) as Invoice[];
async function getInvoice(id: string) {
  const invoice = await db.prepare("SELECT * FROM membership_invoices WHERE id=?").get(id) as Invoice | undefined;
  check(invoice, 404, "Tagihan member tidak ditemukan.");
  return invoice;
}

/** Kode pendek untuk kartu member dan disebut di kasir. */
async function newCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = "MBR-" + [...randomBytes(6)].map(byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");
    if (!await db.prepare("SELECT 1 FROM memberships WHERE code=?").get(code)) return code;
  }
  return "MBR-" + Date.now().toString(36).toUpperCase().slice(-8);
}
async function nextInvoiceNumber() {
  const year = today().slice(0, 4);
  const last = await db.prepare("SELECT number FROM membership_invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`IM-${year}-%`) as { number: string } | undefined;
  return `IM-${year}-${String(last ? Number(last.number.slice(-5)) + 1 : 1).padStart(5, "0")}`;
}

/** Satu baris untuk tabel admin dan halaman akun. */
async function view(member: Membership) {
  const plan = await db.prepare("SELECT id,name,court_discount,addon_discount,duration_months,price FROM membership_plans WHERE id=?").get(member.plan_id) as
    Pick<Plan, "id" | "name" | "court_discount" | "addon_discount" | "duration_months" | "price">;
  const account = member.account_id
    ? await db.prepare("SELECT id,name,email FROM customer_accounts WHERE id=?").get(member.account_id) as { id: string; name: string; email: string } | undefined
    : undefined;
  const state = stateOf(member), now = today();
  return {
    id: member.id, code: member.code, name: member.name, phone: showPhone(member.phone), email: member.email,
    status: member.status, state, source: member.source, plan, starts_on: member.starts_on, ends_on: member.ends_on, frozen_on: member.frozen_on,
    days_left: member.ends_on && (state === "active" || state === "frozen") ? daysBetween(now, member.ends_on) + 1 : null,
    account: account ?? null, notes: member.notes, cancel_reason: member.cancel_reason, refund_amount: member.refund_amount, created_at: member.created_at,
  };
}
export type MemberView = Awaited<ReturnType<typeof view>>;
const invoiceView = (invoice: Invoice) => ({
  id: invoice.id, number: invoice.number, kind: invoice.kind, plan_name: invoice.plan_name, months: invoice.months, dues: invoice.dues,
  registration_fee: invoice.registration_fee, tax: invoice.tax, tax_label: invoice.tax_label, tax_rate: invoice.tax_rate, tax_inclusive: invoice.tax_inclusive,
  amount: invoice.amount, status: invoice.status, method: invoice.method, paid_at: invoice.paid_at, period_start: invoice.period_start, period_end: invoice.period_end,
  online: !!invoice.order_id, created_at: invoice.created_at,
  // Tautan bayar hanya selama halaman Midtrans-nya masih berlaku.
  pay_url: invoice.status === "pending" && invoice.redirect_url && (invoice.expires_at ?? 0) > Date.now() / 1000 ? invoice.redirect_url : null,
  expires_at: invoice.expires_at,
});

// --- Tagihan & masa berlaku ---------------------------------------------------------

/** Tagihan baru untuk paket itu. Biaya daftar hanya pada pendaftaran pertama. */
async function createInvoice(member: Membership, plan: Plan, kind: Invoice["kind"], actor: string | null) {
  const registration = kind === "daftar" ? plan.registration_fee : 0;
  const snapshot = await taxSnapshot(), bill = billOf(plan.price + registration, 0, snapshot);
  const id = randomUUID(), stamp = new Date().toISOString();
  await db.prepare(`INSERT INTO membership_invoices (id,number,membership_id,kind,plan_id,plan_name,months,dues,registration_fee,tax,tax_rate,tax_inclusive,tax_label,amount,status,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`)
    .run(id, await nextInvoiceNumber(), member.id, kind, plan.id, plan.name, plan.duration_months, plan.price, registration, bill.tax, snapshot.tax_rate, snapshot.tax_inclusive, snapshot.tax_label, bill.total, actor, stamp, stamp);
  return await getInvoice(id);
}
/** Tagihan yang belum dibayar ditutup, mis. karena pelanggan memilih paket lain. */
async function dropPending(membershipId: string) {
  await db.prepare("UPDATE membership_invoices SET status='cancelled',updated_at=? WHERE membership_id=? AND status='pending'").run(new Date().toISOString(), membershipId);
}

/** Tetapkan periode tagihan lunas dan perpanjang keanggotaan. Dipanggil di dalam transaksi. */
async function startPeriod(member: Membership, invoice: Invoice, on = today()) {
  // Perpanjangan sebelum berakhir menyambung dari tanggal berakhir; yang sudah lewat mulai hari ini.
  const continuous = invoice.kind === "perpanjang" && !!member.ends_on && member.ends_on >= on;
  const start = continuous ? shiftDate(member.ends_on!, 1) : on;
  const end = shiftDate(shiftMonths(start, invoice.months), -1);
  await db.prepare("UPDATE membership_invoices SET period_start=?,period_end=?,updated_at=? WHERE id=?").run(start, end, new Date().toISOString(), invoice.id);
  await db.prepare("UPDATE memberships SET plan_id=?,starts_on=?,ends_on=?,status=? WHERE id=?")
    .run(invoice.plan_id, continuous ? member.starts_on : start, end, member.status === "frozen" ? "frozen" : "active", member.id);
  await syncMembershipInvoice(invoice.id);
  return { start, end };
}

/**
 * Catat pelunasan tagihan, lalu aktifkan atau perpanjang keanggotaannya. Pendaftar online menunggu
 * persetujuan bila venue mengaturnya; kasir yang mendaftarkan langsung dianggap sudah menyetujui.
 */
async function settle(invoice: Invoice, payment: { method: string; fee: number; actor: string; online: boolean; payment_type?: string | null; transaction_id?: string | null }) {
  const stamp = new Date().toISOString();
  const changed = await db.prepare("UPDATE membership_invoices SET status='paid',method=?,fee=?,paid_at=?,payment_type=COALESCE(?,payment_type),transaction_id=COALESCE(?,transaction_id),updated_at=? WHERE id=? AND status<>'paid'")
    .run(payment.method, payment.fee, stamp, payment.payment_type ?? null, payment.transaction_id ?? null, stamp, invoice.id);
  if (!changed.changes) return null;
  const member = await getMember(invoice.membership_id);
  const paid = await getInvoice(invoice.id);
  let period: { start: string; end: string } | null = null, waiting = false;
  if (member.status === "cancelled") {
    // Uang masuk untuk keanggotaan yang sudah dibatalkan: tercatat sebagai iuran diterima di muka agar bisa dikembalikan.
    await syncMembershipInvoice(paid.id);
  } else if (payment.online && invoice.kind === "daftar" && !member.starts_on && (await membershipSettings()).approval) {
    await db.prepare("UPDATE memberships SET status='pending_approval',plan_id=? WHERE id=?").run(paid.plan_id, member.id);
    await syncMembershipInvoice(paid.id);
    waiting = true;
  } else period = await startPeriod(member, paid);
  await audit(payment.actor, "membership.paid", member.id, { invoice: paid.number, amount: paid.amount, method: payment.method });
  await notifyMemberPaid({
    member: contact(member), invoice_id: paid.id, number: paid.number, plan: paid.plan_name, amount: paid.amount,
    renewal: paid.kind === "perpanjang", waiting, starts_on: period?.start ?? null, ends_on: period?.end ?? null, online: payment.online,
  });
  return paid;
}

// --- Panel admin -----------------------------------------------------------------

const methodSchema = z.enum(["cash", "transfer", "qris"], "Pilih metode pembayaran.");
export const memberSchema = z.object({
  plan_id: z.string("Pilih paket.").min(1, "Pilih paket.").max(64),
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80, "Nama maksimal 80 karakter."),
  phone: phoneSchema,
  email: z.union([z.email("Email tidak valid."), z.literal("")]).default(""),
  account_id: z.string().min(1).max(64).nullable().default(null),
  notes: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
  /** Kosong berarti tagihan pendaftaran dibuat tetapi belum dibayar. */
  method: methodSchema.nullable().default(null),
});
const duplicateMessage = (error: unknown) => {
  const message = String((error as Error).message);
  if (message.includes("memberships_open_phone")) return "Nomor HP ini sudah terdaftar sebagai member. Cari member itu di daftar.";
  if (message.includes("memberships_open_account")) return "Akun Google ini sudah terhubung ke member lain.";
  return null;
};
async function guarded<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) {
    const message = isDuplicate(error) ? duplicateMessage(error) : null;
    if (message) throw new HttpError(409, message);
    throw error;
  }
}

/** Kasir mendaftarkan member baru, langsung lunas atau dengan tagihan menyusul. */
export async function registerMember(input: unknown, actor: string) {
  const data = memberSchema.parse(input);
  return await guarded(() => transaction(async () => {
    const plan = await getPlan(data.plan_id);
    check(plan.active, 409, "Paket ini sedang tidak dijual.");
    if (data.account_id) check(await db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(data.account_id), 404, "Akun pelanggan tidak ditemukan.");
    const customer = await db.prepare("SELECT id FROM customers WHERE phone=?").get(data.phone) as { id: string } | undefined;
    const id = randomUUID();
    await db.prepare("INSERT INTO memberships (id,code,plan_id,account_id,customer_id,name,phone,email,status,source,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'pending_payment','staff',?,?,?)")
      .run(id, await newCode(), plan.id, data.account_id, customer?.id ?? null, data.name, data.phone, data.email.toLowerCase(), data.notes, actor, new Date().toISOString());
    const invoice = await createInvoice(await getMember(id), plan, "daftar", actor);
    await audit(actor, "membership.create", id, { plan: plan.name, amount: invoice.amount });
    if (data.method) await settle(invoice, { method: data.method, fee: 0, actor, online: false });
    return await memberDetail(id);
  }));
}

export const memberUpdateSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80, "Nama maksimal 80 karakter."),
  phone: phoneSchema,
  email: z.union([z.email("Email tidak valid."), z.literal("")]).default(""),
  account_id: z.string().min(1).max(64).nullable().default(null),
  notes: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
  /** Koreksi tanggal berakhir, mis. kompensasi lapangan tutup. Hanya untuk member aktif atau dibekukan. */
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.").nullable().optional(),
});
export async function updateMember(id: string, input: unknown, actor: string) {
  const data = memberUpdateSchema.parse(input);
  return await guarded(() => transaction(async () => {
    const member = await getMember(id);
    check(member.status !== "cancelled", 409, "Keanggotaan yang sudah dibatalkan tidak dapat diubah.");
    if (data.account_id && data.account_id !== member.account_id) check(await db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(data.account_id), 404, "Akun pelanggan tidak ditemukan.");
    let ends = member.ends_on;
    if (data.ends_on && data.ends_on !== member.ends_on) {
      check(member.status === "active" || member.status === "frozen", 409, "Tanggal berakhir hanya dapat diubah untuk member aktif.");
      check(data.ends_on >= member.starts_on!, 400, "Tanggal berakhir tidak boleh sebelum tanggal mulai.");
      ends = data.ends_on;
    }
    await db.prepare("UPDATE memberships SET name=?,phone=?,email=?,account_id=?,notes=?,ends_on=? WHERE id=?")
      .run(data.name, data.phone, data.email.toLowerCase(), data.account_id, data.notes, ends, id);
    await audit(actor, "membership.update", id, {
      before: { name: member.name, phone: member.phone, account_id: member.account_id, ends_on: member.ends_on },
      after: { name: data.name, phone: data.phone, account_id: data.account_id, ends_on: ends },
    });
    return await memberDetail(id);
  }));
}

/** Perpanjang di kasir: tagihan baru, langsung lunas bila metode bayarnya diisi. */
export async function renewMember(id: string, input: unknown, actor: string) {
  const data = z.object({ plan_id: z.string().min(1).max(64).optional(), method: methodSchema.nullable().default(null) }).parse(input);
  return await transaction(async () => {
    const member = await getMember(id);
    check(member.status === "active" || member.status === "frozen", 409, member.status === "cancelled" ? "Keanggotaan ini sudah dibatalkan. Daftarkan sebagai member baru." : "Selesaikan pendaftarannya dulu sebelum diperpanjang.");
    const plan = await getPlan(data.plan_id ?? member.plan_id);
    check(plan.active, 409, "Paket ini sedang tidak dijual.");
    await dropPending(id);
    const invoice = await createInvoice(member, plan, "perpanjang", actor);
    await audit(actor, "membership.renew", id, { plan: plan.name, amount: invoice.amount });
    if (data.method) await settle(invoice, { method: data.method, fee: 0, actor, online: false });
    return await memberDetail(id);
  });
}

/** Kasir menerima pembayaran untuk tagihan yang belum lunas (tunai, transfer, atau QRIS kasir). */
export async function payInvoice(id: string, invoiceId: string, input: unknown, actor: string) {
  const { method } = z.object({ method: methodSchema }).parse(input);
  return await transaction(async () => {
    const invoice = await getInvoice(invoiceId);
    check(invoice.membership_id === id, 404, "Tagihan member tidak ditemukan.");
    check(invoice.status === "pending", 409, invoice.status === "paid" ? "Tagihan ini sudah lunas." : "Tagihan ini sudah dibatalkan.");
    check((await getMember(id)).status !== "cancelled", 409, "Keanggotaan ini sudah dibatalkan.");
    await settle(invoice, { method, fee: 0, actor, online: false });
    return await memberDetail(id);
  });
}

export async function approveMember(id: string, actor: string) {
  return await transaction(async () => {
    const member = await getMember(id);
    check(member.status === "pending_approval", 409, "Member ini tidak sedang menunggu persetujuan.");
    const invoice = await db.prepare("SELECT * FROM membership_invoices WHERE membership_id=? AND status='paid' AND period_start IS NULL ORDER BY paid_at LIMIT 1").get(id) as Invoice | undefined;
    check(invoice, 409, "Iuran pendaftar ini belum dibayar.");
    const period = await startPeriod({ ...member, status: "active" }, invoice);
    await audit(actor, "membership.approve", id);
    await notifyMemberApproved({ member: contact(member), plan: invoice.plan_name, starts_on: period.start, ends_on: period.end });
    return await memberDetail(id);
  });
}

/** Bekukan, mis. member cedera. Hari yang dibekukan ditambahkan ke tanggal berakhir saat diaktifkan lagi. */
export async function freezeMember(id: string, input: unknown, actor: string) {
  const { frozen } = z.object({ frozen: z.boolean() }).parse(input);
  return await transaction(async () => {
    const member = await getMember(id), now = today();
    if (frozen) {
      check(stateOf(member, now) === "active", 409, "Hanya member aktif yang dapat dibekukan.");
      await db.prepare("UPDATE memberships SET status='frozen',frozen_on=? WHERE id=?").run(now, id);
      await audit(actor, "membership.freeze", id);
    } else {
      check(member.status === "frozen", 409, "Member ini tidak sedang dibekukan.");
      const days = Math.max(0, daysBetween(member.frozen_on ?? now, now));
      const ends = shiftDate(member.ends_on!, days);
      await db.prepare("UPDATE memberships SET status='active',frozen_on=NULL,ends_on=? WHERE id=?").run(ends, id);
      await audit(actor, "membership.unfreeze", id, { days, before: member.ends_on, after: ends });
    }
    return await memberDetail(id);
  });
}

/**
 * Batalkan keanggotaan. Iuran bulan-bulan yang belum berjalan boleh dikembalikan sebagian atau
 * seluruhnya; yang tidak dikembalikan diakui sebagai pendapatan. Biaya daftar tidak dikembalikan.
 */
export async function cancelMember(id: string, input: unknown, actor: string) {
  const data = z.object({
    reason: z.string().trim().min(3, "Isi alasan pembatalan.").max(200, "Alasan maksimal 200 karakter."),
    refund: z.number().int().min(0).max(100_000_000).default(0),
    method: methodSchema.default("cash"),
  }).parse(input);
  return await transaction(async () => {
    const member = await getMember(id), now = today();
    check(member.status !== "cancelled", 409, "Keanggotaan ini sudah dibatalkan.");
    await dropPending(id);
    await db.prepare("UPDATE memberships SET status='cancelled',cancel_reason=?,cancelled_at=?,refund_amount=? WHERE id=?").run(data.reason, new Date().toISOString(), data.refund, id);
    const { unearned } = await closeMembershipBooks(id, now, data.refund, data.method, actor, member.name);
    await audit(actor, "membership.cancel", id, { reason: data.reason, refund: data.refund, unearned });
    return await memberDetail(id);
  });
}

export const memberListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  state: z.enum(["pending_payment", "pending_approval", "active", "expired", "frozen", "cancelled", "expiring"]).optional(),
});
export async function listMembers(input: unknown) {
  const query = memberListSchema.parse(input ?? {});
  const where: string[] = [], params: string[] = [];
  if (query.q) {
    const term = `%${query.q.toLowerCase().replace(/[\\%_]/g, char => "\\" + char)}%`;
    const digits = query.q.replace(/\D/g, "");
    where.push("(lower(m.name) LIKE ? OR lower(m.code) LIKE ? OR lower(m.email) LIKE ?" + (digits.length >= 4 ? " OR m.phone LIKE ?" : "") + ")");
    params.push(term, term, term, ...(digits.length >= 4 ? [`%${digits.replace(/^0/, "")}%`] : []));
  }
  const rows = await db.prepare(`SELECT m.* FROM memberships m${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY m.created_at DESC LIMIT 500`).all(...params) as Membership[];
  const settings = await membershipSettings(), now = today(), soon = shiftDate(now, Math.max(settings.reminder_days, 7));
  const members = [];
  for (const row of rows) {
    const state = stateOf(row, now);
    if (query.state === "expiring" ? !(state === "active" && row.ends_on! <= soon) : query.state && state !== query.state) continue;
    members.push(await view(row));
  }
  return { members, stats: await memberStats() };
}

/** Angka ringkas untuk kepala panel Member: jumlah member dan uang dari program member bulan ini. */
export async function memberStats() {
  const now = today(), month = now.slice(0, 7), from = `${month}-01`, to = shiftDate(shiftMonths(from, 1), -1);
  const settings = await membershipSettings(), soon = shiftDate(now, Math.max(settings.reminder_days, 7));
  const count = async (sql: string, ...params: string[]) => Number((await db.prepare(sql).get(...params) as { n: number }).n);
  return {
    month,
    active: await count("SELECT count(*) n FROM memberships WHERE status='active' AND ends_on>=?", now),
    frozen: await count("SELECT count(*) n FROM memberships WHERE status='frozen'"),
    expiring: await count("SELECT count(*) n FROM memberships WHERE status='active' AND ends_on BETWEEN ? AND ?", now, soon),
    waiting: await count("SELECT count(*) n FROM memberships WHERE status IN ('pending_payment','pending_approval')"),
    joined: await count("SELECT count(*) n FROM membership_invoices WHERE kind='daftar' AND status='paid' AND period_start BETWEEN ? AND ?", from, to),
    /** Pendapatan keanggotaan yang diakui bulan ini: biaya daftar plus iuran bulan berjalan. */
    revenue: await count(`SELECT COALESCE(SUM(l.credit-l.debit),0) n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE a.system_key='pendapatan_keanggotaan' AND e.date BETWEEN ? AND ?`, from, to),
    /** Uang yang benar-benar masuk dari iuran bulan ini, termasuk iuran untuk bulan-bulan depan. */
    collected: await count("SELECT COALESCE(SUM(amount),0) n FROM membership_invoices WHERE status='paid' AND paid_at>=? AND paid_at<?", `${from}T00:00:00`, `${shiftDate(to, 1)}T00:00:00`),
    /** Nilai potongan member pada booking yang main bulan ini. */
    discount: await count("SELECT COALESCE(SUM(member_discount),0) n FROM bookings WHERE status IN ('confirmed','completed') AND date BETWEEN ? AND ?", from, to),
  };
}

export async function memberDetail(id: string) {
  const member = await getMember(id);
  const bookings = await db.prepare(`SELECT b.id,b.date,b.start_time,b.end_time,b.status,b.total,b.member_discount,b.member_plan,c.name court_name FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.membership_id=? ORDER BY b.date DESC,b.start_time DESC LIMIT 20`).all(id) as { id: string; member_discount: number; status: string }[];
  const totals = await db.prepare(`SELECT count(*) bookings,COALESCE(SUM(member_discount),0) saved FROM bookings WHERE membership_id=? AND status IN ('confirmed','completed')`).get(id) as { bookings: number; saved: number };
  const suggestions = member.account_id ? [] : await db.prepare("SELECT id,name,email FROM customer_accounts WHERE phone=? ORDER BY last_login_at DESC LIMIT 3").all(member.phone);
  return {
    member: await view(member),
    invoices: (await invoicesOf(id)).map(invoiceView),
    bookings: bookings.map(row => ({ ...row, code: row.id.slice(0, 8).toUpperCase() })),
    totals: { bookings: Number(totals.bookings), saved: Number(totals.saved) },
    unearned: await unearnedDues(id, today()),
    account_suggestions: suggestions,
  };
}

/** Pencarian member untuk dialog booking kasir. Member yang tidak aktif tetap tampil dengan statusnya. */
export async function lookupMembers(input: unknown) {
  const { q, date } = z.object({ q: z.string().trim().min(2).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(input);
  const term = `%${q.toLowerCase().replace(/[\\%_]/g, char => "\\" + char)}%`, digits = q.replace(/\D/g, "").replace(/^0/, "");
  const rows = await db.prepare(`SELECT m.* FROM memberships m WHERE m.status<>'cancelled' AND (lower(m.name) LIKE ? OR lower(m.code) LIKE ? OR (?<>'' AND m.phone LIKE ?))
    ORDER BY m.name LIMIT 8`).all(term, term, digits.length >= 4 ? digits : "", `%${digits}%`) as Membership[];
  const on = date ?? today();
  const items = [];
  for (const row of rows) {
    const item = await view(row);
    items.push({ ...item, valid: row.status === "active" && !!row.starts_on && row.starts_on <= on && on <= row.ends_on! });
  }
  return items;
}

// --- Akun pelanggan --------------------------------------------------------------------

const publicPlan = (plan: Plan) => ({
  id: plan.id, name: plan.name, description: plan.description, price: plan.price, registration_fee: plan.registration_fee,
  duration_months: plan.duration_months, court_discount: plan.court_discount, addon_discount: plan.addon_discount,
});
/** Paket yang dijual lewat situs, untuk halaman publik dan akun. */
export async function publicPlans() {
  return (await db.prepare("SELECT * FROM membership_plans WHERE active=1 AND online=1 ORDER BY position,created_at").all() as Plan[]).map(publicPlan);
}
const mine = async (accountId: string) =>
  await db.prepare("SELECT * FROM memberships WHERE account_id=? AND status<>'cancelled'").get(accountId) as Membership | undefined;

export async function customerMembership(accountId: string) {
  const settings = await membershipSettings();
  const config = await paymentConfig();
  const member = await mine(accountId);
  const invoices = member ? (await invoicesOf(member.id)).slice(0, 10).map(invoiceView) : [];
  return {
    settings: { open: settings.enabled, approval: settings.approval, terms: settings.terms, online_payment: config.enabled && !!config.serverKey },
    plans: await publicPlans(),
    membership: member ? await view(member) : null,
    invoices,
    totals: member ? await db.prepare("SELECT count(*) bookings,COALESCE(SUM(member_discount),0) saved FROM bookings WHERE membership_id=? AND status IN ('confirmed','completed')").get(member.id) : null,
  };
}

/** Halaman bayar Midtrans untuk satu tagihan member. Nomor ordernya baru setiap kali dibuka ulang. */
async function openSnap(invoice: Invoice, member: Membership) {
  const minutes = 60, orderId = `${invoice.number}-${Date.now().toString(36).toUpperCase()}`;
  const items = [
    { id: "iuran", price: invoice.dues, quantity: 1, name: `Iuran ${invoice.plan_name} ${invoice.months} bln`.slice(0, 50) },
    ...(invoice.registration_fee ? [{ id: "daftar", price: invoice.registration_fee, quantity: 1, name: "Biaya pendaftaran member" }] : []),
    ...(invoice.tax && !invoice.tax_inclusive ? [{ id: "pajak", price: invoice.tax, quantity: 1, name: `${invoice.tax_label || "Pajak"} ${invoice.tax_rate / 100}%`.slice(0, 50) }] : []),
  ];
  const sum = items.reduce((total, item) => total + item.price, 0);
  if (sum !== invoice.amount) items.push({ id: "penyesuaian", price: invoice.amount - sum, quantity: 1, name: "Penyesuaian pembulatan" });
  const snap = await createSnapTransaction({
    transaction_details: { order_id: orderId, gross_amount: invoice.amount },
    item_details: items,
    customer_details: { first_name: member.name.slice(0, 20), phone: member.phone.slice(0, 19), ...(member.email ? { email: member.email.slice(0, 45) } : {}) },
    expiry: { unit: "minute", duration: minutes },
    callbacks: { finish: `${publicUrl}/akun/member` },
  });
  const expires = Math.floor(Date.now() / 1000) + minutes * 60;
  await db.prepare("UPDATE membership_invoices SET order_id=?,snap_token=?,redirect_url=?,expires_at=?,updated_at=? WHERE id=?")
    .run(orderId, snap.token, snap.redirect_url, expires, new Date().toISOString(), invoice.id);
  await notifyMemberBill({ member: contact(member), invoice_id: invoice.id, number: invoice.number, plan: invoice.plan_name, months: invoice.months, amount: invoice.amount, expires_at: expires, pay_url: snap.redirect_url })
    .catch(error => console.error("Gagal menyiapkan tagihan member", invoice.number, (error as Error).message));
  return { invoice_id: invoice.id, redirect_url: snap.redirect_url, token: snap.token, amount: invoice.amount };
}
async function requireOnlinePayment() {
  const config = await paymentConfig();
  check(config.enabled && config.serverKey, 409, "Pembayaran online belum aktif. Daftar atau perpanjang member langsung di kasir venue.");
}

export const signupSchema = z.object({
  plan_id: z.string("Pilih paket.").min(1, "Pilih paket.").max(64),
  name: z.string().trim().min(2, "Isi nama lengkap.").max(80, "Nama maksimal 80 karakter."),
  phone: phoneSchema,
  agree: z.literal(true, "Setujui syarat & ketentuan member terlebih dahulu."),
});
/** Pelanggan mendaftar dari akunnya dan membayar lewat Midtrans. */
export async function signup(accountId: string, input: unknown) {
  const data = signupSchema.parse(input);
  const settings = await membershipSettings();
  check(settings.enabled, 409, "Pendaftaran member online sedang ditutup. Silakan daftar di kasir venue.");
  await requireOnlinePayment();
  const { invoice, member } = await guarded(() => transaction(async () => {
    const plan = await getPlan(data.plan_id);
    check(plan.active && plan.online, 409, "Paket ini tidak dijual lewat situs.");
    const account = await db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId) as { email: string } | undefined;
    check(account, 401, "Sesi akun berakhir. Silakan masuk kembali.");
    let current = await mine(accountId);
    if (current) {
      check(current.status === "pending_payment", 409, "Akun Anda sudah terdaftar sebagai member.");
      // Belum pernah membayar: boleh ganti paket atau data, tagihan lama ditutup.
      await dropPending(current.id);
      await db.prepare("UPDATE memberships SET plan_id=?,name=?,phone=? WHERE id=?").run(plan.id, data.name, data.phone, current.id);
    } else {
      const id = randomUUID();
      const customer = await db.prepare("SELECT id FROM customers WHERE phone=?").get(data.phone) as { id: string } | undefined;
      await db.prepare("INSERT INTO memberships (id,code,plan_id,account_id,customer_id,name,phone,email,status,source,created_at) VALUES (?,?,?,?,?,?,?,?,'pending_payment','online',?)")
        .run(id, await newCode(), plan.id, accountId, customer?.id ?? null, data.name, data.phone, account.email.toLowerCase(), new Date().toISOString());
      await audit(accountId, "membership.signup", id, { plan: plan.name });
    }
    current = (await mine(accountId))!;
    return { invoice: await createInvoice(current, plan, "daftar", null), member: current };
  }));
  return await openSnapSafely(invoice, member);
}
/** Member memperpanjang dari akunnya. Paket boleh diganti; potongannya berubah saat periode baru lunas. */
export async function renewOnline(accountId: string, input: unknown) {
  const { plan_id } = z.object({ plan_id: z.string().min(1).max(64).optional() }).parse(input ?? {});
  await requireOnlinePayment();
  const { invoice, member } = await transaction(async () => {
    const member = await mine(accountId);
    check(member && (member.status === "active" || member.status === "frozen"), 409, "Akun Anda belum menjadi member aktif.");
    const plan = await getPlan(plan_id ?? member.plan_id);
    check(plan.active && plan.online, 409, "Paket ini tidak dijual lewat situs. Perpanjang di kasir venue.");
    await dropPending(member.id);
    return { invoice: await createInvoice(member, plan, "perpanjang", null), member };
  });
  return await openSnapSafely(invoice, member);
}
async function openSnapSafely(invoice: Invoice, member: Membership) {
  try { return await openSnap(invoice, member); } catch (error) {
    console.error("Snap gagal untuk tagihan member", invoice.number, (error as Error).message);
    if (error instanceof HttpError && error.status < 500) throw error;
    check(false, 502, "Pembayaran lewat Midtrans belum dapat dimulai. Coba lagi sebentar lagi atau hubungi venue.");
  }
}
/** Buka lagi halaman bayar untuk tagihan yang tautannya sudah kedaluwarsa. */
export async function payAgain(accountId: string, invoiceId: string) {
  await requireOnlinePayment();
  const member = await mine(accountId);
  const invoice = await getInvoice(invoiceId);
  check(member && invoice.membership_id === member.id, 404, "Tagihan member tidak ditemukan.");
  check(invoice.status === "pending", 409, invoice.status === "paid" ? "Tagihan ini sudah lunas." : "Tagihan ini sudah ditutup. Buat tagihan baru.");
  if (invoice.order_id) await refreshInvoice(invoice);
  const fresh = await getInvoice(invoiceId);
  check(fresh.status === "pending", 409, "Tagihan ini sudah lunas.");
  if (fresh.redirect_url && (fresh.expires_at ?? 0) > Date.now() / 1000 + 60) return { invoice_id: fresh.id, redirect_url: fresh.redirect_url, token: fresh.snap_token, amount: fresh.amount };
  return await openSnapSafely(fresh, member);
}

/** Hubungkan keanggotaan yang didaftarkan kasir ke akun ini, dengan kode member dan nomor HP-nya. */
export async function claimMembership(accountId: string, input: unknown) {
  const data = z.object({ code: z.string().trim().toUpperCase().max(20), phone: phoneSchema }).parse(input);
  return await guarded(() => transaction(async () => {
    const code = data.code.startsWith("MBR-") ? data.code : `MBR-${data.code}`;
    const member = await db.prepare("SELECT * FROM memberships WHERE code=? AND status<>'cancelled'").get(code) as Membership | undefined;
    // Pesannya sama untuk kode salah dan nomor salah agar tidak bisa dipakai menebak.
    check(member && member.phone === data.phone, 404, "Kode member atau nomor HP tidak cocok. Lihat kode di kartu atau tanyakan ke kasir.");
    check(!member.account_id || member.account_id === accountId, 409, "Keanggotaan ini sudah terhubung ke akun lain. Hubungi venue bila itu milik Anda.");
    check(!await mine(accountId) || member.account_id === accountId, 409, "Akun Anda sudah punya keanggotaan lain.");
    await db.prepare("UPDATE memberships SET account_id=? WHERE id=?").run(accountId, member.id);
    await audit(accountId, "membership.claim", member.id);
    return await customerMembership(accountId);
  }));
}

// --- Midtrans ------------------------------------------------------------------------

export const invoiceByOrder = async (orderId: string) =>
  await db.prepare("SELECT * FROM membership_invoices WHERE order_id=?").get(orderId) as Invoice | undefined;

/** Terapkan status Midtrans pada tagihan member. Idempoten: webhook yang datang berulang tidak menggandakan apa pun. */
export async function applyInvoiceStatus(invoice: Invoice, status: MidtransStatus) {
  const outcome = outcomeOf(status);
  return await transaction(async () => {
    await db.prepare("UPDATE membership_invoices SET payment_type=COALESCE(?,payment_type),transaction_id=COALESCE(?,transaction_id),updated_at=? WHERE id=?")
      .run(status.payment_type ?? null, status.transaction_id ?? null, new Date().toISOString(), invoice.id);
    if (outcome === "paid" && invoice.status !== "paid") {
      const method = paymentMethod(status.payment_type);
      await settle(invoice, { method, fee: await gatewayFee(method, invoice.amount), actor: "midtrans", online: true, payment_type: status.payment_type, transaction_id: status.transaction_id });
    } else if (outcome !== "paid" && outcome !== "pending" && invoice.status === "pending") {
      // Halaman bayar ditutup atau kedaluwarsa: tagihan tetap terbuka agar pelanggan bisa membayar lagi.
      await db.prepare("UPDATE membership_invoices SET expires_at=LEAST(COALESCE(expires_at,0),UNIX_TIMESTAMP()) WHERE id=?").run(invoice.id);
    }
    return { handled: true, outcome };
  });
}
async function refreshInvoice(invoice: Invoice) {
  if (!invoice.order_id || invoice.status !== "pending") return;
  const status = await fetchTransactionStatus(invoice.order_id).catch(() => null);
  if (status) await applyInvoiceStatus(invoice, status);
}
/** Halaman akun memeriksa langsung ke Midtrans, untuk pelanggan yang kembali sebelum webhook tiba. */
export async function refreshMine(accountId: string) {
  const member = await mine(accountId);
  if (member) for (const invoice of await invoicesOf(member.id)) if (invoice.status === "pending" && invoice.order_id) await refreshInvoice(invoice);
  return await customerMembership(accountId);
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { clientUrl } from "./config.js";
import { check } from "./errors.js";
import { revokeSessions } from "./auth.js";
import { emailConfig, emailReady, notifyPasswordReset } from "./notifications.js";
import { audit, db, getUsers, saveUsers, transaction } from "./store.js";
import { passwordSchema } from "./routes/auth.js";

/**
 * Lupa password staf. Tautan berisi token acak yang hanya disimpan sebagai hash, berlaku 30 menit,
 * dan sekali pakai. Jawaban permintaan selalu sama agar email terdaftar tidak bisa ditebak dari luar.
 */
const validMinutes = 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const genericReply = "Bila email itu terdaftar sebagai akun staf, tautan untuk membuat password baru sudah dikirim. Periksa juga folder spam.";

/** Login menampilkan tautan lupa password; ini memberi tahu apakah email reset bisa terkirim. */
export async function recoveryOptions() { return { email: emailReady(await emailConfig()) }; }

export async function requestReset(input: unknown) {
  const { email } = z.object({ email: z.email("Masukkan email yang valid.").toLowerCase() }).parse(input);
  const user = (await getUsers()).find(item => item.email.toLowerCase() === email);
  if (!user || !emailReady(await emailConfig())) return { message: genericReply };
  const token = randomBytes(32).toString("hex"), id = randomUUID();
  await transaction(async () => {
    // Tautan sebelumnya otomatis tidak berlaku: hanya tautan terbaru yang bisa dipakai.
    await db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires_at<?").run(user.id, Date.now());
    await db.prepare("INSERT INTO password_resets (id,token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(id, hash(token), user.id, Date.now() + validMinutes * 60000, new Date().toISOString());
    await audit(user.id, "password.reset_request", user.id);
  });
  await notifyPasswordReset({ reset_id: id, name: user.name, email: user.email, minutes: validMinutes, url: `${clientUrl.replace(/\/+$/, "")}/reset-password?token=${token}` });
  return { message: genericReply };
}

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "Tautan reset tidak valid.");
async function findReset(token: string) {
  const row = await db.prepare("SELECT id,user_id,expires_at FROM password_resets WHERE token_hash=? AND used_at IS NULL").get(hash(token)) as { id: string; user_id: string; expires_at: number } | undefined;
  check(row && Number(row.expires_at) > Date.now(), 410, "Tautan reset sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.");
  const user = (await getUsers()).find(item => item.id === row.user_id);
  check(user, 410, "Akun untuk tautan ini sudah tidak ada.");
  return { row, user };
}

/** Halaman reset memeriksa tautan lebih dulu agar staf tidak mengisi password untuk tautan yang mati. */
export async function checkReset(input: unknown) {
  const { token } = z.object({ token: tokenSchema }).parse(input);
  const { user } = await findReset(token);
  return { email: user.email.replace(/^(.).*?(.)?@/, (_m, first: string, last = "") => `${first}${"•".repeat(4)}${last}@`), two_factor: !!user.twoFactor };
}

export async function completeReset(input: unknown) {
  const data = z.object({ token: tokenSchema, password: passwordSchema }).parse(input);
  const passwordHash = await bcrypt.hash(data.password, 12);
  await transaction(async () => {
    const { row, user } = await findReset(data.token);
    const used = await db.prepare("UPDATE password_resets SET used_at=? WHERE id=? AND used_at IS NULL").run(new Date().toISOString(), row.id);
    check(used.changes, 410, "Tautan reset sudah dipakai. Minta tautan baru.");
    const users = await getUsers(), index = users.findIndex(item => item.id === user.id);
    users[index] = { ...users[index], passwordHash };
    await saveUsers(users);
    await revokeSessions(user.id);
    await audit(user.id, "password.reset", user.id);
  });
  return { message: "Password baru tersimpan. Silakan masuk." };
}

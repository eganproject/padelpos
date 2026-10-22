import bcrypt from "bcryptjs";
import { z } from "zod";
import { check } from "./errors.js";
import { getInfo } from "./content.js";
import { revokeSessions } from "./auth.js";
import { seal, unseal } from "./secrets.js";
import { audit, getUsers, saveUsers, transaction } from "./store.js";
import { hashRecovery, newRecoveryCodes, newSecret, otpauthUrl, verifyTotp } from "./totp.js";
import type { User } from "./types.js";

/**
 * Verifikasi 2 langkah untuk staf. Setelah password benar, staf memasukkan kode 6 angka dari aplikasi
 * authenticator, atau salah satu kode cadangan sekali pakai bila ponselnya hilang.
 */
const codeSchema = z.string().trim().min(6, "Masukkan kode 6 angka dari aplikasi.").max(20);

async function updateUser(id: string, change: (user: User) => User) {
  return await transaction(async () => {
    const users = await getUsers(), index = users.findIndex(user => user.id === id);
    check(index >= 0, 404, "Pengguna tidak ditemukan.");
    users[index] = change(users[index]);
    await saveUsers(users);
    return users[index];
  });
}
async function confirmPassword(user: User, password: unknown) {
  check(typeof password === "string" && password && await bcrypt.compare(password, user.passwordHash), 400, "Password saat ini tidak sesuai.");
}
const findUser = async (id: string) => { const user = (await getUsers()).find(item => item.id === id); check(user, 404, "Pengguna tidak ditemukan."); return user; };

export function twoFactorStatus(user: User) {
  return { enabled: !!user.twoFactor, enabled_at: user.twoFactor?.enabledAt ?? null, recovery_left: user.twoFactor?.recovery.length ?? 0 };
}

/**
 * Cocokkan kode login. Kode TOTP yang sama tidak bisa dipakai dua kali, dan kode cadangan langsung
 * dihapus setelah dipakai. Mengembalikan "totp" / "recovery", atau null bila salah.
 */
export async function useSecondFactor(userId: string, code: string) {
  return await transaction(async () => {
    const users = await getUsers(), index = users.findIndex(user => user.id === userId);
    const factor = index >= 0 ? users[index].twoFactor : undefined;
    if (!factor) return null;
    const stepUsed = verifyTotp(unseal(factor.secret), code, factor.lastStep ?? 0);
    if (stepUsed !== null) {
      users[index] = { ...users[index], twoFactor: { ...factor, lastStep: stepUsed } };
      await saveUsers(users);
      return "totp" as const;
    }
    const hashed = hashRecovery(code);
    if (/^[A-Za-z0-9-\s]{8,12}$/.test(code) && factor.recovery.includes(hashed)) {
      users[index] = { ...users[index], twoFactor: { ...factor, recovery: factor.recovery.filter(item => item !== hashed) } };
      await saveUsers(users);
      await audit(userId, "2fa.recovery_used", userId, { left: users[index].twoFactor!.recovery.length });
      return "recovery" as const;
    }
    return null;
  });
}

/** Langkah 1: buat rahasia baru dan tampilkan QR-nya. Belum aktif sebelum dikonfirmasi. */
export async function startSetup(userId: string, input: unknown) {
  const { password } = z.object({ password: z.string().max(72) }).parse(input);
  const user = await findUser(userId);
  await confirmPassword(user, password);
  check(!user.twoFactor, 409, "Verifikasi 2 langkah sudah aktif.");
  const secret = newSecret();
  await updateUser(userId, current => ({ ...current, pendingTwoFactor: { secret: seal(secret), createdAt: new Date().toISOString() } }));
  const issuer = (await getInfo()).name || "Padelix";
  return { secret, otpauth_url: otpauthUrl(secret, user.email, issuer), issuer, account: user.email };
}

/** Langkah 2: kode pertama dari aplikasi membuktikan QR sudah dipindai. Kode cadangan hanya ditampilkan sekali. */
export async function confirmSetup(userId: string, input: unknown) {
  const { code } = z.object({ code: codeSchema }).parse(input);
  const user = await findUser(userId);
  check(!user.twoFactor, 409, "Verifikasi 2 langkah sudah aktif.");
  const pending = user.pendingTwoFactor;
  check(pending && Date.now() - Date.parse(pending.createdAt) < 30 * 60000, 409, "Penyiapan sudah kedaluwarsa. Mulai lagi dari awal.");
  const step = verifyTotp(unseal(pending.secret), code);
  check(step !== null, 400, "Kode tidak cocok. Pastikan jam ponsel sudah otomatis lalu coba kode terbaru.");
  const codes = newRecoveryCodes();
  await updateUser(userId, ({ pendingTwoFactor: _, ...current }) => ({
    ...current, twoFactor: { secret: pending.secret, enabledAt: new Date().toISOString(), recovery: codes.map(hashRecovery), lastStep: step },
  }));
  await audit(userId, "2fa.enable", userId);
  return { recovery_codes: codes, status: twoFactorStatus(await findUser(userId)) };
}

/** Matikan sendiri: butuh password dan kode yang masih berlaku. */
export async function disable(userId: string, input: unknown) {
  const { password, code } = z.object({ password: z.string().max(72), code: codeSchema }).parse(input);
  const user = await findUser(userId);
  check(user.twoFactor, 409, "Verifikasi 2 langkah belum aktif.");
  await confirmPassword(user, password);
  check(await useSecondFactor(userId, code), 400, "Kode verifikasi tidak cocok.");
  await updateUser(userId, ({ twoFactor: _, pendingTwoFactor: __, ...current }) => current);
  await audit(userId, "2fa.disable", userId);
  return twoFactorStatus(await findUser(userId));
}

/** Ganti seluruh kode cadangan; kode lama langsung tidak berlaku. */
export async function regenerateRecovery(userId: string, input: unknown) {
  const { password } = z.object({ password: z.string().max(72) }).parse(input);
  const user = await findUser(userId);
  check(user.twoFactor, 409, "Verifikasi 2 langkah belum aktif.");
  await confirmPassword(user, password);
  const codes = newRecoveryCodes();
  await updateUser(userId, current => ({ ...current, twoFactor: { ...current.twoFactor!, recovery: codes.map(hashRecovery) } }));
  await audit(userId, "2fa.recovery_regenerate", userId);
  return { recovery_codes: codes, status: twoFactorStatus(await findUser(userId)) };
}

/** Admin mematikan verifikasi 2 langkah staf yang kehilangan ponsel dan kode cadangannya. */
export async function resetByAdmin(targetId: string, actor: string) {
  check(targetId !== actor, 400, "Matikan verifikasi 2 langkah Anda sendiri dari Profil Saya.");
  const user = await findUser(targetId);
  check(user.twoFactor || user.pendingTwoFactor, 409, "Pengguna ini belum memakai verifikasi 2 langkah.");
  await updateUser(targetId, ({ twoFactor: _, pendingTwoFactor: __, ...current }) => current);
  await revokeSessions(targetId);
  await audit(actor, "2fa.reset", targetId);
}

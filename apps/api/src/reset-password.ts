import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { revokeSessions } from "./auth.js";
import { audit, db, getUsers, saveUsers, transaction } from "./store.js";

/**
 * Jalan darurat bila admin terakhir lupa password atau kehilangan ponsel 2 langkah, dan email belum aktif.
 * Hanya bisa dijalankan oleh orang yang punya akses ke server:
 *
 *   npm run reset-password -w apps/api -- admin@venue.com
 *   npm run reset-password -w apps/api -- admin@venue.com --matikan-2fa
 *   node dist/reset-password.js admin@venue.com          (di server produksi)
 *
 * Mencetak password sementara; semua sesi akun itu dicabut. Ganti password dari Profil Saya setelah masuk.
 */
const args = process.argv.slice(2);
const email = args.find(arg => !arg.startsWith("--"))?.trim().toLowerCase();
const clearTwoFactor = args.includes("--matikan-2fa");
if (!email) {
  console.error("Pakai: npm run reset-password -w apps/api -- email@staf [--matikan-2fa]");
  await db.close();
  process.exit(1);
}
// Memenuhi aturan password: minimal satu huruf kapital dan satu angka.
const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const temporary = Array.from({ length: 10 }, () => letters[randomInt(letters.length)]).join("") + "Q" + randomInt(10, 99);
const passwordHash = await bcrypt.hash(temporary, 12);
const user = await transaction(async () => {
  const users = await getUsers(), index = users.findIndex(item => item.email.toLowerCase() === email);
  if (index < 0) return null;
  const { twoFactor, pendingTwoFactor, ...rest } = users[index];
  users[index] = clearTwoFactor ? { ...rest, passwordHash } : { ...rest, twoFactor, pendingTwoFactor, passwordHash };
  await saveUsers(users);
  await revokeSessions(users[index].id);
  await audit("sistem", clearTwoFactor ? "password.reset_cli_2fa" : "password.reset_cli", users[index].id);
  return users[index];
});
await db.close();
if (!user) {
  console.error(`Tidak ada akun staf dengan email ${email}.`);
  process.exit(1);
}
console.log(`Password sementara untuk ${user.name} (${user.email}): ${temporary}`);
if (clearTwoFactor) console.log("Verifikasi 2 langkah dimatikan. Aktifkan lagi dari Profil Saya.");
else if (user.twoFactor) console.log("Verifikasi 2 langkah masih aktif. Tambahkan --matikan-2fa bila ponselnya hilang.");
console.log("Segera ganti password ini dari Profil Saya setelah masuk.");

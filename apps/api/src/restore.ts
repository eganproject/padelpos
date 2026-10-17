import path from "node:path";
import { backupDir, restoreBackup } from "./backups.js";
import { db } from "./store.js";
import { rowCounts } from "./datatransfer.js";

/**
 * Pulihkan database dari berkas backup:
 *   npm run restore -w apps/api -- padelix-20261017-020000-auto.json.gz --yes
 * Nama berkas tanpa folder dicari di folder backup. Seluruh isi database saat ini diganti.
 */
const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith("--"));
if (!target) {
  console.error("Sebutkan berkas backup. Contoh: npm run restore -w apps/api -- padelix-20261017-020000-auto.json.gz --yes");
  process.exit(1);
}
const file = path.isAbsolute(target) || target.includes("/") ? path.resolve(target) : path.join(backupDir, target);
const existing = await rowCounts(["bookings", "users"]);
if ((existing.bookings || existing.users) && !args.includes("--yes")) {
  console.error(`Database tujuan sudah berisi ${existing.users} pengguna dan ${existing.bookings} booking. Tambahkan --yes untuk menggantinya dengan isi backup.`);
  await db.close();
  process.exit(1);
}
try {
  const { header, counts } = await restoreBackup(file);
  console.log(`Database dipulihkan dari ${path.basename(file)} (dibuat ${header?.created_at}).`);
  console.log(Object.entries(counts).filter(([, count]) => count > 0).map(([table, count]) => `  ${table}: ${count}`).join("\n"));
} catch (error) {
  console.error("Pemulihan gagal, database tidak diubah:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}

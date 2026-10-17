import { createBackup } from "./backups.js";
import { db } from "./store.js";

/** Backup manual dari terminal: `npm run backup -w apps/api`. */
const result = await createBackup("manual");
await db.close();
console.log(`Backup tersimpan: ${result.name}`);
console.log(Object.entries(result.counts).filter(([, count]) => count > 0).map(([table, count]) => `  ${table}: ${count}`).join("\n"));

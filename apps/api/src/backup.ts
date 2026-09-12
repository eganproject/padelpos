import { backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { db } from "./store.js";

const directory = path.join(dataDir, "backups");
mkdirSync(directory, { recursive: true });
const destination = path.join(directory, `padelix-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
await backup(db, destination);
db.close();
console.log(`Backup tersimpan: ${destination}`);

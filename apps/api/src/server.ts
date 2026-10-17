import { app } from "./app.js";
import { startMailer } from "./notifications.js";
import { startBackups } from "./backups.js";
import { db } from "./store.js";

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`Padelix API running at http://localhost:${port}`));
const stopMailer = startMailer();
const stopBackups = startBackups();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  stopMailer(); stopBackups();
  server.close(() => { db.close().catch(() => undefined).finally(() => process.exit(0)); });
});

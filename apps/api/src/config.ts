import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const apiDir = fileURLToPath(new URL("../", import.meta.url));
config({ path: path.resolve(apiDir, "../../.env"), quiet: true });
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(apiDir, "data"));
export const production = process.env.NODE_ENV === "production";
/**
 * Alamat database MySQL 8. Isi DATABASE_URL (mysql://user:password@host:3306/nama_database) atau
 * MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, dan MYSQL_DATABASE.
 */
function mysqlUrl() {
  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
  if (production && !process.env.MYSQL_HOST && !process.env.MYSQL_DATABASE) throw new Error("DATABASE_URL belum diisi. Lihat bagian Database di README.");
  const user = encodeURIComponent(env("MYSQL_USER", "padelix")), password = encodeURIComponent(process.env.MYSQL_PASSWORD ?? "padelix");
  return `mysql://${user}${password ? ":" + password : ""}@${env("MYSQL_HOST", "127.0.0.1")}:${env("MYSQL_PORT", "3306")}/${encodeURIComponent(env("MYSQL_DATABASE", "padelix"))}`;
}
export const databaseUrl = mysqlUrl();
export const venueTimezone = process.env.VENUE_TIMEZONE || "Asia/Jakarta";
new Intl.DateTimeFormat("en", { timeZone: venueTimezone });
// Pesan validasi bawaan Zod ikut berbahasa Indonesia, sama dengan pesan buatan sendiri.
z.config(z.locales.id());

export const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
/** Alamat yang dibuka pelanggan; dipakai untuk URL kembali dan webhook Midtrans. */
export const publicUrl = (process.env.PUBLIC_URL || clientUrl).replace(/[/]+$/, "");

/**
 * Kunci HMAC bersama API dan server web untuk meneruskan IP asli pengunjung (lihat ratelimit.ts).
 * Bila INTERNAL_PROXY_SECRET kosong, API membuat kunci acak di `DATA_DIR/proxy-secret` dan server web
 * membaca berkas yang sama, sehingga instalasi satu mesin langsung jalan tanpa pengaturan.
 */
function loadProxySecret() {
  const fromEnv = process.env.INTERNAL_PROXY_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, "proxy-secret");
  try {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    mkdirSync(dataDir, { recursive: true });
    const value = randomBytes(32).toString("hex");
    writeFileSync(file, value + "\n", { mode: 0o600, flag: "wx" });
    return value;
  } catch (error) {
    // Proses lain baru saja membuatnya, atau folder data tidak bisa ditulis.
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    console.warn("INTERNAL_PROXY_SECRET kosong dan berkas kunci tidak bisa dibuat:", (error as Error).message);
    return "";
  }
}
export const proxySecret = loadProxySecret();

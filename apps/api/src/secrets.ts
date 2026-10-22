import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

/**
 * Enkripsi kunci rahasia yang disimpan di database (server key Midtrans, password SMTP, token WhatsApp,
 * rahasia verifikasi 2 langkah). Siapa pun yang hanya memegang salinan database atau berkas cadangan
 * tidak bisa membacanya tanpa kunci ini.
 *
 * Kuncinya dibaca dari SECRET_KEY, atau dibuat sekali di `DATA_DIR/secret-key`. Simpan berkas itu
 * bersama cadangan, di tempat terpisah: memulihkan database ke server lain tanpa kunci yang sama
 * membuat kunci rahasia tadi perlu diisi ulang dari panel admin.
 */
const prefix = "enc:v1:";
let cached: Buffer | null = null;
function key() {
  if (cached) return cached;
  const fromEnv = process.env.SECRET_KEY?.trim();
  let material = fromEnv || "";
  if (!material) {
    const file = path.join(dataDir, "secret-key");
    try {
      if (existsSync(file)) material = readFileSync(file, "utf8").trim();
      else {
        mkdirSync(dataDir, { recursive: true });
        material = randomBytes(32).toString("hex");
        writeFileSync(file, material + "\n", { mode: 0o600, flag: "wx" });
      }
    } catch (error) {
      // Proses lain baru saja membuatnya.
      if (existsSync(file)) material = readFileSync(file, "utf8").trim();
      else throw new Error(`SECRET_KEY kosong dan berkas kunci tidak bisa dibuat: ${(error as Error).message}`);
    }
  }
  cached = createHash("sha256").update(material).digest();
  return cached;
}

export const isSealed = (value: unknown): value is string => typeof value === "string" && value.startsWith(prefix);

/** Enkripsi AES-256-GCM. Nilai kosong tetap kosong agar "belum diisi" tetap terbaca. */
export function seal(value: string) {
  if (!value || isSealed(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return prefix + [iv, cipher.getAuthTag(), body].map(part => part.toString("base64url")).join(".");
}

/**
 * Buka nilai terenkripsi. Teks biasa dari versi lama dikembalikan apa adanya. Bila kuncinya berbeda
 * (mis. database dipulihkan di server lain), hasilnya kosong sehingga panel meminta kunci diisi ulang.
 */
export function unseal(value: string | null | undefined) {
  if (!value) return "";
  if (!isSealed(value)) return value;
  try {
    const [iv, tag, body] = value.slice(prefix.length).split(".").map(part => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    console.warn("Kunci rahasia tidak bisa dibuka dengan SECRET_KEY saat ini; isi ulang dari panel admin.");
    return "";
  }
}

/** Untuk pengujian: lupakan kunci yang sudah dibaca. */
export function resetSecretKeyCache() { cached = null; }

/**
 * Data lama menyimpan kunci sebagai teks biasa. Dijalankan saat server mulai: setiap kunci yang belum
 * terenkripsi dienkripsi di tempat. Aman diulang.
 */
export async function sealStoredSecrets() {
  const { readSetting, saveSetting, transaction } = await import("./store.js");
  const fields: [string, string][] = [["payment", "server_key"], ["email", "password"], ["whatsapp", "token"]];
  let sealed = 0;
  await transaction(async () => {
    for (const [name, field] of fields) {
      const document = await readSetting<Record<string, unknown>>(name);
      const value = document?.[field];
      if (typeof value !== "string" || !value || isSealed(value)) continue;
      await saveSetting(name, { ...document, [field]: seal(value) });
      sealed++;
    }
  });
  return sealed;
}

/** Token bertanda tangan berumur pendek (mis. tiket login 2 langkah). Kuncinya diturunkan dari kunci rahasia. */
const ticketKey = () => createHmac("sha256", key()).update("padelix-ticket").digest();
export function signTicket(payload: Record<string, unknown>, ttlMs: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${createHmac("sha256", ticketKey()).update(body).digest("base64url")}`;
}
export function readTicket<T extends Record<string, unknown>>(ticket: unknown): T | null {
  if (typeof ticket !== "string" || ticket.length > 1000) return null;
  const [body, signature] = ticket.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", ticketKey()).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    return typeof data.exp === "number" && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

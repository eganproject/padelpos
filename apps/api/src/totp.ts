import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Kode verifikasi 2 langkah (TOTP, RFC 6238): 6 angka yang berganti tiap 30 detik, sama dengan
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password, dan sejenisnya.
 */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const step = 30;

export function toBase32(buffer: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
export function fromBase32(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export const newSecret = () => toBase32(randomBytes(20));

function hotp(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
export const totpAt = (secret: string, time = Date.now()) => hotp(fromBase32(secret), Math.floor(time / 1000 / step));

/**
 * Langkah waktu yang cocok, atau null. Selisih jam ponsel satu langkah (±30 detik) masih diterima.
 * Langkah yang sudah pernah dipakai (`after`) ditolak agar kode yang sama tidak bisa dipakai ulang.
 */
export function verifyTotp(secret: string, code: string, after = 0, time = Date.now()) {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const key = fromBase32(secret), current = Math.floor(time / 1000 / step);
  for (const drift of [0, -1, 1]) {
    const counter = current + drift;
    if (counter > after && hotp(key, counter) === clean) return counter;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${step}`;
}

/** Kode cadangan sekali pakai, format XXXX-XXXX tanpa huruf yang mudah tertukar. */
const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = Array.from({ length: 8 }, () => recoveryAlphabet[randomInt(recoveryAlphabet.length)]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}
export const normalizeRecovery = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashRecovery = (code: string) => createHash("sha256").update(normalizeRecovery(code)).digest("hex");

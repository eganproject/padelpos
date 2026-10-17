import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import next from "next";

/**
 * Server Next.js dengan satu tambahan: IP asli pengunjung diteruskan ke API lewat header
 * `x-padelix-client`, ditandatangani HMAC dengan INTERNAL_PROXY_SECRET (atau berkas DATA_DIR/proxy-secret
 * buatan API bila variabel itu kosong). Rewrite bawaan Next.js
 * tidak menambahkan X-Forwarded-For, jadi tanpa ini semua pengunjung terlihat sebagai 127.0.0.1
 * dan rate limit login atau checkout berlaku untuk semua orang sekaligus.
 *
 * Header kiriman browser dengan nama yang sama selalu dibuang lebih dulu. Bila ada reverse proxy
 * (nginx, Cloudflare) di depan server ini, isi TRUST_PROXY agar IP diambil dari X-Forwarded-For.
 *
 *   node server.mjs              mode pengembangan (sama dengan `next dev`)
 *   node server.mjs --production mode produksi setelah `next build` (sama dengan `next start`)
 */
const root = path.dirname(fileURLToPath(import.meta.url));
// .env di akar monorepo dibaca tanpa paket tambahan; variabel yang sudah diset tidak ditimpa.
const envFile = path.resolve(root, "../../.env");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}
const production = process.argv.includes("--production");
if (production) process.env.NODE_ENV = "production";
const portFlag = process.argv.indexOf("-p");
const port = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.WEB_PORT || 3000);
const secretFile = path.join(path.resolve(process.env.DATA_DIR || path.resolve(root, "../api/data")), "proxy-secret");
let secret = process.env.INTERNAL_PROXY_SECRET?.trim() || "";
/** Tanpa INTERNAL_PROXY_SECRET, pakai kunci yang dibuat API di DATA_DIR (bisa muncul setelah web menyala). */
function currentSecret() {
  if (!secret && existsSync(secretFile)) secret = readFileSync(secretFile, "utf8").trim();
  return secret;
}
const trustProxy = process.env.TRUST_PROXY?.trim() || "";
const hops = /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy ? 1 : 0;

function clientIp(req) {
  const socket = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (!hops) return socket;
  // IP pengunjung adalah alamat ke-`hops` dari kanan pada X-Forwarded-For buatan proxy tepercaya.
  const chain = String(req.headers["x-forwarded-for"] || "").split(",").map(value => value.trim()).filter(Boolean);
  return chain[chain.length - hops] || socket;
}

const app = next({ dev: !production, dir: root, port });
const handle = app.getRequestHandler();
await app.prepare();
createServer((req, res) => {
  delete req.headers["x-padelix-client"];
  const key = req.url?.startsWith("/api/") ? currentSecret() : "";
  if (key) {
    const ip = clientIp(req), at = Math.floor(Date.now() / 1000);
    req.headers["x-padelix-client"] = `${ip};${at};${createHmac("sha256", key).update(`${ip};${at}`).digest("hex")}`;
  }
  handle(req, res).catch(error => { console.error(error); res.statusCode = 500; res.end("Internal Server Error"); });
}).listen(port, () => console.log(`Padelix web berjalan di http://localhost:${port}${currentSecret() ? "" : " (kunci proxy belum ada; IP pengunjung diteruskan setelah API menyala)"}`));

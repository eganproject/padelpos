import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { proxySecret as secret } from "./config.js";

/**
 * IP pengunjung untuk rate limit.
 *
 * Browser memanggil API lewat rewrite Next.js, sehingga di mata API semua permintaan datang dari
 * 127.0.0.1. Server web (apps/web/server.mjs) menambahkan header `x-padelix-client` berisi IP asli,
 * waktu, dan tanda tangan HMAC dengan INTERNAL_PROXY_SECRET. Header hanya dipercaya bila tanda
 * tangannya cocok dan umurnya kurang dari 5 menit, jadi pengunjung tidak bisa memalsukannya.
 * Tanpa header yang sah, dipakai `req.ip` (yang mengikuti TRUST_PROXY seperti sebelumnya).
 */
const cache = new WeakMap<Request, string>();
export function clientIp(req: Request) {
  const known = cache.get(req);
  if (known) return known;
  let ip = req.ip || req.socket.remoteAddress || "unknown";
  const header = req.headers["x-padelix-client"];
  if (secret && typeof header === "string") {
    const [claimed, at, signature] = header.split(";");
    const expected = createHmac("sha256", secret).update(`${claimed};${at}`).digest();
    const given = Buffer.from(signature ?? "", "hex");
    const fresh = Math.abs(Date.now() / 1000 - Number(at)) <= 300;
    if (claimed && fresh && given.length === expected.length && timingSafeEqual(given, expected)) ip = claimed;
  }
  cache.set(req, ip);
  return ip;
}

/** Rate limit per IP pengunjung. `key` menambah pembeda lain, mis. email login. */
export function limiter(windowMs: number, limit: number, message: string, extra: Partial<Options> & { key?: (req: Request) => string } = {}) {
  const { key, ...options } = extra;
  return rateLimit({
    windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { message },
    keyGenerator: req => ipKeyGenerator(clientIp(req)) + (key ? "|" + key(req) : ""),
    // X-Forwarded-For sengaja tidak dipercaya kecuali TRUST_PROXY diisi; peringatan bawaannya tidak perlu.
    validate: { xForwardedForHeader: false },
    ...options,
  });
}

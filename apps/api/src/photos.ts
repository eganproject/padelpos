import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";

/**
 * Foto lapangan disimpan di database agar ikut tercadang bersama database dan tidak
 * butuh penyimpanan berkas terpisah. Browser admin sudah memperkecil foto sebelum
 * mengunggah, jadi ukurannya ratusan KB, bukan belasan MB dari kamera ponsel.
 */
export const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = typeof photoTypes[number];
export const maxPhotosPerCourt = 6;
export const maxPhotoSize = "3mb";

// Tipe dari header saja mudah dipalsukan; cocokkan juga tanda tangan berkasnya.
const signatures: Record<PhotoType, (data: Buffer) => boolean> = {
  "image/jpeg": data => data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": data => data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": data => data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
};

export interface CourtPhoto { id: string; court_id: string; position: number; bytes: number }

export async function courtPhotos(courtId: string) {
  return await db.prepare("SELECT id,court_id,position,bytes FROM court_photos WHERE court_id=? ORDER BY position,created_at").all(courtId) as CourtPhoto[];
}

/** Id foto per lapangan, urut dengan foto sampul di depan. */
export async function photoIndex() {
  const index = new Map<string, string[]>();
  for (const row of await db.prepare("SELECT id,court_id FROM court_photos ORDER BY court_id,position,created_at").all() as { id: string; court_id: string }[])
    index.set(row.court_id, [...(index.get(row.court_id) ?? []), row.id]);
  return index;
}

async function renumber(courtId: string, ids: string[]) {
  for (const [position, id] of ids.entries()) await db.prepare("UPDATE court_photos SET position=? WHERE id=? AND court_id=?").run(position, id, courtId);
}

/** Validasi berkas foto kiriman admin (lapangan maupun item tambahan). */
export function checkImage(contentType: string | undefined, body: unknown): PhotoType {
  const type = photoTypes.find(item => item === contentType?.split(";")[0].trim().toLowerCase());
  check(type, 415, "Format foto harus JPG, PNG, atau WebP.");
  check(Buffer.isBuffer(body) && body.length > 0, 400, "Berkas foto kosong.");
  check(signatures[type](body), 400, "Isi berkas bukan foto yang valid.");
  return type;
}

export async function addPhoto(courtId: string, contentType: string | undefined, body: unknown, actor: string) {
  const type = checkImage(contentType, body);
  return await transaction(async () => {
    check(await db.prepare("SELECT 1 FROM courts WHERE id=?").get(courtId), 404, "Lapangan tidak ditemukan.");
    const existing = await courtPhotos(courtId);
    check(existing.length < maxPhotosPerCourt, 409, `Maksimal ${maxPhotosPerCourt} foto per lapangan. Hapus salah satu terlebih dahulu.`);
    const id = randomUUID();
    await db.prepare("INSERT INTO court_photos (id,court_id,mime,data,bytes,position,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, courtId, type, body as Buffer, (body as Buffer).length, existing.length, new Date().toISOString());
    await audit(actor, "court.photo.add", id);
    return await courtPhotos(courtId);
  });
}

export async function removePhoto(courtId: string, photoId: string, actor: string) {
  return await transaction(async () => {
    check((await db.prepare("DELETE FROM court_photos WHERE id=? AND court_id=?").run(photoId, courtId)).changes, 404, "Foto tidak ditemukan.");
    await renumber(courtId, (await courtPhotos(courtId)).map(photo => photo.id));
    await audit(actor, "court.photo.delete", photoId);
    return await courtPhotos(courtId);
  });
}

export async function orderPhotos(courtId: string, input: unknown, actor: string) {
  const { ids } = z.object({ ids: z.array(z.string().min(1)).max(maxPhotosPerCourt) }).parse(input);
  return await transaction(async () => {
    const current = (await courtPhotos(courtId)).map(photo => photo.id);
    check(ids.length === current.length && new Set(ids).size === ids.length && ids.every(id => current.includes(id)), 409, "Daftar foto sudah berubah. Muat ulang lalu coba lagi.");
    await renumber(courtId, ids);
    await audit(actor, "court.photo.order", courtId);
    return await courtPhotos(courtId);
  });
}

/** Foto lapangan, foto item tambahan, atau foto profil; semuanya memakai id acak sehingga tidak bisa tertukar. */
export async function photoFile(id: string) {
  return (await db.prepare("SELECT mime,data FROM court_photos WHERE id=?").get(id)
    ?? await db.prepare("SELECT photo_mime mime,photo_data data FROM addons WHERE photo_id=?").get(id)
    ?? await db.prepare("SELECT mime,data FROM avatars WHERE id=?").get(id)) as { mime: PhotoType; data: Uint8Array } | undefined;
}

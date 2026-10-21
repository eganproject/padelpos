import { randomUUID } from "node:crypto";
import { audit, db, getUsers, saveUsers, transaction } from "./store.js";
import { check } from "./errors.js";
import { checkImage } from "./photos.js";

/**
 * Foto profil staf dan pelanggan. Browser sudah memotongnya menjadi persegi kecil sebelum
 * diunggah, jadi ukurannya puluhan KB. Foto disajikan lewat /api/public/photos/:id bersama foto
 * lapangan; id-nya acak dan berganti setiap kali foto diganti.
 */
export const maxAvatarSize = "1mb";
export type AvatarOwner = "user" | "customer";

async function store(owner: AvatarOwner, ownerId: string, contentType: string | undefined, body: unknown) {
  const type = checkImage(contentType, body);
  const id = randomUUID();
  await db.prepare("DELETE FROM avatars WHERE owner_type=? AND owner_id=?").run(owner, ownerId);
  await db.prepare("INSERT INTO avatars (id,owner_type,owner_id,mime,data,bytes,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, owner, ownerId, type, body as Buffer, (body as Buffer).length, new Date().toISOString());
  return id;
}

/** Hapus foto milik akun; dipakai juga saat akun dihapus. */
export async function dropAvatar(owner: AvatarOwner, ownerId: string) {
  await db.prepare("DELETE FROM avatars WHERE owner_type=? AND owner_id=?").run(owner, ownerId);
}

async function updateUser(userId: string, avatarId: string | undefined) {
  const users = await getUsers(), index = users.findIndex(user => user.id === userId);
  check(index >= 0, 404, "Pengguna tidak ditemukan.");
  const { avatarId: _, ...rest } = users[index];
  users[index] = avatarId ? { ...rest, avatarId } : rest;
  await saveUsers(users);
  return users[index];
}

export async function setUserAvatar(userId: string, contentType: string | undefined, body: unknown) {
  checkImage(contentType, body);
  return await transaction(async () => {
    check((await getUsers()).some(user => user.id === userId), 404, "Pengguna tidak ditemukan.");
    const user = await updateUser(userId, await store("user", userId, contentType, body));
    await audit(userId, "profile.avatar.set", userId);
    return user;
  });
}
export async function removeUserAvatar(userId: string) {
  return await transaction(async () => {
    await dropAvatar("user", userId);
    const user = await updateUser(userId, undefined);
    await audit(userId, "profile.avatar.delete", userId);
    return user;
  });
}

export async function setCustomerAvatar(accountId: string, contentType: string | undefined, body: unknown) {
  checkImage(contentType, body);
  await transaction(async () => {
    check(await db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(accountId), 401, "Sesi akun berakhir. Silakan masuk kembali.");
    const id = await store("customer", accountId, contentType, body);
    await db.prepare("UPDATE customer_accounts SET avatar_id=? WHERE id=?").run(id, accountId);
    await audit(accountId, "customer.avatar.set", accountId);
  });
}
export async function removeCustomerAvatar(accountId: string) {
  await transaction(async () => {
    await dropAvatar("customer", accountId);
    await db.prepare("UPDATE customer_accounts SET avatar_id=NULL WHERE id=?").run(accountId);
    await audit(accountId, "customer.avatar.delete", accountId);
  });
}

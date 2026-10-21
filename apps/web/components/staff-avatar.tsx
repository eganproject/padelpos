import type { User } from "@/lib/api";
import { photoUrl } from "@/lib/venue-info";

export const initials = (name?: string) => (name || "Admin").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/** Foto profil staf bila sudah diunggah; tanpa foto, inisial nama. Ukuran dan warna dari kelas induk. */
export function StaffAvatar({ user }: { user: Pick<User, "name" | "avatarId"> | null }) {
  // eslint-disable-next-line @next/next/no-img-element -- foto kecil dari API sendiri, sudah diperkecil saat diunggah
  return user?.avatarId ? <img className="avatar-img" src={photoUrl(user.avatarId)} alt="" /> : <>{initials(user?.name)}</>;
}

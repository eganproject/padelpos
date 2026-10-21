export type Role = string;

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  /** Foto profil di tabel `avatars`; kosong berarti memakai inisial nama. */
  avatarId?: string;
}

export interface AccessRole {
  id: string;
  name: string;
  slug: Role | string;
  description: string;
  menuIds: string[];
  isSystem: boolean;
  createdAt: string;
}

export interface AccessMenu {
  id: string;
  name: string;
  path: string;
  icon: string;
  group: string;
  order: number;
  active: boolean;
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash">;

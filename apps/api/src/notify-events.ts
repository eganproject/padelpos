import { z } from "zod";

/**
 * Peristiwa yang dapat memicu notifikasi. Setiap kanal (email, WhatsApp) menyimpan pilihan
 * nyala/matinya sendiri; kotak masuk di akun pelanggan selalu menerima semuanya kecuali `staff_new`.
 */
export const notifyEvents = ["bill", "payment_due", "confirmed", "expired", "receipt", "reschedule", "cancelled", "reminder", "staff_new"] as const;
export type NotifyEvent = typeof notifyEvents[number];
export const defaultEvents = Object.fromEntries(notifyEvents.map(event => [event, true])) as Record<NotifyEvent, boolean>;
/** Panel lama yang belum mengenal peristiwa baru tetap dapat menyimpan; yang tidak dikirim memakai nilai bawaan. */
export const eventsSchema = z.object(Object.fromEntries(notifyEvents.map(event => [event, z.boolean().optional()])) as Record<NotifyEvent, z.ZodOptional<z.ZodBoolean>>)
  .default({})
  .transform(value => ({ ...defaultEvents, ...Object.fromEntries(Object.entries(value).filter(([, on]) => on !== undefined)) }) as Record<NotifyEvent, boolean>);

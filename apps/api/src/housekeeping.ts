import { expireHolds } from "./payments.js";
import { expirePendingSales } from "./counter.js";

/**
 * Pekerjaan rutin tiap menit yang sebelumnya hanya berjalan bila ada pengunjung membuka situs:
 * booking online yang lewat batas bayar dilepas (slot dan stok kembali, pelanggan dikabari), dan
 * transaksi kasir Midtrans yang tidak dibayar ditutup. Keduanya aman dijalankan bersamaan dari
 * beberapa proses API karena perubahan statusnya bersyarat. Tidak dijalankan saat tes.
 */
export async function runHousekeeping() {
  await expireHolds().catch(error => console.error("Gagal melepas booking kedaluwarsa:", (error as Error).message));
  await expirePendingSales().catch(error => console.error("Gagal menutup transaksi kasir kedaluwarsa:", (error as Error).message));
}
export function startHousekeeping(intervalMs = 60000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runHousekeeping(); } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  setTimeout(() => void tick(), 10000).unref();
  return () => clearInterval(timer);
}

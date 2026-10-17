import mysql from "mysql2/promise";

/**
 * Setiap berkas test memakai database MySQL sendiri yang dibuat ulang dari kosong, jadi test bisa
 * berjalan paralel. Alamat server: TEST_DATABASE_URL (tanpa nama database), bawaannya
 * mysql://padelix:padelix@127.0.0.1:3306. Pengguna MySQL itu perlu hak CREATE dan DROP.
 * Dipanggil sebelum `../src/store.js` diimpor.
 */
export async function useTestDatabase(name: string) {
  const server = new URL(process.env.TEST_DATABASE_URL || "mysql://padelix:padelix@127.0.0.1:3306");
  const database = `padelix_test_${name}`;
  server.pathname = "/";
  const connection = await mysql.createConnection({ uri: server.toString() });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
  } finally { await connection.end(); }
  server.pathname = "/" + database;
  process.env.DATABASE_URL = server.toString();
  return process.env.DATABASE_URL;
}

import type { AccessMenu, AccessRole } from "./types.js";

/**
 * Skema MySQL lengkap. Isinya setara dengan database SQLite lama setelah migrasi terakhirnya (17),
 * ditambah kolom `audit_log.detail`, tabel `app_lock`, dan menu Log Aktivitas serta Cadangan Data.
 *
 * Catatan perbedaan dengan SQLite:
 * - Kolase bawaan database `utf8mb4_0900_bin` (peka huruf besar/kecil dan tanpa padding spasi), sama
 *   dengan perbandingan teks SQLite. Kolom yang dulu `COLLATE NOCASE` memakai `utf8mb4_0900_as_ci`.
 * - Trigger bentrok jadwal tidak dipakai karena membuat trigger di MySQL ber-binlog butuh hak SUPER.
 *   Penjaganya pindah ke `assertScheduleFree` di operations.ts; semua penulisan berjalan di bawah kunci
 *   `app_lock` sehingga pemeriksaannya tidak bisa saling mendahului.
 * - Indeks unik pada isi JSON (email pengguna, slug role, path menu) memakai kolom turunan.
 */
const nocase = "COLLATE utf8mb4_0900_as_ci";
const id = "VARCHAR(64)";
const stamp = "VARCHAR(32)";
const date = "CHAR(10)";
const time = "CHAR(5)";
const photoMime = (column: string) => `${column} VARCHAR(20) CHECK(${column} IS NULL OR ${column} IN ('image/jpeg','image/png','image/webp'))`;

export const schema: string[] = [
  `CREATE TABLE app_lock (id INT PRIMARY KEY)`,
  `INSERT INTO app_lock (id) VALUES (1)`,
  `CREATE TABLE users (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    document LONGTEXT NOT NULL CHECK(json_valid(document)),
    email_key VARCHAR(255) GENERATED ALWAYS AS (lower(json_unquote(json_extract(document, '$.email')))) STORED,
    UNIQUE KEY users_email (email_key)
  )`,
  `CREATE TABLE roles (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    document LONGTEXT NOT NULL CHECK(json_valid(document)),
    slug_key VARCHAR(255) GENERATED ALWAYS AS (json_unquote(json_extract(document, '$.slug'))) STORED,
    UNIQUE KEY roles_slug (slug_key)
  )`,
  `CREATE TABLE menus (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    document LONGTEXT NOT NULL CHECK(json_valid(document)),
    path_key VARCHAR(255) GENERATED ALWAYS AS (json_unquote(json_extract(document, '$.path'))) STORED,
    UNIQUE KEY menus_path (path_key)
  )`,
  `CREATE TABLE settings (\`key\` VARCHAR(64) PRIMARY KEY, document LONGTEXT NOT NULL CHECK(json_valid(document)))`,
  `CREATE TABLE sessions (
    id VARCHAR(128) PRIMARY KEY,
    subject_id ${id} NOT NULL,
    subject_type VARCHAR(16) NOT NULL CHECK(subject_type IN ('staff','customer')),
    expires_at BIGINT NOT NULL,
    KEY sessions_subject (subject_id)
  )`,
  `CREATE TABLE audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id ${id} NOT NULL,
    action VARCHAR(120) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    detail LONGTEXT NULL CHECK(detail IS NULL OR json_valid(detail)),
    created_at ${stamp} NOT NULL,
    KEY audit_log_created (created_at),
    KEY audit_log_actor (actor_id, created_at),
    KEY audit_log_target (target_id),
    KEY audit_log_action (action)
  )`,
  `CREATE TABLE customers (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    created_at ${stamp} NOT NULL,
    UNIQUE KEY customers_phone (phone)
  )`,
  `CREATE TABLE otp_codes (
    phone VARCHAR(32) PRIMARY KEY,
    code_hash VARCHAR(255) NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    sent_at BIGINT NOT NULL
  )`,
  `CREATE TABLE floors (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    position INT NOT NULL,
    width INT NOT NULL CHECK(width BETWEEN 200 AND 5000),
    height INT NOT NULL CHECK(height BETWEEN 200 AND 5000),
    created_at ${stamp} NOT NULL
  )`,
  `CREATE TABLE courts (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) ${nocase} NOT NULL,
    hourly_rate BIGINT NOT NULL CHECK(hourly_rate > 0),
    opens_at ${time} NOT NULL,
    closes_at ${time} NOT NULL,
    active TINYINT NOT NULL DEFAULT 1,
    created_at ${stamp} NOT NULL,
    layout_x INT NOT NULL DEFAULT 0,
    layout_y INT NOT NULL DEFAULT 0,
    layout_w INT NOT NULL DEFAULT 100,
    layout_h INT NOT NULL DEFAULT 200,
    description TEXT NOT NULL DEFAULT (''),
    environment VARCHAR(16) NOT NULL DEFAULT '' CHECK(environment IN ('','indoor','outdoor')),
    surface VARCHAR(255) NOT NULL DEFAULT '',
    floor_id ${id} NULL,
    UNIQUE KEY courts_name (name),
    CONSTRAINT courts_floor FOREIGN KEY (floor_id) REFERENCES floors(id)
  )`,
  `CREATE TABLE venue_features (
    id ${id} PRIMARY KEY,
    kind VARCHAR(40) NOT NULL,
    label VARCHAR(255) NOT NULL DEFAULT '',
    x INT NOT NULL, y INT NOT NULL,
    w INT NOT NULL CHECK(w > 0), h INT NOT NULL CHECK(h > 0),
    created_at ${stamp} NOT NULL,
    floor_id ${id} NULL,
    CONSTRAINT venue_features_floor FOREIGN KEY (floor_id) REFERENCES floors(id)
  )`,
  `CREATE TABLE court_photos (
    id ${id} PRIMARY KEY,
    court_id ${id} NOT NULL,
    mime VARCHAR(20) NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
    data LONGBLOB NOT NULL,
    bytes INT NOT NULL CHECK(bytes > 0),
    position INT NOT NULL,
    created_at ${stamp} NOT NULL,
    KEY court_photos_court (court_id, position),
    CONSTRAINT court_photos_court_fk FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE price_rules (
    id ${id} PRIMARY KEY,
    label VARCHAR(255) NOT NULL,
    days VARCHAR(255) NOT NULL CHECK(json_valid(days)),
    start_time ${time} NOT NULL,
    end_time ${time} NOT NULL,
    hourly_rate BIGINT NOT NULL CHECK(hourly_rate > 0),
    created_at ${stamp} NOT NULL
  )`,
  `CREATE TABLE price_rule_courts (
    rule_id ${id} NOT NULL,
    court_id ${id} NOT NULL,
    PRIMARY KEY (rule_id, court_id),
    CONSTRAINT price_rule_courts_rule FOREIGN KEY (rule_id) REFERENCES price_rules(id) ON DELETE CASCADE,
    CONSTRAINT price_rule_courts_court FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE maintenance (
    id ${id} PRIMARY KEY,
    court_id ${id} NOT NULL,
    date ${date} NOT NULL,
    start_time ${time} NOT NULL,
    end_time ${time} NOT NULL,
    reason TEXT NOT NULL,
    KEY maintenance_schedule (court_id, date),
    CONSTRAINT maintenance_court FOREIGN KEY (court_id) REFERENCES courts(id)
  )`,
  `CREATE TABLE customer_accounts (
    id ${id} PRIMARY KEY,
    firebase_uid VARCHAR(128) NOT NULL,
    email VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    photo_url TEXT NOT NULL DEFAULT (''),
    created_at ${stamp} NOT NULL,
    last_login_at ${stamp} NOT NULL,
    UNIQUE KEY customer_accounts_uid (firebase_uid),
    KEY customer_accounts_phone (phone)
  )`,
  `CREATE TABLE orders (
    id ${id} PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    customer_id ${id},
    customer VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255) NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT (''),
    total BIGINT NOT NULL CHECK(total > 0),
    created_at ${stamp} NOT NULL,
    UNIQUE KEY orders_code (code),
    CONSTRAINT orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`,
  `CREATE TABLE bookings (
    id ${id} PRIMARY KEY,
    court_id ${id} NOT NULL,
    customer_id ${id},
    customer VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    date ${date} NOT NULL,
    start_time ${time} NOT NULL,
    end_time ${time} NOT NULL,
    total BIGINT NOT NULL CHECK(total > 0),
    status VARCHAR(16) NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled','expired')),
    source VARCHAR(16) NOT NULL DEFAULT 'staff' CHECK(source IN ('staff','online')),
    hold_expires_at BIGINT,
    notes TEXT NOT NULL DEFAULT (''),
    created_by ${id},
    created_at ${stamp} NOT NULL,
    cancel_reason TEXT NOT NULL DEFAULT (''),
    court_total BIGINT,
    order_id ${id},
    account_id ${id},
    discount BIGINT NOT NULL DEFAULT 0 CHECK(discount >= 0),
    discount_note TEXT NOT NULL DEFAULT (''),
    tax BIGINT NOT NULL DEFAULT 0 CHECK(tax >= 0),
    tax_rate INT NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
    tax_inclusive TINYINT NOT NULL DEFAULT 0,
    tax_label VARCHAR(64) NOT NULL DEFAULT '',
    forfeited BIGINT NOT NULL DEFAULT 0 CHECK(forfeited >= 0),
    forfeited_at ${stamp},
    reschedule_count INT NOT NULL DEFAULT 0,
    email VARCHAR(255) NOT NULL DEFAULT '',
    CHECK ((source='staff' AND created_by IS NOT NULL) OR (source='online' AND customer_id IS NOT NULL)),
    CHECK (status<>'pending' OR hold_expires_at IS NOT NULL),
    KEY bookings_schedule (court_id, date, start_time, end_time),
    KEY bookings_hold (status, hold_expires_at),
    KEY bookings_customer (customer_id),
    KEY bookings_order (order_id),
    KEY bookings_account (account_id, date),
    KEY bookings_date (date, start_time),
    CONSTRAINT bookings_court FOREIGN KEY (court_id) REFERENCES courts(id),
    CONSTRAINT bookings_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT bookings_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT bookings_account_fk FOREIGN KEY (account_id) REFERENCES customer_accounts(id)
  )`,
  `CREATE TABLE payments (
    id ${id} PRIMARY KEY,
    booking_id ${id} NOT NULL,
    amount BIGINT NOT NULL CHECK(amount > 0),
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('payment','refund')),
    method VARCHAR(16) NOT NULL CHECK(method IN ('cash','transfer','qris','va','ewallet','card')),
    source VARCHAR(16) NOT NULL DEFAULT 'staff' CHECK(source IN ('staff','gateway')),
    gateway_ref VARCHAR(191),
    note TEXT NOT NULL DEFAULT (''),
    created_by ${id},
    created_at ${stamp} NOT NULL,
    fee BIGINT NOT NULL DEFAULT 0 CHECK(fee >= 0),
    CHECK (source='gateway' OR created_by IS NOT NULL),
    KEY payments_booking (booking_id),
    UNIQUE KEY payments_gateway_ref (gateway_ref),
    KEY payments_created (created_at),
    CONSTRAINT payments_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id)
  )`,
  `CREATE TABLE addons (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) ${nocase} NOT NULL,
    category VARCHAR(64) NOT NULL,
    type VARCHAR(16) NOT NULL CHECK(type IN ('sewa','jual','layanan')),
    pricing VARCHAR(16) NOT NULL CHECK(pricing IN ('per_booking','per_hour')),
    price BIGINT NOT NULL CHECK(price >= 0),
    stock INT CHECK(stock IS NULL OR stock >= 0),
    low_stock INT NOT NULL DEFAULT 0 CHECK(low_stock >= 0),
    max_per_booking INT NOT NULL CHECK(max_per_booking BETWEEN 1 AND 99),
    description TEXT NOT NULL DEFAULT (''),
    active TINYINT NOT NULL DEFAULT 1,
    online TINYINT NOT NULL DEFAULT 1,
    position INT NOT NULL,
    photo_id ${id},
    ${photoMime("photo_mime")},
    photo_data LONGBLOB,
    created_at ${stamp} NOT NULL,
    UNIQUE KEY addons_name (name),
    UNIQUE KEY addons_photo (photo_id)
  )`,
  `CREATE TABLE booking_addons (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    booking_id ${id} NOT NULL,
    addon_id ${id},
    name VARCHAR(255) NOT NULL,
    type VARCHAR(16) NOT NULL CHECK(type IN ('sewa','jual','layanan','lainnya')),
    pricing VARCHAR(16) NOT NULL CHECK(pricing IN ('per_booking','per_hour')),
    unit_price BIGINT NOT NULL CHECK(unit_price >= 0),
    quantity INT NOT NULL CHECK(quantity > 0),
    subtotal BIGINT NOT NULL CHECK(subtotal >= 0),
    returned_at ${stamp},
    created_by ${id},
    created_at ${stamp} NOT NULL,
    KEY booking_addons_booking (booking_id),
    KEY booking_addons_addon (addon_id),
    CONSTRAINT booking_addons_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id),
    CONSTRAINT booking_addons_addon_fk FOREIGN KEY (addon_id) REFERENCES addons(id)
  )`,
  `CREATE TABLE addon_stock_moves (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    addon_id ${id} NOT NULL,
    delta INT NOT NULL,
    reason VARCHAR(16) NOT NULL CHECK(reason IN ('awal','restok','koreksi','rusak','terpakai','kembali')),
    note TEXT NOT NULL DEFAULT (''),
    booking_id ${id},
    stock_after INT NOT NULL,
    created_by ${id},
    created_at ${stamp} NOT NULL,
    KEY addon_stock_moves_addon (addon_id, created_at),
    CONSTRAINT addon_stock_moves_addon_fk FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE,
    CONSTRAINT addon_stock_moves_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id)
  )`,
  `CREATE TABLE payment_intents (
    order_id VARCHAR(100) PRIMARY KEY,
    booking_id ${id} NOT NULL,
    amount BIGINT NOT NULL CHECK(amount > 0),
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('booking','tagihan')),
    status VARCHAR(16) NOT NULL CHECK(status IN ('pending','paid','expired','cancelled','failed','refunded')),
    snap_token VARCHAR(255),
    redirect_url TEXT,
    payment_type VARCHAR(64),
    transaction_id VARCHAR(128),
    environment VARCHAR(16) NOT NULL,
    expires_at BIGINT NOT NULL,
    raw_status TEXT,
    created_by ${id},
    created_at ${stamp} NOT NULL,
    updated_at ${stamp} NOT NULL,
    order_ref ${id},
    KEY payment_intents_booking (booking_id, created_at),
    KEY payment_intents_status (status, expires_at),
    KEY payment_intents_order (order_ref),
    CONSTRAINT payment_intents_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id),
    CONSTRAINT payment_intents_order_fk FOREIGN KEY (order_ref) REFERENCES orders(id)
  )`,
  `CREATE TABLE accounts (
    id ${id} PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) ${nocase} NOT NULL,
    type VARCHAR(16) NOT NULL CHECK(type IN ('aset','liabilitas','ekuitas','pendapatan','beban')),
    subtype VARCHAR(16) NOT NULL CHECK(subtype IN ('kas_bank','piutang','persediaan','aset_tetap','utang','modal','pendapatan','beban')),
    is_cash TINYINT NOT NULL DEFAULT 0,
    system_key VARCHAR(64),
    description TEXT NOT NULL DEFAULT (''),
    active TINYINT NOT NULL DEFAULT 1,
    position INT NOT NULL,
    created_at ${stamp} NOT NULL,
    CHECK (is_cash IN (0,1) AND (is_cash=0 OR subtype='kas_bank')),
    UNIQUE KEY accounts_code (code),
    UNIQUE KEY accounts_name (name),
    UNIQUE KEY accounts_system_key (system_key)
  )`,
  `CREATE TABLE partners (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) ${nocase} NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('pemasok','pelanggan','karyawan','lainnya')),
    phone VARCHAR(32) NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT (''),
    active TINYINT NOT NULL DEFAULT 1,
    created_at ${stamp} NOT NULL,
    UNIQUE KEY partners_name (name)
  )`,
  `CREATE TABLE journal_entries (
    id ${id} PRIMARY KEY,
    number VARCHAR(32) NOT NULL,
    date ${date} NOT NULL,
    memo TEXT NOT NULL DEFAULT (''),
    source VARCHAR(16) NOT NULL CHECK(source IN ('manual','catatan','pelunasan','transfer','modal','booking','pembayaran')),
    ref_id ${id},
    created_by ${id},
    created_at ${stamp} NOT NULL,
    UNIQUE KEY journal_entries_number (number),
    KEY journal_entries_date (date, number),
    UNIQUE KEY journal_entries_ref (source, ref_id)
  )`,
  `CREATE TABLE journal_lines (
    id ${id} PRIMARY KEY,
    entry_id ${id} NOT NULL,
    account_id ${id} NOT NULL,
    debit BIGINT NOT NULL DEFAULT 0 CHECK(debit >= 0),
    credit BIGINT NOT NULL DEFAULT 0 CHECK(credit >= 0),
    memo TEXT NOT NULL DEFAULT (''),
    partner_id ${id},
    booking_id ${id},
    position INT NOT NULL,
    CHECK ((debit = 0) <> (credit = 0)),
    KEY journal_lines_entry (entry_id, position),
    KEY journal_lines_account (account_id),
    KEY journal_lines_partner (partner_id),
    KEY journal_lines_booking (booking_id),
    CONSTRAINT journal_lines_entry_fk FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    CONSTRAINT journal_lines_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id),
    CONSTRAINT journal_lines_partner_fk FOREIGN KEY (partner_id) REFERENCES partners(id),
    CONSTRAINT journal_lines_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id)
  )`,
  `CREATE TABLE finance_records (
    id ${id} PRIMARY KEY,
    number VARCHAR(32) NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('pengeluaran','pemasukan')),
    date ${date} NOT NULL,
    account_id ${id} NOT NULL,
    amount BIGINT NOT NULL CHECK(amount > 0),
    settle VARCHAR(16) NOT NULL CHECK(settle IN ('tunai','tempo')),
    cash_account_id ${id},
    partner_id ${id},
    description TEXT NOT NULL,
    due_date ${date},
    settled_at ${date},
    settled_entry_id ${id},
    entry_id ${id},
    photo_id ${id},
    ${photoMime("photo_mime")},
    photo_data LONGBLOB,
    created_by ${id},
    created_at ${stamp} NOT NULL,
    CHECK ((settle='tunai') = (cash_account_id IS NOT NULL)),
    UNIQUE KEY finance_records_number (number),
    UNIQUE KEY finance_records_photo (photo_id),
    KEY finance_records_date (date, number),
    KEY finance_records_partner (partner_id),
    CONSTRAINT finance_records_account FOREIGN KEY (account_id) REFERENCES accounts(id),
    CONSTRAINT finance_records_cash FOREIGN KEY (cash_account_id) REFERENCES accounts(id),
    CONSTRAINT finance_records_partner_fk FOREIGN KEY (partner_id) REFERENCES partners(id),
    CONSTRAINT finance_records_settled FOREIGN KEY (settled_entry_id) REFERENCES journal_entries(id),
    CONSTRAINT finance_records_entry FOREIGN KEY (entry_id) REFERENCES journal_entries(id)
  )`,
  `CREATE TABLE email_outbox (
    id ${id} PRIMARY KEY,
    \`key\` VARCHAR(191) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    text MEDIUMTEXT NOT NULL,
    html MEDIUMTEXT NOT NULL,
    ref_id ${id},
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at BIGINT NOT NULL,
    last_error TEXT NOT NULL DEFAULT (''),
    created_at ${stamp} NOT NULL,
    sent_at ${stamp},
    UNIQUE KEY email_outbox_key (\`key\`),
    KEY email_outbox_queue (status, next_attempt_at),
    KEY email_outbox_created (created_at)
  )`,
];

/**
 * Migrasi 2: notifikasi banyak kanal. Antrean WhatsApp (bentuknya sama dengan `email_outbox`),
 * kotak masuk notifikasi di akun pelanggan, dan pilihan kanal per akun.
 */
export const schemaV2: string[] = [
  `CREATE TABLE whatsapp_outbox (
    id ${id} PRIMARY KEY,
    \`key\` VARCHAR(191) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    recipient VARCHAR(32) NOT NULL,
    text MEDIUMTEXT NOT NULL,
    ref_id ${id},
    provider VARCHAR(16) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at BIGINT NOT NULL,
    last_error TEXT NOT NULL DEFAULT (''),
    created_at ${stamp} NOT NULL,
    sent_at ${stamp},
    UNIQUE KEY whatsapp_outbox_key (\`key\`),
    KEY whatsapp_outbox_queue (status, next_attempt_at),
    KEY whatsapp_outbox_created (created_at)
  )`,
  `CREATE TABLE customer_notifications (
    id ${id} PRIMARY KEY,
    \`key\` VARCHAR(191) NOT NULL,
    account_id ${id} NOT NULL,
    kind VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    link VARCHAR(512) NOT NULL DEFAULT '',
    ref_id ${id},
    read_at ${stamp},
    created_at ${stamp} NOT NULL,
    UNIQUE KEY customer_notifications_key (\`key\`),
    KEY customer_notifications_inbox (account_id, created_at),
    CONSTRAINT customer_notifications_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
  )`,
  `ALTER TABLE customer_accounts ADD COLUMN notify_email TINYINT NOT NULL DEFAULT 1, ADD COLUMN notify_whatsapp TINYINT NOT NULL DEFAULT 1`,
];

/**
 * Migrasi 4: keanggotaan berbayar.
 *
 * - `membership_plans`: paket yang dijual (iuran, biaya daftar, masa berlaku, diskon member).
 *   Diskon disimpan dalam basis poin seperti pajak: 1000 = 10%.
 * - `memberships`: satu baris per member. Satu akun Google dan satu nomor HP hanya boleh punya satu
 *   keanggotaan yang belum dibatalkan; kolom turunan `open_account`/`open_phone` menjaganya.
 * - `membership_invoices`: tagihan pendaftaran dan perpanjangan, lunas sekali bayar, lewat kasir atau
 *   Midtrans. Periode keanggotaan baru ditentukan saat tagihan lunas (atau saat disetujui admin).
 * - `bookings` menyimpan salinan paket dan tarif diskon member saat dipesan, jadi mengubah paket
 *   tidak mengubah tagihan lama.
 */
export const schemaV4: string[] = [
  `CREATE TABLE membership_plans (
    id ${id} PRIMARY KEY,
    name VARCHAR(255) ${nocase} NOT NULL,
    description TEXT NOT NULL DEFAULT (''),
    price BIGINT NOT NULL CHECK(price > 0),
    registration_fee BIGINT NOT NULL DEFAULT 0 CHECK(registration_fee >= 0),
    duration_months INT NOT NULL CHECK(duration_months BETWEEN 1 AND 24),
    court_discount INT NOT NULL DEFAULT 0 CHECK(court_discount BETWEEN 0 AND 10000),
    addon_discount INT NOT NULL DEFAULT 0 CHECK(addon_discount BETWEEN 0 AND 10000),
    online TINYINT NOT NULL DEFAULT 1,
    active TINYINT NOT NULL DEFAULT 1,
    position INT NOT NULL,
    created_at ${stamp} NOT NULL,
    UNIQUE KEY membership_plans_name (name)
  )`,
  `CREATE TABLE memberships (
    id ${id} PRIMARY KEY,
    code VARCHAR(16) NOT NULL,
    plan_id ${id} NOT NULL,
    account_id ${id},
    customer_id ${id},
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL CHECK(status IN ('pending_payment','pending_approval','active','frozen','cancelled')),
    source VARCHAR(16) NOT NULL CHECK(source IN ('staff','online')),
    starts_on ${date},
    ends_on ${date},
    frozen_on ${date},
    notes TEXT NOT NULL DEFAULT (''),
    cancel_reason TEXT NOT NULL DEFAULT (''),
    cancelled_at ${stamp},
    refund_amount BIGINT NOT NULL DEFAULT 0 CHECK(refund_amount >= 0),
    created_by ${id},
    created_at ${stamp} NOT NULL,
    open_account ${id} GENERATED ALWAYS AS (IF(status <> 'cancelled', account_id, NULL)) STORED,
    open_phone VARCHAR(32) GENERATED ALWAYS AS (IF(status <> 'cancelled', phone, NULL)) STORED,
    CHECK ((status IN ('active','frozen')) = (starts_on IS NOT NULL AND ends_on IS NOT NULL) OR status = 'cancelled'),
    UNIQUE KEY memberships_code (code),
    UNIQUE KEY memberships_open_account (open_account),
    UNIQUE KEY memberships_open_phone (open_phone),
    KEY memberships_status (status, ends_on),
    KEY memberships_account (account_id),
    CONSTRAINT memberships_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id),
    CONSTRAINT memberships_account_fk FOREIGN KEY (account_id) REFERENCES customer_accounts(id),
    CONSTRAINT memberships_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`,
  `CREATE TABLE membership_invoices (
    id ${id} PRIMARY KEY,
    number VARCHAR(32) NOT NULL,
    membership_id ${id} NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('daftar','perpanjang')),
    plan_id ${id} NOT NULL,
    plan_name VARCHAR(255) NOT NULL,
    months INT NOT NULL CHECK(months BETWEEN 1 AND 24),
    dues BIGINT NOT NULL CHECK(dues > 0),
    registration_fee BIGINT NOT NULL DEFAULT 0 CHECK(registration_fee >= 0),
    tax BIGINT NOT NULL DEFAULT 0 CHECK(tax >= 0),
    tax_rate INT NOT NULL DEFAULT 0,
    tax_inclusive TINYINT NOT NULL DEFAULT 0,
    tax_label VARCHAR(64) NOT NULL DEFAULT '',
    amount BIGINT NOT NULL CHECK(amount > 0),
    status VARCHAR(16) NOT NULL CHECK(status IN ('pending','paid','cancelled')),
    method VARCHAR(16) CHECK(method IS NULL OR method IN ('cash','transfer','qris','va','ewallet','card')),
    fee BIGINT NOT NULL DEFAULT 0 CHECK(fee >= 0),
    paid_at ${stamp},
    period_start ${date},
    period_end ${date},
    order_id VARCHAR(100),
    snap_token VARCHAR(255),
    redirect_url TEXT,
    payment_type VARCHAR(64),
    transaction_id VARCHAR(128),
    expires_at BIGINT,
    created_by ${id},
    created_at ${stamp} NOT NULL,
    updated_at ${stamp} NOT NULL,
    CHECK ((status = 'paid') = (paid_at IS NOT NULL AND method IS NOT NULL)),
    UNIQUE KEY membership_invoices_number (number),
    UNIQUE KEY membership_invoices_order (order_id),
    KEY membership_invoices_member (membership_id, created_at),
    KEY membership_invoices_status (status, expires_at),
    CONSTRAINT membership_invoices_member_fk FOREIGN KEY (membership_id) REFERENCES memberships(id),
    CONSTRAINT membership_invoices_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id)
  )`,
  `ALTER TABLE bookings
    ADD COLUMN membership_id ${id} NULL,
    ADD COLUMN member_plan VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN member_court_rate INT NOT NULL DEFAULT 0 CHECK(member_court_rate BETWEEN 0 AND 10000),
    ADD COLUMN member_addon_rate INT NOT NULL DEFAULT 0 CHECK(member_addon_rate BETWEEN 0 AND 10000),
    ADD COLUMN member_discount BIGINT NOT NULL DEFAULT 0 CHECK(member_discount >= 0),
    ADD KEY bookings_membership (membership_id),
    ADD CONSTRAINT bookings_membership_fk FOREIGN KEY (membership_id) REFERENCES memberships(id)`,
];
/**
 * Versi 5: transaksi langsung di kasir tanpa booking lapangan (walk-in), mis. sewa raket untuk
 * latihan sendiri atau membeli bola dan minuman. Langsung dibayar lunas saat dicatat.
 * - Barang sewa memakai rentang jam `start_time`–`end_time` pada `date`, sama seperti booking,
 *   sehingga stok raket dihitung bersama booking lapangan. Unit kembali tersedia begitu ditandai kembali.
 * - Transaksi tidak pernah dihapus; pembatalan menandai `void` dan membuat jurnal balik.
 */
export const schemaV5: string[] = [
  `CREATE TABLE counter_sales (
    id ${id} PRIMARY KEY,
    number VARCHAR(32) NOT NULL,
    customer VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL DEFAULT '',
    date ${date} NOT NULL,
    start_time ${time} NOT NULL,
    end_time ${time} NOT NULL,
    subtotal BIGINT NOT NULL CHECK(subtotal >= 0),
    discount BIGINT NOT NULL DEFAULT 0 CHECK(discount >= 0),
    discount_note TEXT NOT NULL DEFAULT (''),
    tax BIGINT NOT NULL DEFAULT 0 CHECK(tax >= 0),
    tax_rate INT NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
    tax_inclusive TINYINT NOT NULL DEFAULT 0,
    tax_label VARCHAR(64) NOT NULL DEFAULT '',
    total BIGINT NOT NULL CHECK(total > 0),
    method VARCHAR(16) NOT NULL CHECK(method IN ('cash','transfer','qris','va','ewallet','card')),
    tendered BIGINT CHECK(tendered IS NULL OR tendered >= 0),
    status VARCHAR(16) NOT NULL CHECK(status IN ('paid','void')),
    notes TEXT NOT NULL DEFAULT (''),
    void_reason TEXT NOT NULL DEFAULT (''),
    voided_at ${stamp},
    voided_by ${id},
    created_by ${id} NOT NULL,
    created_at ${stamp} NOT NULL,
    UNIQUE KEY counter_sales_number (number),
    KEY counter_sales_date (date, start_time)
  )`,
  `CREATE TABLE counter_sale_lines (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id ${id} PRIMARY KEY,
    sale_id ${id} NOT NULL,
    addon_id ${id},
    name VARCHAR(255) NOT NULL,
    type VARCHAR(16) NOT NULL CHECK(type IN ('sewa','jual','layanan','lainnya')),
    pricing VARCHAR(16) NOT NULL CHECK(pricing IN ('per_booking','per_hour')),
    unit_price BIGINT NOT NULL CHECK(unit_price >= 0),
    quantity INT NOT NULL CHECK(quantity > 0),
    subtotal BIGINT NOT NULL CHECK(subtotal >= 0),
    returned_at ${stamp},
    created_at ${stamp} NOT NULL,
    KEY counter_sale_lines_sale (sale_id),
    KEY counter_sale_lines_addon (addon_id),
    CONSTRAINT counter_sale_lines_sale_fk FOREIGN KEY (sale_id) REFERENCES counter_sales(id),
    CONSTRAINT counter_sale_lines_addon_fk FOREIGN KEY (addon_id) REFERENCES addons(id)
  )`,
  `ALTER TABLE addon_stock_moves
    ADD COLUMN sale_id ${id} NULL,
    ADD CONSTRAINT addon_stock_moves_sale_fk FOREIGN KEY (sale_id) REFERENCES counter_sales(id)`,
];
/**
 * Versi 6: foto profil staf (pengguna panel admin) dan pelanggan. Satu foto per pemilik; id foto
 * selalu baru setiap kali diganti agar cache browser untuk foto lama tidak terpakai. Penunjuknya
 * disimpan di dokumen pengguna (`avatarId`) dan di kolom `customer_accounts.avatar_id`.
 */
export const schemaV6: string[] = [
  `CREATE TABLE avatars (
    id ${id} PRIMARY KEY,
    owner_type VARCHAR(16) NOT NULL CHECK(owner_type IN ('user','customer')),
    owner_id ${id} NOT NULL,
    mime VARCHAR(20) NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
    data MEDIUMBLOB NOT NULL,
    bytes INT NOT NULL CHECK(bytes > 0),
    created_at ${stamp} NOT NULL,
    UNIQUE KEY avatars_owner (owner_type, owner_id)
  )`,
  `ALTER TABLE customer_accounts ADD COLUMN avatar_id ${id} NULL`,
];
/**
 * Versi 7: transaksi kasir bisa dibayar lewat Midtrans (menunggu bayar sampai webhook masuk),
 * dikenali pelanggannya (`customer_id`), dan dihubungkan ke booking lapangan (`booking_id`).
 * Batasan status dan metode diganti di migrasi karena nama CHECK bawaan MySQL tidak tetap.
 */
export const schemaV7: string[] = [
  `ALTER TABLE counter_sales
    ADD COLUMN customer_id ${id} NULL,
    ADD COLUMN booking_id ${id} NULL,
    ADD COLUMN fee BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN paid_at ${stamp} NULL,
    ADD COLUMN pay_order_id VARCHAR(80) NULL,
    ADD COLUMN snap_token VARCHAR(255) NULL,
    ADD COLUMN pay_url TEXT NULL,
    ADD COLUMN pay_expires_at BIGINT NULL,
    ADD COLUMN payment_type VARCHAR(40) NULL,
    ADD COLUMN transaction_id VARCHAR(80) NULL,
    ADD UNIQUE KEY counter_sales_pay_order (pay_order_id),
    ADD KEY counter_sales_customer (customer_id),
    ADD KEY counter_sales_booking (booking_id),
    ADD CONSTRAINT counter_sales_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
    ADD CONSTRAINT counter_sales_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id)`,
  // Transaksi lama selalu lunas saat dicatat.
  "UPDATE counter_sales SET paid_at=created_at WHERE paid_at IS NULL",
];
/**
 * Versi 9: berkas merek (logo terang, logo gelap, favicon) untuk Pengaturan > Brand. Satu baris per
 * jenis; id acak berganti setiap kali berkas diganti sehingga browser boleh menyimpannya selamanya.
 * (Versi 8 dipakai fitur biaya admin Midtrans.)
 */
export const schemaV9: string[] = [
  `CREATE TABLE brand_assets (
    kind VARCHAR(16) PRIMARY KEY CHECK(kind IN ('logo','logo_dark','favicon')),
    id ${id} NOT NULL UNIQUE,
    mime VARCHAR(20) NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
    data MEDIUMBLOB NOT NULL,
    bytes INT NOT NULL CHECK(bytes > 0),
    created_at ${stamp} NOT NULL
  )`,
];
/** Akun sistem untuk keanggotaan: kode yang dicoba berurutan bila sudah dipakai, nama, jenis, subjenis, kunci, keterangan. */
export const membershipAccounts: [codes: string[], name: string, type: string, subtype: string, key: string, description: string][] = [
  [["4-500", "4-510", "4-520"], "Pendapatan Keanggotaan", "pendapatan", "pendapatan", "pendapatan_keanggotaan", "Biaya daftar dan iuran member yang sudah menjadi hak venue."],
  [["4-960", "4-961", "4-962"], "Potongan Member", "pendapatan", "pendapatan", "potongan_member", "Diskon harga member pada booking. Saldonya mengurangi pendapatan."],
  [["2-400", "2-410", "2-420"], "Pendapatan Diterima di Muka", "liabilitas", "utang", "pendapatan_dimuka", "Iuran member untuk bulan yang belum berjalan. Diakui sebagai pendapatan tiap bulan."],
];

/** Urutan tabel yang aman untuk diisi ulang (induk sebelum anak) saat impor atau pemulihan. */
export const tableOrder = [
  "users", "roles", "menus", "settings", "sessions", "audit_log", "customers", "otp_codes", "floors", "courts",
  "venue_features", "court_photos", "price_rules", "price_rule_courts", "maintenance", "customer_accounts", "avatars", "brand_assets",
  "membership_plans", "memberships", "membership_invoices", "orders",
  "bookings", "payments", "addons", "counter_sales", "counter_sale_lines", "booking_addons", "addon_stock_moves", "payment_intents", "accounts", "partners",
  "journal_entries", "journal_lines", "finance_records", "email_outbox", "whatsapp_outbox", "customer_notifications", "migrations",
];

type MenuSeed = [id: string, name: string, path: string, icon: string, group: string, order: number];
/** Menu admin bawaan, sesuai susunan terakhir di SQLite plus dua menu baru di grup Pengaturan. */
export const menuSeed: MenuSeed[] = [
  ["dashboard", "Ringkasan", "/admin", "LayoutDashboard", "Operasional", 1],
  ["bookings", "Booking", "/admin/bookings", "CalendarDays", "Operasional", 2],
  ["customers", "Pelanggan", "/admin/customers", "Contact", "Operasional", 3],
  ["members", "Member", "/admin/member", "BadgeCheck", "Operasional", 4],
  ["finance", "Ringkasan Keuangan", "/admin/keuangan", "ChartPie", "Keuangan", 51],
  ["finance-records", "Kas & Transaksi", "/admin/keuangan/transaksi", "ArrowLeftRight", "Keuangan", 52],
  ["finance-journal", "Jurnal Umum", "/admin/keuangan/jurnal", "BookOpenText", "Keuangan", 53],
  ["finance-reports", "Laporan", "/admin/keuangan/laporan", "FileChartColumn", "Keuangan", 54],
  ["courts", "Lapangan", "/admin/courts", "Activity", "Venue & Layanan", 101],
  ["addons", "Sewa & Tambahan", "/admin/addons", "ShoppingBag", "Venue & Layanan", 102],
  ["layout", "Denah Venue", "/admin/layout", "LayoutGrid", "Venue & Layanan", 103],
  ["info", "Info Venue", "/admin/info", "Store", "Venue & Layanan", 104],
  ["payments", "Pembayaran Online", "/admin/payments", "CreditCard", "Pengaturan", 201],
  ["finance-settings", "Pengaturan Keuangan", "/admin/keuangan/pengaturan", "SlidersHorizontal", "Pengaturan", 202],
  ["notifications", "Notifikasi", "/admin/notifications", "BellRing", "Pengaturan", 203],
  ["customer-login", "Login Pelanggan", "/admin/customer-login", "KeyRound", "Pengaturan", 204],
  ["users", "Pengguna", "/admin/users", "UsersRound", "Pengaturan", 205],
  ["roles", "Role & Akses", "/admin/roles", "ShieldCheck", "Pengaturan", 206],
  ["menus", "Menu Navigasi", "/admin/menus", "MenuSquare", "Pengaturan", 207],
  ["audit", "Log Aktivitas", "/admin/audit", "History", "Pengaturan", 208],
  ["backups", "Cadangan Data", "/admin/backups", "DatabaseBackup", "Pengaturan", 209],
  ["receipts", "Nota & Cetak", "/admin/nota", "Printer", "Pengaturan", 210],
  ["brand", "Brand", "/admin/brand", "Palette", "Pengaturan", 200],
  ["profile", "Profil Saya", "/admin/profile", "UserRound", "Akun", 301],
];
export const defaultMenus = (createdAt: string): AccessMenu[] =>
  menuSeed.map(([id, name, path, icon, group, order]) => ({ id, name, path, icon, group, order, active: true, createdAt }));
export const defaultRoles = (createdAt: string): AccessRole[] => [
  { id: "admin", name: "Super Admin", slug: "admin", description: "Akses penuh.", menuIds: menuSeed.map(([id]) => id), isSystem: true, createdAt },
  { id: "staff", name: "Operator", slug: "staff", description: "Operasional harian.", menuIds: ["dashboard", "bookings", "courts", "profile", "addons"], isSystem: true, createdAt },
];

/** Bagan akun bawaan: kode, nama, jenis, subjenis, akun kas, kunci sistem, keterangan. */
export const accountSeed: [string, string, string, string, number, string | null, string][] = [
  ["1-100", "Kas", "aset", "kas_bank", 1, "kas", "Uang tunai di laci kasir."],
  ["1-200", "Bank", "aset", "kas_bank", 1, "bank", "Saldo rekening bank venue, termasuk hasil pembayaran online."],
  ["1-300", "Piutang Usaha", "aset", "piutang", 0, "piutang", "Tagihan booking yang belum dibayar pelanggan."],
  ["1-350", "Piutang Lain-lain", "aset", "piutang", 0, "piutang_lain", "Tagihan di luar booking, misalnya sewa ruang untuk acara."],
  ["1-400", "Perlengkapan & Persediaan", "aset", "persediaan", 0, null, "Stok bola, minuman, dan barang lain yang belum terpakai."],
  ["1-500", "Peralatan & Inventaris", "aset", "aset_tetap", 0, null, "Raket, jaring, lampu, dan peralatan yang dipakai bertahun-tahun."],
  ["1-600", "Akumulasi Penyusutan", "aset", "aset_tetap", 0, null, "Pengurang nilai peralatan karena umur pakai. Saldonya negatif."],
  ["2-100", "Utang Usaha", "liabilitas", "utang", 0, "utang", "Tagihan pemasok yang belum dibayar."],
  ["2-200", "Utang Lain-lain", "liabilitas", "utang", 0, null, "Pinjaman dan kewajiban di luar pemasok."],
  ["3-100", "Modal Pemilik", "ekuitas", "modal", 0, "modal", "Uang yang disetor pemilik ke venue."],
  ["3-200", "Prive Pemilik", "ekuitas", "modal", 0, "prive", "Uang venue yang diambil pemilik untuk keperluan pribadi."],
  ["4-100", "Pendapatan Sewa Lapangan", "pendapatan", "pendapatan", 0, "pendapatan_lapangan", "Tarif jam main lapangan."],
  ["4-200", "Pendapatan Sewa Alat", "pendapatan", "pendapatan", 0, "pendapatan_sewa", "Sewa raket, sepatu, dan alat lain."],
  ["4-300", "Penjualan Barang", "pendapatan", "pendapatan", 0, "pendapatan_barang", "Bola, minuman, dan barang habis pakai."],
  ["4-400", "Pendapatan Jasa & Pelatih", "pendapatan", "pendapatan", 0, "pendapatan_jasa", "Jasa pelatih dan layanan lain."],
  ["4-900", "Pendapatan Lain-lain", "pendapatan", "pendapatan", 0, "pendapatan_lain", "Pemasukan di luar operasional harian."],
  ["5-100", "Gaji & Upah", "beban", "beban", 0, null, "Gaji staf, honor pelatih, dan lembur."],
  ["5-200", "Listrik, Air & Internet", "beban", "beban", 0, null, "Tagihan utilitas bulanan."],
  ["5-300", "Sewa Tempat", "beban", "beban", 0, null, "Sewa lahan atau bangunan venue."],
  ["5-400", "Perawatan Lapangan & Peralatan", "beban", "beban", 0, null, "Perbaikan karpet, jaring, lampu, dan servis alat."],
  ["5-500", "Perlengkapan & Bahan Habis Pakai", "beban", "beban", 0, null, "Bola, air minum, dan barang yang dibeli untuk dipakai."],
  ["5-600", "Pemasaran & Promosi", "beban", "beban", 0, null, "Iklan, endorse, cetak spanduk, dan turnamen."],
  ["5-700", "Kebersihan & Keamanan", "beban", "beban", 0, null, "Cleaning service, sampah, dan satpam."],
  ["5-800", "Biaya Bank & Payment Gateway", "beban", "beban", 0, "beban_gateway", "Potongan Midtrans, biaya transfer, dan admin bank."],
  ["5-900", "Beban Penyusutan", "beban", "beban", 0, null, "Penurunan nilai peralatan yang dicatat tiap periode."],
  ["5-950", "Beban Lain-lain", "beban", "beban", 0, null, "Pengeluaran yang tidak masuk kategori mana pun."],
  ["2-300", "Utang Pajak", "liabilitas", "utang", 0, "utang_pajak", "Pajak yang dipungut dari pelanggan dan belum disetor."],
  ["4-950", "Potongan Harga", "pendapatan", "pendapatan", 0, "potongan_harga", "Diskon yang diberikan pada booking. Saldonya mengurangi pendapatan."],
  ["4-800", "Pendapatan Pembatalan", "pendapatan", "pendapatan", 0, "pendapatan_pembatalan", "DP atau pembayaran booking batal yang ditahan sebagai denda."],
];

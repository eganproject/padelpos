export type AccountType = "aset" | "liabilitas" | "ekuitas" | "pendapatan" | "beban";
export type AccountSubtype = "kas_bank" | "piutang" | "persediaan" | "aset_tetap" | "utang" | "modal" | "pendapatan" | "beban";
export type EntrySource = "manual" | "catatan" | "pelunasan" | "transfer" | "modal" | "booking" | "pembayaran";
export type RecordKind = "pengeluaran" | "pemasukan";

export type Account = { id:string; code:string; name:string; type:AccountType; subtype:AccountSubtype; is_cash:number; system_key:string|null; description:string; active:number; position:number; created_at:string };
export type Partner = { id:string; name:string; kind:"pemasok"|"pelanggan"|"karyawan"|"lainnya"; phone:string; note:string; active:number; created_at:string };
export type FinanceSettings = { cash_accounts:Record<string,string>; default_cash_account:string; locked_until:string; updated_at:string };
export type Setup = { accounts:Account[]; partners:Partner[]; settings:FinanceSettings; date:string; time:string; timezone:string };
export type JournalLine = { id:string; account_id:string; account_code:string; account_name:string; debit:number; credit:number; memo:string; partner_id:string|null; partner_name:string|null; booking_id:string|null };
export type JournalEntry = { id:string; number:string; date:string; memo:string; source:EntrySource; ref_id:string|null; created_by:string|null; created_at:string; lines:JournalLine[] };
export type FinanceRecord = {
  id:string; number:string; kind:RecordKind; date:string; account_id:string; account_code:string; account_name:string;
  amount:number; settle:"tunai"|"tempo"; cash_account_id:string|null; cash_account_name:string|null;
  partner_id:string|null; partner_name:string|null; description:string; due_date:string|null;
  settled_at:string|null; entry_id:string|null; entry_number:string|null; photo_id:string|null; created_by:string|null; created_at:string;
};
export type ReportLine = { id:string; code:string; name:string; type?:AccountType; amount:number; previous?:number };
export type ProfitLoss = { from:string; to:string; previous:{from:string;to:string;income:number;expense:number;net:number}; income_lines:ReportLine[]; expense_lines:ReportLine[]; income:number; expense:number; net:number };
export type BalanceSheet = {
  as_of:string; assets:ReportLine[]; liabilities:ReportLine[]; equity:ReportLine[];
  asset_groups:{label:string;rows:ReportLine[]}[];
  total_assets:number; total_liabilities:number; total_equity:number; difference:number; receivable:number; advances:number;
};
export type LedgerRow = { entry_id:string; number:string; date:string; memo:string; source:EntrySource; debit:number; credit:number; line_memo:string; counter:string; balance:number };
export type GeneralLedger = { from:string; to:string; account:Account; opening:number; closing:number; rows:LedgerRow[]; debit:number; credit:number; truncated:boolean };
export type SubsidiaryRow = { key:string; name:string; subtitle:string; opening:number; debit:number; credit:number; balance:number; detail:{label:string;amount:number}[] };
export type SubsidiaryLedger = { kind:"piutang"|"utang"|"kas"; from:string; to:string; rows:SubsidiaryRow[]; total:number };
export type Overview = {
  date:string; time:string; timezone:string; from:string; to:string;
  income:number; expense:number; net:number; previous:{from:string;to:string;income:number;expense:number;net:number};
  cash:{id:string;name:string;balance:number}[]; cash_total:number;
  receivable:number; advances:number; payable:number;
  expense_lines:ReportLine[]; income_lines:ReportLine[];
  series:{month:string;income:number;expense:number}[];
  due:{id:string;number:string;kind:RecordKind;date:string;amount:number;due_date:string|null;partner_name:string;account_name:string}[];
  entries:JournalEntry[];
};

export const typeLabel:Record<AccountType,string> = { aset:"Harta", liabilitas:"Kewajiban", ekuitas:"Modal", pendapatan:"Pendapatan", beban:"Biaya" };
export const subtypeLabel:Record<AccountSubtype,string> = {
  kas_bank:"Kas & bank", piutang:"Piutang", persediaan:"Persediaan", aset_tetap:"Peralatan & inventaris",
  utang:"Utang", modal:"Modal pemilik", pendapatan:"Pendapatan", beban:"Biaya",
};
export const sourceLabel:Record<EntrySource,string> = {
  manual:"Jurnal manual", catatan:"Catatan keuangan", pelunasan:"Pelunasan", transfer:"Pindah dana",
  modal:"Modal pemilik", booking:"Booking", pembayaran:"Pembayaran",
};
export const partnerKindLabel:Record<Partner["kind"],string> = { pemasok:"Pemasok", pelanggan:"Pelanggan", karyawan:"Karyawan", lainnya:"Lainnya" };
export const methodLabels:{key:string;label:string}[] = [
  { key:"cash", label:"Tunai di kasir" }, { key:"transfer", label:"Transfer bank" }, { key:"qris", label:"QRIS" },
  { key:"va", label:"Virtual account" }, { key:"ewallet", label:"Dompet digital" }, { key:"card", label:"Kartu kredit/debit" },
];
/** Akun kas pilihan awal: yang diminta bila masih aktif, kalau tidak akun kas aktif pertama. */
export const usableCash = (setup:Setup, preferred?:string|null) => {
  const cash = setup.accounts.filter(account => account.is_cash && account.active);
  return cash.some(account => account.id===preferred) ? preferred! : cash[0]?.id ?? "";
};
/** Kelompok akun yang boleh dipakai sebagai kategori pada formulir catatan. */
export const categoryTypes:Record<RecordKind,AccountType[]> = { pengeluaran:["beban","aset","liabilitas"], pemasukan:["pendapatan","aset","liabilitas"] };
export const categoryGroupLabel:Record<RecordKind,Record<string,string>> = {
  pengeluaran:{ beban:"Biaya operasional", aset:"Beli barang atau peralatan", liabilitas:"Kewajiban" },
  pemasukan:{ pendapatan:"Pendapatan", aset:"Jual barang atau peralatan", liabilitas:"Kewajiban" },
};
export const isCategory = (account:Account, kind:RecordKind) =>
  account.active===1 && !account.is_cash && !["piutang","piutang_lain","utang"].includes(account.system_key??"") && categoryTypes[kind].includes(account.type);

export const money = (value:number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
/** Angka ringkas untuk kartu dan grafik: 1.250.000 menjadi "1,25 jt". */
export function moneyShort(value:number){
  const sign = value<0?"-":"";
  const size = Math.abs(value);
  if(size>=1_000_000_000) return `${sign}Rp${(size/1_000_000_000).toLocaleString("id-ID",{maximumFractionDigits:2})} M`;
  if(size>=1_000_000) return `${sign}Rp${(size/1_000_000).toLocaleString("id-ID",{maximumFractionDigits:2})} jt`;
  if(size>=1_000) return `${sign}Rp${(size/1_000).toLocaleString("id-ID",{maximumFractionDigits:0})} rb`;
  return `${sign}Rp${size.toLocaleString("id-ID")}`;
}
export const formatDate = (value:string) => value ? new Date(value+"T12:00:00Z").toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "—";
export const formatDateShort = (value:string) => value ? new Date(value+"T12:00:00Z").toLocaleDateString("id-ID",{day:"numeric",month:"short"}) : "—";
export const formatMonth = (value:string) => new Date(value+"-01T12:00:00Z").toLocaleDateString("id-ID",{month:"short",year:"2-digit"});

export const shiftDay = (date:string, days:number) => { const value=new Date(date+"T12:00:00Z"); value.setUTCDate(value.getUTCDate()+days); return value.toISOString().slice(0,10) };
export const shiftMonth = (date:string, months:number) => { const value=new Date(date.slice(0,7)+"-01T12:00:00Z"); value.setUTCMonth(value.getUTCMonth()+months); return value.toISOString().slice(0,10) };
export const monthStart = (date:string) => date.slice(0,7)+"-01";
export const monthEnd = (date:string) => shiftDay(shiftMonth(date,1),-1);
/** Rentang siap pakai untuk pemilih periode. */
export function presetRange(preset:string, today:string){
  if(preset==="bulan-lalu"){ const previous=shiftMonth(today,-1); return {from:monthStart(previous),to:monthEnd(previous)} }
  if(preset==="30-hari") return {from:shiftDay(today,-29),to:today};
  if(preset==="tahun-ini") return {from:today.slice(0,4)+"-01-01",to:today};
  return {from:monthStart(today),to:today};
}
export const rangeLabel = (from:string,to:string) => from===to?formatDate(from):`${formatDate(from)} – ${formatDate(to)}`;
/** Selisih terhadap periode sebelumnya, dalam persen. Null bila pembandingnya nol. */
export const changeOf = (current:number, previous:number) => previous===0 ? null : Math.round((current-previous)/Math.abs(previous)*100);

/** Unduh tabel laporan sebagai CSV yang langsung terbaca di Excel. */
export function downloadCsv(filename:string, rows:(string|number)[][]){
  const escape = (cell:string|number) => typeof cell==="number" ? String(cell) : `"${cell.replace(/"/g,'""')}"`;
  const body = rows.map(row=>row.map(escape).join(";")).join("\r\n");
  const blob = new Blob(["﻿"+body],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href=url; link.download=filename; document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

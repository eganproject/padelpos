/**
 * Hitungan tagihan yang sama dengan API (apps/api/src/bill.ts): subtotal dikurangi potongan, lalu pajak.
 * `tax_rate` dalam basis poin (1000 = 10%). Pajak "sudah termasuk" tidak menambah total.
 */
export type TaxSnapshot = { tax_rate:number; tax_inclusive:number; tax_label:string };
export function billOf(subtotal:number, discount:number, tax?:Pick<TaxSnapshot,"tax_rate"|"tax_inclusive">|null){
  const base = Math.max(0, subtotal-discount), rate = tax?.tax_rate ?? 0;
  if (!rate) return { tax:0, total:base };
  if (tax!.tax_inclusive) return { tax:Math.round(base*rate/(10000+rate)), total:base };
  const amount = Math.round(base*rate/10000);
  return { tax:amount, total:base+amount };
}
/** "PB1 10%" atau "PPN 11% (termasuk)". */
export const taxName = (tax:TaxSnapshot) => `${tax.tax_label||"Pajak"} ${(tax.tax_rate/100).toLocaleString("id-ID")}%${tax.tax_inclusive?" (sudah termasuk)":""}`;

import type { TaxSnapshot } from "./bill";
export type Court={id:string;name:string;hourly_rate:number;opens_at:string;closes_at:string;active:number;description:string;environment:""|"indoor"|"outdoor";surface:string;floor_id?:string|null;photos?:string[];state?:string;until?:string|null};
export type BookingStatus="pending"|"confirmed"|"completed"|"cancelled"|"expired";
export type Booking={id:string;court_id:string;court_name:string;customer:string;phone:string;email?:string;reschedule_count?:number;date:string;start_time:string;end_time:string;total:number;paid:number;status:BookingStatus;notes:string;cancel_reason:string;
  /** Porsi sewa lapangan; selisih dengan `total` adalah sewa & tambahan. */
  court_total:number;addon_count:number;
  /** Sudah termasuk dalam `total`. `tax_rate` dalam basis poin (1000 = 10%). */
  discount:number;discount_note:string;tax:number;tax_rate:number;tax_inclusive:number;tax_label:string;
  /** Pembayaran booking batal yang ditahan sebagai denda. */
  forfeited:number;forfeited_at:string|null;
  /** Salinan tarif member saat dipesan; `member_discount` sudah termasuk dalam `total`. Tarif dalam basis poin. */
  membership_id?:string|null;member_plan?:string;member_court_rate?:number;member_addon_rate?:number;member_discount?:number};
export type Payment={id:string;amount:number;kind:"payment"|"refund";method:string;note:string;created_at:string};
export type Maintenance={id:string;court_id:string;court_name:string;date:string;start_time:string;end_time:string;reason:string};
export type PriceRule={id:string;label:string;days:number[];start_time:string;end_time:string;hourly_rate:number;court_ids:string[]};
export type Context={courts:Court[];maintenance:Maintenance[];price_rules:PriceRule[];schedule:{id:string;court_id:string;start_time:string;end_time:string}[];date:string;time:string;timezone:string;tax?:TaxSnapshot};
export const statusLabel:Record<BookingStatus,string>={pending:"Menunggu bayar",confirmed:"Dikonfirmasi",completed:"Selesai",cancelled:"Dibatalkan",expired:"Kedaluwarsa"};
/** Kelas warna untuk `.status-pill`. */
export const statusTone:Record<BookingStatus,string>={pending:"wait",confirmed:"on",completed:"done",cancelled:"off",expired:"off"};
export const minute=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function timeSlots(start=0,end=1440){return Array.from({length:Math.max(0,(end-start)/30+1)},(_,i)=>{const value=start+i*30;return `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`})}

/** Indeks mengikuti Date#getDay: 0 = Minggu. Urutan tampil dimulai dari Senin. */
export const dayShort=["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
export const weekOrder=[1,2,3,4,5,6,0];
export function formatDays(days:number[]){
  const set=new Set(days);
  if(set.size===7)return "Setiap hari";
  if(set.size===5&&[1,2,3,4,5].every(d=>set.has(d)))return "Senin–Jumat";
  if(set.size===2&&set.has(0)&&set.has(6))return "Sabtu & Minggu";
  const runs:number[][]=[];
  for(const day of weekOrder){
    if(!set.has(day))continue;
    const last=runs[runs.length-1];
    if(last&&weekOrder.indexOf(last[last.length-1])===weekOrder.indexOf(day)-1)last.push(day);else runs.push([day]);
  }
  return runs.map(run=>run.length>=3?`${dayShort[run[0]]}–${dayShort[run[run.length-1]]}`:run.map(d=>dayShort[d]).join(", ")).join(", ");
}
/** Perkiraan total sewa dengan aturan yang sama seperti server (apps/api/src/operations.ts#quote). */
export function quote(court:Pick<Court,"id"|"hourly_rate">,rules:PriceRule[],date:string,start:string,end:string){
  const day=new Date(date+"T12:00:00Z").getUTCDay();let sum=0;
  for(let value=minute(start);value<minute(end);value+=30){
    const at=timeSlots(value,value)[0];
    sum+=rules.find(r=>r.court_ids.includes(court.id)&&r.days.includes(day)&&r.start_time<=at&&r.end_time>at)?.hourly_rate??court.hourly_rate;
  }
  return Math.round(sum/2);
}

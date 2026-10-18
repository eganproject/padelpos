import { venueTimezone } from "./config.js";

/** Tanggal dan jam saat ini menurut zona waktu venue. */
// Membuat Intl.DateTimeFormat itu mahal, padahal fungsi ini dipanggil untuk setiap pembayaran di laporan.
const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:venueTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
export function localClock(value:Date=new Date()){
  const parts=formatter.formatToParts(value);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`,timezone:venueTimezone};
}
export const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export const clockLabel=(value:number)=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
/** Tanggal `YYYY-MM-DD` digeser sejumlah hari. */
export function shiftDate(date:string,days:number){const value=new Date(date+"T12:00:00Z");value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}
/**
 * Tanggal `YYYY-MM-DD` digeser sejumlah bulan. Tanggal yang tidak ada di bulan tujuan dipotong ke
 * akhir bulan: 31 Januari + 1 bulan = 28 (atau 29) Februari.
 */
export function shiftMonths(date:string,months:number){
  const [year,month,day]=date.split("-").map(Number);
  const target=new Date(Date.UTC(year,month-1+months,1));
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(day,last));
  return target.toISOString().slice(0,10);
}
/** Selisih hari kalender dari `from` ke `to` (negatif bila `to` lebih awal). */
export const daysBetween=(from:string,to:string)=>Math.round((Date.parse(to+"T12:00:00Z")-Date.parse(from+"T12:00:00Z"))/86400000);

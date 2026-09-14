import { venueTimezone } from "./config.js";

/** Tanggal dan jam saat ini menurut zona waktu venue. */
export function localClock(value:Date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:venueTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return {date:`${part("year")}-${part("month")}-${part("day")}`,time:`${part("hour")}:${part("minute")}`,timezone:venueTimezone};
}
export const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export const clockLabel=(value:number)=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;

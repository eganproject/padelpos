export type Court={id:string;name:string;hourly_rate:number;opens_at:string;closes_at:string;active:number;state?:string;until?:string|null};
export type Booking={id:string;court_id:string;court_name:string;customer:string;phone:string;date:string;start_time:string;end_time:string;total:number;paid:number;status:"confirmed"|"completed"|"cancelled";notes:string;cancel_reason:string};
export type Payment={id:string;amount:number;kind:"payment"|"refund";method:string;note:string;created_at:string};
export type Maintenance={id:string;court_id:string;court_name:string;date:string;start_time:string;end_time:string;reason:string};
export type Context={courts:Court[];maintenance:Maintenance[];schedule:{id:string;court_id:string;start_time:string;end_time:string}[];date:string;time:string;timezone:string};
export const statusLabel={confirmed:"Dikonfirmasi",completed:"Selesai",cancelled:"Dibatalkan"};
export const minute=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function timeSlots(start=0,end=1440){return Array.from({length:Math.max(0,(end-start)/30+1)},(_,i)=>{const value=start+i*30;return `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`})}


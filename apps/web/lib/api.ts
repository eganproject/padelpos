export interface User {id:string;name:string;email:string;phone:string;role:string;createdAt:string;avatarId?:string;twoFactorEnabled?:boolean}
export class ApiError extends Error {constructor(message:string,public status:number){super(message)}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api${path}`,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...options.headers}});
  if(response.status===204)return undefined as T;
  const data=await response.json().catch(()=>({message:"Respons server tidak valid."}));
  if(!response.ok)throw new ApiError(data.message||"Terjadi kesalahan.",response.status);
  return data as T;
}
export function saveSession(user:User){
  localStorage.setItem("padelix_user",JSON.stringify(user));
  window.dispatchEvent(new Event("padelix:user-changed"));
}
export function forgetSession(){localStorage.removeItem("padelix_token");localStorage.removeItem("padelix_user")}
export async function clearSession(){await api("/auth/logout",{method:"POST",body:"{}"});forgetSession()}
export const money=(value:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);


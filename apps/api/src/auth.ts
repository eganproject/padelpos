import { randomBytes, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { production } from "./config.js";
import { db, getMenus, getRoles, getUsers } from "./store.js";
export interface AuthRequest extends Request { auth?: { sub:string; email:string; role:string } }
const cookieName = "padelix_session";
/**
 * Pelanggan memakai cookie sendiri: staf yang juga memesan sebagai pelanggan di browser
 * yang sama tidak saling menimpa sesi. Sesi pelanggan lebih panjang karena hanya membuka
 * data pesanannya sendiri, bukan panel operasional.
 */
const customerCookie = "padelix_customer";
const staffTtl = 8*3600000, customerTtl = 30*24*3600000;
const hash = (token:string) => createHash("sha256").update(token).digest("hex");
const cookieOptions = { httpOnly:true, secure:production, sameSite:"lax" as const, path:"/" };
function readCookie(req:Request, name:string) { return req.headers.cookie?.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1); }
const sessionId = (req:Request) => readCookie(req, cookieName);
async function openSession(res:Response, name:string, subjectId:string, subjectType:"staff"|"customer", ttl:number) {
  const token = randomBytes(32).toString("hex");
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,?,?)").run(hash(token),subjectId,subjectType,Date.now()+ttl);
  res.cookie(name,token,{...cookieOptions,maxAge:ttl});
}
export async function createSession(res:Response, subjectId:string) { await openSession(res, cookieName, subjectId, "staff", staffTtl); }
export async function endSession(req:Request,res:Response) {
  const token = sessionId(req);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").run(hash(token));
  res.clearCookie(cookieName,cookieOptions);
}
export async function createCustomerSession(res:Response, accountId:string) { await openSession(res, customerCookie, accountId, "customer", customerTtl); }
/** Id akun pelanggan dari cookie, atau null bila belum masuk atau sesinya habis. */
export async function customerAccountId(req:Request) {
  const token = readCookie(req, customerCookie);
  if (!token) return null;
  const row = await db.prepare("SELECT subject_id FROM sessions WHERE id = ? AND subject_type = 'customer' AND expires_at > ?").get(hash(token),Date.now()) as {subject_id:string}|undefined;
  return row?.subject_id ?? null;
}
export async function endCustomerSession(req:Request,res:Response) {
  const token = readCookie(req, customerCookie);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ? AND subject_type = 'customer'").run(hash(token));
  res.clearCookie(customerCookie,cookieOptions);
}
export async function revokeCustomerSessions(accountId:string) { await db.prepare("DELETE FROM sessions WHERE subject_id = ? AND subject_type = 'customer'").run(accountId); }
export async function revokeSessions(userId:string) { await db.prepare("DELETE FROM sessions WHERE subject_id = ? AND subject_type = 'staff'").run(userId); }
export async function requireAuth(req:AuthRequest,res:Response,next:NextFunction) {
  const token = sessionId(req);
  const session = (token ? await db.prepare("SELECT subject_id FROM sessions WHERE id = ? AND subject_type = 'staff' AND expires_at > ?").get(hash(token),Date.now()) : undefined) as {subject_id:string}|undefined;
  const user = session && (await getUsers()).find(u=>u.id===session.subject_id);
  if (!user) { res.status(401).json({message:"Sesi berakhir. Silakan masuk kembali."}); return; }
  req.auth = {sub:user.id,email:user.email,role:user.role}; next();
}
export async function requireAdmin(req:AuthRequest,res:Response,next:NextFunction) {
  await requireAuth(req,res,()=>{
    if(req.auth?.role!=="admin") { res.status(403).json({message:"Hanya admin yang dapat mengubah pengguna dan hak akses."}); return; }
    next();
  });
}
export function requireAnyMenu(ids:string[]) {
  return async (req:AuthRequest,res:Response,next:NextFunction)=>{
    let allowed=false;
    await requireAuth(req,res,()=>{allowed=true});
    if(!allowed)return;
    const role=(await getRoles()).find(r=>r.slug===req.auth!.role);
    const active=(await getMenus()).filter(m=>m.active).map(m=>m.id);
    if(!role || !ids.some(id=>active.includes(id)&&role.menuIds.includes(id))) { res.status(403).json({message:"Anda tidak memiliki akses ke fitur ini."}); return; }
    next();
  };
}
export const requireMenu=(id:string)=>requireAnyMenu([id]);

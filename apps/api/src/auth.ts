import { randomBytes, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { production } from "./config.js";
import { db, getMenus, getRoles, getUsers } from "./store.js";
export interface AuthRequest extends Request { auth?: { sub:string; email:string; role:string } }
const cookieName = "padelix_session";
const hash = (token:string) => createHash("sha256").update(token).digest("hex");
const cookieOptions = { httpOnly:true, secure:production, sameSite:"lax" as const, path:"/" };
function sessionId(req:Request) { return req.headers.cookie?.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1); }
export function createSession(res:Response, subjectId:string, subjectType:"staff"|"customer"="staff") {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(hash(token),subjectId,subjectType,Date.now()+8*3600000);
  res.cookie(cookieName,token,{...cookieOptions,maxAge:8*3600000});
}
export function endSession(req:Request,res:Response) {
  const token = sessionId(req);
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(hash(token));
  res.clearCookie(cookieName,cookieOptions);
}
export function revokeSessions(userId:string) { db.prepare("DELETE FROM sessions WHERE subject_id = ? AND subject_type = 'staff'").run(userId); }
export function requireAuth(req:AuthRequest,res:Response,next:NextFunction) {
  const token = sessionId(req);
  const session = (token ? db.prepare("SELECT subject_id FROM sessions WHERE id = ? AND subject_type = 'staff' AND expires_at > ?").get(hash(token),Date.now()) : undefined) as {subject_id:string}|undefined;
  const user = session && getUsers().find(u=>u.id===session.subject_id);
  if (!user) return res.status(401).json({message:"Sesi berakhir. Silakan masuk kembali."});
  req.auth = {sub:user.id,email:user.email,role:user.role}; next();
}
export function requireAdmin(req:AuthRequest,res:Response,next:NextFunction) {
  requireAuth(req,res,()=>{
    if(req.auth?.role!=="admin") return res.status(403).json({message:"Hanya admin yang dapat mengubah pengguna dan hak akses."});
    next();
  });
}
export function requireAnyMenu(ids:string[]) {
  return (req:AuthRequest,res:Response,next:NextFunction)=>requireAuth(req,res,()=>{
    const role=getRoles().find(r=>r.slug===req.auth!.role);
    const active=getMenus().filter(m=>m.active).map(m=>m.id);
    if(!role || !ids.some(id=>active.includes(id)&&role.menuIds.includes(id))) return res.status(403).json({message:"Anda tidak memiliki akses ke fitur ini."});
    next();
  });
}
export const requireMenu=(id:string)=>requireAnyMenu([id]);


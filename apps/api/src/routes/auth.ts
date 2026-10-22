import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession,endSession,requireAuth,type AuthRequest } from "../auth.js";
import { production } from "../config.js";
import { contactPhoneSchema } from "../operations.js";
import { getMenus,getRoles,getUsers,saveUsers,transaction } from "../store.js";
import type { User } from "../types.js";
import { readTicket,signTicket } from "../secrets.js";
import { useSecondFactor } from "../two-factor.js";
import { checkReset,completeReset,recoveryOptions,requestReset } from "../password-reset.js";
export const publicUser=({passwordHash:_,twoFactor,pendingTwoFactor:__,...user}:User)=>({...user,twoFactorEnabled:!!twoFactor});
/** Tiket login 2 langkah: berlaku 5 menit dan gugur bila password berubah sementara itu. */
const passwordMark=(user:User)=>createHash("sha256").update(user.passwordHash).digest("hex").slice(0,16);
export const passwordSchema=z.string().min(8,"Password minimal 8 karakter.").max(72,"Password maksimal 72 karakter.").regex(/[A-Z]/,"Password harus memuat huruf kapital.").regex(/[0-9]/,"Password harus memuat angka.");
/** Nama staf; pesan galatnya dibaca langsung di formulir admin. */
export const staffName=z.string().trim().min(3,"Nama minimal 3 karakter.").max(60,"Nama maksimal 60 karakter.");
const router=Router();
router.get("/setup",async (_req,res)=>res.json({available:(await getUsers()).length===0,requiresToken:production||!!process.env.BOOTSTRAP_TOKEN}));
router.post("/register",async(req,res)=>{
  if((await getUsers()).length) return res.status(403).json({message:"Pendaftaran publik ditutup. Minta admin membuat akun Anda."});
  if(production||process.env.BOOTSTRAP_TOKEN){
    const expected=Buffer.from(process.env.BOOTSTRAP_TOKEN||"");
    const provided=Buffer.from(typeof req.body.bootstrapToken==="string"?req.body.bootstrapToken:"");
    if(!expected.length||expected.length!==provided.length||!timingSafeEqual(expected,provided)) return res.status(403).json({message:"Token penyiapan admin tidak sesuai."});
  }
  const parsed=z.object({name:z.string().trim().min(3).max(60),email:z.email().toLowerCase(),phone:contactPhoneSchema,password:passwordSchema}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:"Lengkapi data. Password 8–72 karakter dengan huruf kapital dan angka."});
  const {password,...data}=parsed.data;
  const passwordHash=await bcrypt.hash(password,12);
  const user=await transaction(async ()=>{
    if((await getUsers()).length) return null;
    const user:User={id:randomUUID(),...data,passwordHash,role:"admin",createdAt:new Date().toISOString()};
    await saveUsers([user]);return user;
  });
  if(!user) return res.status(409).json({message:"Admin pertama sudah dibuat. Silakan masuk."});
  await createSession(res,user.id);res.status(201).json({user:publicUser(user)});
});
router.post("/login",async(req,res)=>{
  const parsed=z.object({email:z.email().toLowerCase(),password:z.string().min(1).max(72)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:"Email atau password tidak valid."});
  const user=(await getUsers()).find(u=>u.email.toLowerCase()===parsed.data.email);
  if(!user||!await bcrypt.compare(parsed.data.password,user.passwordHash)) return res.status(401).json({message:"Email atau password tidak sesuai."});
  const current=(await getUsers()).find(u=>u.id===user.id&&u.passwordHash===user.passwordHash);
  if(!current) return res.status(401).json({message:"Akun berubah. Silakan masuk kembali."});
  if(current.twoFactor) return res.json({twoFactor:true,ticket:signTicket({u:current.id,h:passwordMark(current)},5*60000)});
  await createSession(res,current.id);res.json({user:publicUser(current)});
});
/** Langkah kedua login: kode authenticator atau kode cadangan. */
router.post("/login/2fa",async(req,res)=>{
  const parsed=z.object({ticket:z.string().max(1000),code:z.string().trim().min(6).max(20)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:"Masukkan kode 6 angka dari aplikasi authenticator."});
  const ticket=readTicket<{u:string;h:string}>(parsed.data.ticket);
  const user=ticket&&(await getUsers()).find(u=>u.id===ticket.u);
  if(!ticket||!user||passwordMark(user)!==ticket.h||!user.twoFactor) return res.status(401).json({message:"Waktu verifikasi habis. Masukkan email dan password lagi.",expired:true});
  const used=await useSecondFactor(user.id,parsed.data.code);
  if(!used) return res.status(401).json({message:"Kode tidak cocok. Coba kode terbaru dari aplikasi."});
  await createSession(res,user.id);
  const left=used==="recovery"?(await getUsers()).find(u=>u.id===user.id)?.twoFactor?.recovery.length??0:null;
  res.json({user:publicUser(user),recoveryLeft:left});
});
router.get("/recovery",async(_req,res)=>res.json(await recoveryOptions()));
router.post("/forgot",async(req,res)=>res.json(await requestReset(req.body)));
router.get("/reset",async(req,res)=>res.json(await checkReset(req.query)));
router.post("/reset",async(req,res)=>res.json(await completeReset(req.body)));
router.post("/logout",async (req,res)=>{await endSession(req,res);res.status(204).send()});
router.get("/me",requireAuth,async (req:AuthRequest,res)=>res.json({user:publicUser((await getUsers()).find(u=>u.id===req.auth!.sub)!)}));
router.get("/navigation",requireAuth,async (req:AuthRequest,res)=>{
  const role=(await getRoles()).find(r=>r.slug===req.auth!.role);
  if(!role) return res.status(403).json({message:"Role tidak tersedia."});
  res.json({menus:(await getMenus()).filter(m=>m.active&&role.menuIds.includes(m.id)).sort((a,b)=>a.order-b.order),role:{name:role.name,slug:role.slug}});
});
export default router;


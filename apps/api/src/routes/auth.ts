import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession,endSession,requireAuth,type AuthRequest } from "../auth.js";
import { production } from "../config.js";
import { getMenus,getRoles,getUsers,saveUsers,transaction } from "../store.js";
import type { User } from "../types.js";
export const publicUser=({passwordHash:_,...user}:User)=>user;
export const passwordSchema=z.string().min(8,"Password minimal 8 karakter.").max(72,"Password maksimal 72 karakter.").regex(/[A-Z]/,"Password harus memuat huruf kapital.").regex(/[0-9]/,"Password harus memuat angka.");
/** Nama dan telepon staf; pesan galat dibaca langsung di formulir admin. */
export const staffName=z.string().trim().min(3,"Nama minimal 3 karakter.").max(60,"Nama maksimal 60 karakter.");
export const staffPhone=z.string().trim().min(9,"Nomor telepon minimal 9 digit.").max(18,"Nomor telepon maksimal 18 karakter.");
const router=Router();
router.get("/setup",(_req,res)=>res.json({available:getUsers().length===0,requiresToken:production||!!process.env.BOOTSTRAP_TOKEN}));
router.post("/register",async(req,res)=>{
  if(getUsers().length) return res.status(403).json({message:"Pendaftaran publik ditutup. Minta admin membuat akun Anda."});
  if(production||process.env.BOOTSTRAP_TOKEN){
    const expected=Buffer.from(process.env.BOOTSTRAP_TOKEN||"");
    const provided=Buffer.from(typeof req.body.bootstrapToken==="string"?req.body.bootstrapToken:"");
    if(!expected.length||expected.length!==provided.length||!timingSafeEqual(expected,provided)) return res.status(403).json({message:"Token penyiapan admin tidak sesuai."});
  }
  const parsed=z.object({name:z.string().trim().min(3).max(60),email:z.email().toLowerCase(),phone:z.string().trim().min(9).max(18),password:passwordSchema}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:"Lengkapi data. Password 8–72 karakter dengan huruf kapital dan angka."});
  const {password,...data}=parsed.data;
  const passwordHash=await bcrypt.hash(password,12);
  const user=transaction(()=>{
    if(getUsers().length) return null;
    const user:User={id:randomUUID(),...data,passwordHash,role:"admin",createdAt:new Date().toISOString()};
    saveUsers([user]);return user;
  });
  if(!user) return res.status(409).json({message:"Admin pertama sudah dibuat. Silakan masuk."});
  createSession(res,user.id);res.status(201).json({user:publicUser(user)});
});
router.post("/login",async(req,res)=>{
  const parsed=z.object({email:z.email().toLowerCase(),password:z.string().min(1).max(72)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:"Email atau password tidak valid."});
  const user=getUsers().find(u=>u.email.toLowerCase()===parsed.data.email);
  if(!user||!await bcrypt.compare(parsed.data.password,user.passwordHash)) return res.status(401).json({message:"Email atau password tidak sesuai."});
  const current=getUsers().find(u=>u.id===user.id&&u.passwordHash===user.passwordHash);
  if(!current) return res.status(401).json({message:"Akun berubah. Silakan masuk kembali."});
  createSession(res,current.id);res.json({user:publicUser(current)});
});
router.post("/logout",(req,res)=>{endSession(req,res);res.status(204).send()});
router.get("/me",requireAuth,(req:AuthRequest,res)=>res.json({user:publicUser(getUsers().find(u=>u.id===req.auth!.sub)!)}));
router.get("/navigation",requireAuth,(req:AuthRequest,res)=>{
  const role=getRoles().find(r=>r.slug===req.auth!.role);
  if(!role) return res.status(403).json({message:"Role tidak tersedia."});
  res.json({menus:getMenus().filter(m=>m.active&&role.menuIds.includes(m.id)).sort((a,b)=>a.order-b.order),role:{name:role.name,slug:role.slug}});
});
export default router;


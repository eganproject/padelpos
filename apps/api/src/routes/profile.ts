import express, { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession,requireAuth,revokeSessions,type AuthRequest } from "../auth.js";
import { getUsers,saveUsers,transaction,audit } from "../store.js";
import { check } from "../errors.js";
import { passwordSchema,publicUser,staffName } from "./auth.js";
import { contactPhoneSchema } from "../operations.js";
import { maxAvatarSize,removeUserAvatar,setUserAvatar } from "../avatars.js";
import { photoTypes } from "../photos.js";
import { limiter } from "../ratelimit.js";
import { markStaffRead,staffInbox,staffUnread } from "../staff-alerts.js";
import { confirmSetup,disable as disableTwoFactor,regenerateRecovery,startSetup,twoFactorStatus } from "../two-factor.js";
const router=Router();router.use(requireAuth);
router.put("/",async (req:AuthRequest,res)=>{
  const data=z.object({name:staffName,phone:contactPhoneSchema}).parse(req.body);
  const user=await transaction(async ()=>{
    const users=await getUsers(),index=users.findIndex(u=>u.id===req.auth!.sub);check(index>=0,404,"Pengguna tidak ditemukan.");
    users[index]={...users[index],...data};await saveUsers(users);return users[index];
  });res.json({user:publicUser(user)});
});
const avatarLimit=limiter(15*60*1000,30,"Terlalu sering mengganti foto. Coba lagi dalam 15 menit.");
router.post("/avatar",avatarLimit,express.raw({type:[...photoTypes],limit:maxAvatarSize}),async (req:AuthRequest,res)=>res.json({user:publicUser(await setUserAvatar(req.auth!.sub,req.get("content-type"),req.body))}));
router.delete("/avatar",avatarLimit,async (req:AuthRequest,res)=>res.json({user:publicUser(await removeUserAvatar(req.auth!.sub))}));
router.put("/password",async(req:AuthRequest,res)=>{
  const data=z.object({currentPassword:z.string().min(1,"Isi password saat ini.").max(72),newPassword:passwordSchema}).parse(req.body);
  const user=(await getUsers()).find(u=>u.id===req.auth!.sub);check(user,404,"Pengguna tidak ditemukan.");
  check(await bcrypt.compare(data.currentPassword,user.passwordHash),400,"Password saat ini tidak sesuai.");
  const passwordHash=await bcrypt.hash(data.newPassword,12);
  await transaction(async ()=>{
    const users=await getUsers(),index=users.findIndex(u=>u.id===user.id&&u.passwordHash===user.passwordHash);
    check(index>=0,409,"Akun berubah. Silakan masuk kembali.");
    users[index].passwordHash=passwordHash;await saveUsers(users);await revokeSessions(user.id);await audit(user.id,"password.change",user.id);
  });
  await createSession(res,user.id);res.json({message:"Password diperbarui. Sesi perangkat lain telah dicabut."});
});
// Verifikasi 2 langkah milik sendiri.
const twoFactorLimit=limiter(15*60*1000,20,"Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
router.get("/2fa",async(req:AuthRequest,res)=>res.json(twoFactorStatus((await getUsers()).find(u=>u.id===req.auth!.sub)!)));
router.post("/2fa/setup",twoFactorLimit,async(req:AuthRequest,res)=>res.json(await startSetup(req.auth!.sub,req.body)));
router.post("/2fa/enable",twoFactorLimit,async(req:AuthRequest,res)=>res.json(await confirmSetup(req.auth!.sub,req.body)));
router.post("/2fa/disable",twoFactorLimit,async(req:AuthRequest,res)=>res.json(await disableTwoFactor(req.auth!.sub,req.body)));
router.post("/2fa/recovery",twoFactorLimit,async(req:AuthRequest,res)=>res.json(await regenerateRecovery(req.auth!.sub,req.body)));
// Lonceng notifikasi staf di bilah atas panel admin.
router.get("/notifications",async(req:AuthRequest,res)=>res.json(await staffInbox(req.auth!.sub,req.query)));
router.get("/notifications/unread",async(req:AuthRequest,res)=>res.json({unread:await staffUnread(req.auth!.sub)}));
router.post("/notifications/read",async(req:AuthRequest,res)=>res.json(await markStaffRead(req.auth!.sub,req.body)));
export default router;


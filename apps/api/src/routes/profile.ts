import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession,requireAuth,revokeSessions,type AuthRequest } from "../auth.js";
import { getUsers,saveUsers,transaction,audit } from "../store.js";
import { check } from "../errors.js";
import { passwordSchema,publicUser } from "./auth.js";
import { contactPhoneSchema } from "../operations.js";
const router=Router();router.use(requireAuth);
router.put("/",(req:AuthRequest,res)=>{
  const data=z.object({name:z.string().trim().min(3).max(60),phone:contactPhoneSchema}).parse(req.body);
  const user=transaction(()=>{
    const users=getUsers(),index=users.findIndex(u=>u.id===req.auth!.sub);check(index>=0,404,"Pengguna tidak ditemukan.");
    users[index]={...users[index],...data};saveUsers(users);return users[index];
  });res.json({user:publicUser(user)});
});
router.put("/password",async(req:AuthRequest,res)=>{
  const data=z.object({currentPassword:z.string().min(1).max(72),newPassword:passwordSchema}).parse(req.body);
  const user=getUsers().find(u=>u.id===req.auth!.sub);check(user,404,"Pengguna tidak ditemukan.");
  check(await bcrypt.compare(data.currentPassword,user.passwordHash),400,"Password saat ini tidak sesuai.");
  const passwordHash=await bcrypt.hash(data.newPassword,12);
  transaction(()=>{
    const users=getUsers(),index=users.findIndex(u=>u.id===user.id&&u.passwordHash===user.passwordHash);
    check(index>=0,409,"Akun berubah. Silakan masuk kembali.");
    users[index].passwordHash=passwordHash;saveUsers(users);revokeSessions(user.id);audit(user.id,"password.change",user.id);
  });
  createSession(res,user.id);res.json({message:"Password diperbarui. Sesi perangkat lain telah dicabut."});
});
export default router;


import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireAdmin,revokeSessions,type AuthRequest } from "../auth.js";
import { audit,getMenus,getRoles,getUsers,saveMenus,saveRoles,saveUsers,transaction } from "../store.js";
import { check } from "../errors.js";
import { passwordSchema,publicUser,staffName } from "./auth.js";
import { contactPhoneSchema } from "../operations.js";
import type { AccessMenu,AccessRole,User } from "../types.js";
const router=Router();
router.use(requireAdmin);
router.get("/overview",(_req,res)=>res.json({users:getUsers().map(publicUser),roles:getRoles(),menus:getMenus()}));
const userSchema=z.object({name:staffName,email:z.email("Format email tidak valid.").toLowerCase(),phone:contactPhoneSchema,role:z.string().min(1,"Pilih role."),password:passwordSchema.optional()});
router.post("/users",async(req:AuthRequest,res)=>{
  const data=userSchema.parse(req.body);check(data.password,400,"Password wajib diisi.");
  const passwordHash=await bcrypt.hash(data.password,12);
  const user=transaction(()=>{
    const users=getUsers();
    check(!users.some(u=>u.email.toLowerCase()===data.email),409,"Email sudah digunakan.");
    check(getRoles().some(r=>r.slug===data.role),400,"Role tidak tersedia.");
    const {password:_,...fields}=data;
    const user:User={id:randomUUID(),...fields,passwordHash,createdAt:new Date().toISOString()};
    saveUsers([...users,user]);audit(req.auth!.sub,"user.create",user.id);return user;
  });
  res.status(201).json({user:publicUser(user)});
});
router.put("/users/:id",async(req:AuthRequest,res)=>{
  const data=userSchema.parse(req.body);
  const passwordHash=data.password?await bcrypt.hash(data.password,12):undefined;
  const user=transaction(()=>{
    const users=getUsers(),index=users.findIndex(u=>u.id===req.params.id);
    check(index>=0,404,"Pengguna tidak ditemukan.");
    check(!users.some((u,i)=>i!==index&&u.email.toLowerCase()===data.email),409,"Email sudah digunakan.");
    check(getRoles().some(r=>r.slug===data.role),400,"Role tidak tersedia.");
    check(!(req.auth!.sub===req.params.id&&data.role!=="admin"),400,"Anda tidak dapat menurunkan role sendiri.");
    check(!(users[index].role==="admin"&&data.role!=="admin"&&users.filter(u=>u.role==="admin").length===1),400,"Admin terakhir harus dipertahankan.");
    const {password:_,...fields}=data;
    users[index]={...users[index],...fields,...(passwordHash?{passwordHash}:{})};
    saveUsers(users);if(passwordHash)revokeSessions(users[index].id);
    audit(req.auth!.sub,"user.update",users[index].id);return users[index];
  });res.json({user:publicUser(user)});
});
router.delete("/users/:id",(req:AuthRequest,res)=>{transaction(()=>{
  const users=getUsers(),target=users.find(u=>u.id===req.params.id);
  check(target,404,"Pengguna tidak ditemukan.");
  check(target.id!==req.auth!.sub,400,"Anda tidak dapat menghapus akun sendiri.");
  check(!(target.role==="admin"&&users.filter(u=>u.role==="admin").length===1),400,"Admin terakhir tidak dapat dihapus.");
  saveUsers(users.filter(u=>u.id!==target.id));revokeSessions(target.id);audit(req.auth!.sub,"user.delete",target.id);
});res.status(204).send()});
const roleSchema=z.object({name:z.string().trim().min(3,"Nama role minimal 3 karakter.").max(40,"Nama role maksimal 40 karakter."),slug:z.string().trim().min(2,"Slug minimal 2 karakter.").max(30,"Slug maksimal 30 karakter.").regex(/^[a-z0-9-]+$/,"Slug hanya boleh huruf kecil, angka, dan tanda hubung (-)."),description:z.string().trim().max(160,"Deskripsi maksimal 160 karakter."),menuIds:z.array(z.string())});
function validateMenus(ids:string[]){check(ids.every(id=>getMenus().some(m=>m.id===id)),400,"Menu tidak tersedia.");}
router.post("/roles",(req:AuthRequest,res)=>{
  const data=roleSchema.parse(req.body);
  const role=transaction(()=>{
    validateMenus(data.menuIds);const roles=getRoles();
    check(!roles.some(r=>r.slug===data.slug),409,"Slug role sudah digunakan.");
    const role:AccessRole={id:randomUUID(),...data,isSystem:false,createdAt:new Date().toISOString()};
    saveRoles([...roles,role]);audit(req.auth!.sub,"role.create",role.id);return role;
  });res.status(201).json({role});
});
router.put("/roles/:id",(req:AuthRequest,res)=>{
  const data=roleSchema.parse(req.body);
  const role=transaction(()=>{
    const roles=getRoles(),index=roles.findIndex(r=>r.id===req.params.id);
    check(index>=0,404,"Role tidak ditemukan.");validateMenus(data.menuIds);
    const previous=roles[index];
    check(!previous.isSystem||previous.slug===data.slug,400,"Slug role sistem tidak dapat diubah.");
    check(!roles.some((r,i)=>i!==index&&r.slug===data.slug),409,"Slug role sudah digunakan.");
    if(previous.slug==="admin")check(["users","roles","menus","profile"].every(id=>data.menuIds.includes(id)),400,"Akses administrasi utama tidak dapat dicabut.");
    roles[index]={...previous,...data};saveRoles(roles);
    if(previous.slug!==data.slug)saveUsers(getUsers().map(u=>u.role===previous.slug?{...u,role:data.slug}:u));
    audit(req.auth!.sub,"role.update",previous.id);return roles[index];
  });res.json({role});
});
router.delete("/roles/:id",(req:AuthRequest,res)=>{transaction(()=>{
  const roles=getRoles(),role=roles.find(r=>r.id===req.params.id);
  check(role,404,"Role tidak ditemukan.");check(!role.isSystem,400,"Role sistem tidak dapat dihapus.");
  check(!getUsers().some(u=>u.role===role.slug),400,"Role masih digunakan.");
  saveRoles(roles.filter(r=>r.id!==role.id));audit(req.auth!.sub,"role.delete",role.id);
});res.status(204).send()});
// Path modul bawaan dipetakan langsung oleh halaman admin; mengubah atau menghapusnya membuat menunya mati.
const corePaths:Record<string,string>={dashboard:"/admin",bookings:"/admin/bookings",customers:"/admin/customers","customer-login":"/admin/customer-login",payments:"/admin/payments",notifications:"/admin/notifications",finance:"/admin/keuangan","finance-records":"/admin/keuangan/transaksi","finance-journal":"/admin/keuangan/jurnal","finance-reports":"/admin/keuangan/laporan","finance-settings":"/admin/keuangan/pengaturan",courts:"/admin/courts",addons:"/admin/addons",layout:"/admin/layout",info:"/admin/info",users:"/admin/users",roles:"/admin/roles",menus:"/admin/menus",profile:"/admin/profile"};
const menuSchema=z.object({name:z.string().trim().min(2,"Nama menu minimal 2 karakter.").max(40,"Nama menu maksimal 40 karakter."),path:z.string().trim().regex(/^\/admin(?:\/[a-z0-9-]+)*$/,"Path harus diawali /admin/ dan hanya memuat huruf kecil, angka, atau tanda hubung."),icon:z.string().min(2).max(40),group:z.string().trim().min(2,"Nama grup minimal 2 karakter.").max(40,"Nama grup maksimal 40 karakter."),order:z.number("Urutan harus berupa angka.").int("Urutan harus bilangan bulat.").min(0,"Urutan tidak boleh negatif."),active:z.boolean()});
router.post("/menus",(req:AuthRequest,res)=>{
  const data=menuSchema.parse(req.body);
  const menu=transaction(()=>{
    const menus=getMenus();check(!menus.some(m=>m.path===data.path),409,"Path menu sudah digunakan.");
    const menu:AccessMenu={id:randomUUID(),...data,createdAt:new Date().toISOString()};
    saveMenus([...menus,menu]);audit(req.auth!.sub,"menu.create",menu.id);return menu;
  });res.status(201).json({menu});
});
router.put("/menus/:id",(req:AuthRequest,res)=>{
  const data=menuSchema.parse(req.body);
  const menu=transaction(()=>{
    const menus=getMenus(),index=menus.findIndex(m=>m.id===req.params.id);check(index>=0,404,"Menu tidak ditemukan.");
    const target=menus[index];
    check(!menus.some((m,i)=>i!==index&&m.path===data.path),409,"Path menu sudah digunakan.");
    if(corePaths[target.id])check(data.path===corePaths[target.id],400,"Path modul bawaan tidak dapat diubah.");
    if(["users","roles","menus","profile"].includes(target.id))check(data.active,400,"Menu administrasi utama harus tetap aktif.");
    menus[index]={...target,...data};saveMenus(menus);audit(req.auth!.sub,"menu.update",target.id);return menus[index];
  });res.json({menu});
});
router.delete("/menus/:id",(req:AuthRequest,res)=>{transaction(()=>{
  const menus=getMenus(),target=menus.find(m=>m.id===req.params.id);check(target,404,"Menu tidak ditemukan.");
  check(!corePaths[target.id],400,"Menu modul bawaan tidak dapat dihapus.");
  saveMenus(menus.filter(m=>m.id!==target.id));saveRoles(getRoles().map(r=>({...r,menuIds:r.menuIds.filter(id=>id!==target.id)})));
  audit(req.auth!.sub,"menu.delete",target.id);
});res.status(204).send()});
export default router;


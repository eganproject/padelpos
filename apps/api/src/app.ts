import { clientUrl, publicUrl } from "./config.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import accessRoutes from "./routes/access.js";
import profileRoutes from "./routes/profile.js";
import operationsRoutes from "./routes/operations.js";
import publicRoutes from "./routes/public.js";
import customerRoutes from "./routes/customer.js";
import { HttpError } from "./errors.js";

export const app=express();
app.disable("x-powered-by");
// Rewrite Next.js tidak menambahkan X-Forwarded-For, tetapi meneruskan nilai kiriman browser
// apa adanya. Mempercayainya tanpa reverse proxy berarti siapa pun bisa memalsukan IP untuk
// mengakali rate limit, jadi hanya aktif bila TRUST_PROXY diisi, mis. "loopback" ketika nginx
// di depan Next.js menambahkan IP asli pengunjung (proxy_add_x_forwarded_for).
const trustProxy=process.env.TRUST_PROXY?.trim();
if(trustProxy)app.set("trust proxy",/^\d+$/.test(trustProxy)?Number(trustProxy):trustProxy);
app.use(helmet());
// Situs bisa dibuka lewat CLIENT_URL maupun PUBLIC_URL (mis. terowongan ngrok untuk menguji Midtrans);
// keduanya asal yang sah, kalau tidak setiap POST dari alamat publik ditolak 403.
const originOf=(value:string)=>{try{return new URL(value).origin}catch{return value.replace(/\/+$/,"")}};
const origins=[...new Set([clientUrl,publicUrl].map(originOf))];
app.use(cors({origin:origins,credentials:true}));
/** Endpoint yang menerima berkas biner: unggah foto lapangan dan foto item tambahan. */
const photoUpload=/^\/api\/operations\/(?:courts\/[^/]+\/photos|addons\/[^/]+\/photo|finance\/records\/[^/]+\/receipt)$/;
app.use((req,res,next)=>{
  if(!["GET","HEAD","OPTIONS"].includes(req.method)){
    if(req.headers.origin&&!origins.includes(req.headers.origin))return res.status(403).json({message:"Asal permintaan tidak diizinkan."});
    // req.is() bernilai null untuk request tanpa body (mis. DELETE); tolak hanya body ber-tipe salah.
    if(req.method==="POST"&&photoUpload.test(req.path)){
      if(req.is(["image/jpeg","image/png","image/webp"])===false)return res.status(415).json({message:"Format foto harus JPG, PNG, atau WebP."});
    }else if(req.is("application/json")===false)return res.status(415).json({message:"Gunakan application/json."});
  }
  next();
});
// Cukup untuk syarat & ketentuan serta 30 FAQ sekaligus.
app.use(express.json({limit:"128kb"}));
const limiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:"draft-8",legacyHeaders:false,message:{message:"Terlalu banyak percobaan. Coba lagi dalam 15 menit."}});
app.use("/api/auth/login",limiter);
app.use("/api/auth/register",limiter);
app.use("/api/auth",authRoutes);
app.use("/api/dashboard",dashboardRoutes);
app.use("/api/access",accessRoutes);
app.use("/api/profile",profileRoutes);
app.use("/api/operations",operationsRoutes);
app.use("/api/public",publicRoutes);
app.use("/api/customer",customerRoutes);
app.get("/api/health",(_req,res)=>res.json({status:"ok",service:"padelix-api"}));
app.use((_req,res)=>res.status(404).json({message:"Endpoint tidak ditemukan."}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof ZodError)return res.status(400).json({message:error.issues.map(i=>i.message).join(" ")});
  if(error instanceof HttpError)return res.status(error.status).json({message:error.message});
  if(error instanceof Error&&error.message.includes("schedule_conflict"))return res.status(409).json({message:"Jadwal bentrok dengan booking atau maintenance. Pilih waktu lain."});
  if(error instanceof Error&&error.message.includes("UNIQUE constraint"))return res.status(409).json({message:"Data sudah digunakan. Muat ulang dan coba lagi."});
  if(error instanceof SyntaxError)return res.status(400).json({message:"Format JSON tidak valid."});
  if(typeof error==="object"&&error!==null&&"status" in error&&error.status===413)return res.status(413).json({message:"Data permintaan terlalu besar."});
  console.error(error);res.status(500).json({message:"Terjadi kesalahan server. Silakan coba kembali."});
});


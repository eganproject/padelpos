import type { NextConfig } from "next";
const nextConfig:NextConfig={
  reactStrictMode:true,
  // Sembunyikan logo/indikator Next.js yang mengambang di pojok layar saat mode pengembangan.
  devIndicators:false,
  // Folder build terpisah untuk server kedua (mis. pratinjau atau audit) agar tidak bentrok dengan `npm run dev`.
  distDir:process.env.NEXT_DIST_DIR||".next",
  async rewrites(){return [{source:"/api/:path*",destination:`${process.env.API_INTERNAL_URL||"http://127.0.0.1:4000"}/api/:path*`}]},
};
export default nextConfig;


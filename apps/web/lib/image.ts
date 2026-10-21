/** Perkecil foto di browser sebelum diunggah: foto ponsel belasan MB menjadi beberapa ratus KB. */
export async function shrink(file:File,maxSide=1600):Promise<Blob>{
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Format tidak didukung. Gunakan JPG, PNG, atau WebP.");
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file)}catch{throw new Error("Foto tidak dapat dibaca.")}
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext("2d")!;
  // PNG transparan diberi latar putih karena JPEG tidak mendukung transparansi.
  context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.85));
  if(!blob)throw new Error("Foto gagal diproses.");
  return blob;
}

/**
 * Foto profil: dipotong persegi dari tengah lalu diperkecil, jadi foto ponsel belasan MB menjadi
 * JPEG puluhan KB. Wajah di foto potret biasanya ada di sepertiga atas, jadi potongan tegak
 * digeser sedikit ke atas.
 */
export async function squareAvatar(file:File,size=400):Promise<Blob>{
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Format tidak didukung. Gunakan JPG, PNG, atau WebP.");
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file)}catch{throw new Error("Foto tidak dapat dibaca.")}
  const side=Math.min(bitmap.width,bitmap.height),out=Math.min(size,side);
  const sx=(bitmap.width-side)/2,sy=bitmap.height>bitmap.width?(bitmap.height-side)/4:0;
  const canvas=document.createElement("canvas");canvas.width=out;canvas.height=out;
  const context=canvas.getContext("2d")!;
  context.fillStyle="#fff";context.fillRect(0,0,out,out);context.drawImage(bitmap,sx,sy,side,side,0,0,out,out);bitmap.close();
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.88));
  if(!blob)throw new Error("Foto gagal diproses.");
  return blob;
}

/**
 * Logo dan favicon merek: diperkecil tanpa dipotong dan tetap transparan (PNG), agar tampil rapi di
 * latar terang, gelap, email, dan nota. `square` menaruh gambar di tengah kanvas persegi untuk favicon.
 */
export async function brandImage(file:File,{maxWidth,maxHeight,square=false}:{maxWidth:number;maxHeight:number;square?:boolean}):Promise<Blob>{
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Format tidak didukung. Gunakan PNG (disarankan, transparan), JPG, atau WebP.");
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file)}catch{throw new Error("Gambar tidak dapat dibaca.")}
  const scale=Math.min(1,maxWidth/bitmap.width,maxHeight/bitmap.height);
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement("canvas");
  canvas.width=square?Math.max(maxWidth,maxHeight):width;canvas.height=square?Math.max(maxWidth,maxHeight):height;
  const context=canvas.getContext("2d")!;
  context.imageSmoothingQuality="high";
  context.drawImage(bitmap,(canvas.width-width)/2,(canvas.height-height)/2,width,height);bitmap.close();
  const encode=(type:string,quality?:number)=>new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,type,quality));
  let blob=await encode("image/png");
  // PNG foto yang besar diganti WebP agar tetap di bawah batas unggah 1 MB.
  if(blob&&blob.size>900_000)blob=await encode("image/webp",0.9);
  if(!blob)throw new Error("Gambar gagal diproses.");
  return blob;
}

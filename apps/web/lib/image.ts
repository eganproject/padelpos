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

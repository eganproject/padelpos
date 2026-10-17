export class HttpError extends Error {
  constructor(public status:number,message:string){super(message)}
}
/** Lempar HttpError bila kondisi tidak terpenuhi. Promise ditolak di tingkat tipe karena selalu bernilai benar. */
export function check<T>(condition:T extends PromiseLike<unknown>?never:T,status:number,message:string):asserts condition {
  if(!condition) throw new HttpError(status,message);
}

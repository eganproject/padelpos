"use client";
import { useEffect,useRef } from "react";
import { X } from "lucide-react";
export function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const bodyOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    ref.current?.focus();
    function key(event:KeyboardEvent){
      if(event.key==="Escape")close();
      if(event.key==="Tab"){
        const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')||[]);
        const first=nodes[0],last=nodes[nodes.length-1];
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }
    document.addEventListener("keydown",key);return()=>{document.body.style.overflow=bodyOverflow;document.removeEventListener("keydown",key);previous?.focus()};
  },[close]);
  return <div className="modal-backdrop"><div className="crud-modal ops-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="modal-head"><h2>{title}</h2><button type="button" aria-label="Tutup dialog" data-tip="Tutup dialog" onClick={close}><X/></button></div>{children}</div></div>;
}
export function ErrorBox({message,retry}:{message:string;retry?:()=>void}){return <div className="ops-error" role="alert">{message}{retry&&<button type="button" onClick={retry}>Coba lagi</button>}</div>}
/** Tombol simpan. `disabled` menonaktifkan tanpa mengganti teksnya menjadi "Menyimpan…". */
export function Submit({busy,disabled=false,children="Simpan"}:{busy:boolean;disabled?:boolean;children?:React.ReactNode}){return <button className="ops-primary" type="submit" disabled={busy||disabled}>{busy?"Menyimpan…":children}</button>}


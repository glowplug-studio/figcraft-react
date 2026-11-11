import {cleanDisplayName} from "./engine/comment-actions";
import {useEffect,useState,useSyncExternalStore} from "react";

const memory=new Map<string,string>();
const eventName="figcraft-display-name";
export function readDisplayName(principal:string) {
  if(typeof window==="undefined") return "";
  try {return localStorage.getItem("figcraft.name."+principal)??memory.get(principal)??"";}
  catch {return memory.get(principal)??"";}
}
function listen(notify:()=>void) {
  window.addEventListener(eventName,notify);window.addEventListener("storage",notify);
  return ()=>{window.removeEventListener(eventName,notify);window.removeEventListener("storage",notify);};
}
export function useDisplayName(principal:string) {
  return useSyncExternalStore(listen,()=>readDisplayName(principal),()=>"");
}
export function DisplayNameField({principal}:{principal:string}) {
  const name=useDisplayName(principal);
  const [value,setValue]=useState(name);
  useEffect(()=>setValue(name),[name]);
  function save() {
    const cleaned=cleanDisplayName(value),next=cleaned==="You"?"":cleaned;
    setValue(next);memory.set(principal,next);
    try {localStorage.setItem("figcraft.name."+principal,next);} catch { /* In-memory for private browsing. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return <label>Your name<input value={value} autoComplete="off" onChange={e=>setValue(e.target.value)}
    onBlur={save} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}}}/></label>;
}

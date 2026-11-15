import {useEffect,useId,useState,useSyncExternalStore} from "react";
import type {OnlineServerPreference} from "./engine/sharing/server-preference";

export function OnlineServerPreferenceField({preference}:{preference:OnlineServerPreference}) {
  const saved=useSyncExternalStore(preference.subscribe,preference.getSnapshot,preference.getSnapshot);
  const [value,setValue]=useState(saved.url);
  const [error,setError]=useState("");
  const errorId=useId();
  useEffect(()=>{setValue(saved.url);setError("");},[preference,saved]);
  function save(reset=false) {
    try {
      const next=preference.execute(reset?{}:{url:value});
      setValue(next.url);setError("");
    } catch(reason) {
      setError(reason instanceof Error?reason.message:"Could not save the server address.");
    }
  }
  return <div>
    <label>Server for online sharing<input value={value} autoComplete="off" spellCheck={false}
      aria-invalid={error?true:undefined} aria-describedby={error?errorId:undefined}
      onChange={event=>{setValue(event.target.value);setError("");}} onBlur={()=>save()}
      onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}}}/></label>
    <button type="button" disabled={saved.url===saved.default} onClick={()=>save(true)}>Reset</button>
    {error && <p id={errorId} role="alert">{error}</p>}
    {!saved.url && <p>Online sharing is off. Choose a server to share online.</p>}
  </div>;
}

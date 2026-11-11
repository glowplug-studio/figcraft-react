import {useEffect,useRef,useState} from "react";
import type {LibraryUsageSummary} from "./engine/sharing/library-usage";
import type {PublishedLibrary} from "./engine/published-library";

const quantity=(count:number,word:string)=>count+" "+word+(count===1 ? "" : "s");

export function TeamLibraryUsage({read}:{read:(days:number)=>Promise<{data:LibraryUsageSummary;library?:PublishedLibrary}>}) {
  const [days,setDays]=useState(30),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [result,setResult]=useState<{counts:LibraryUsageSummary;library?:PublishedLibrary}>();
  const attempt=useRef(0);
  useEffect(()=>()=>{attempt.current++;},[]);
  async function load(period:number) {
    const request=++attempt.current;
    setBusy(true);setError("");
    try {
      const {data,library}=await read(period);
      if (request===attempt.current) {setResult({counts:data,library});setDays(period);}
    } catch (cause) {if (request===attempt.current) setError(cause instanceof Error ? cause.message : "Could not read library usage");}
    finally {if (request===attempt.current) setBusy(false);}
  }
  const counts=result?.counts,manifest=result?.library?.manifest;
  return <section aria-label="Team library usage">
    {busy ? <button type="button" onClick={()=>{attempt.current++;setBusy(false);}}>Cancel usage request</button> :
      <button type="button" onClick={()=>void load(days)}>Show usage</button>}
    {error && <p role="alert">{error}</p>}
    {counts && <>
      <label>Usage period<select value={days} disabled={busy} onChange={e=>void load(Number(e.target.value))}>
        <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
      </select></label>
      <p>Used in {quantity(counts.files.length,"file")} · {quantity(counts.instances,"instance")} · {counts.detached} detached</p>
      <p>Past {days} days · {quantity(counts.insertions,"insertion")} · {quantity(counts.detachments,"detachment")}</p>
      {!!counts.weeks.length && <details><summary>Weekly activity</summary><ul>{counts.weeks.map(w=><li key={w.week}>
        {new Date(w.week*1000).toISOString().slice(0,10)} · {w.insertions} inserted · {w.detachments} detached</li>)}</ul></details>}
      {!!counts.components.length && <details><summary>Component usage</summary><ul>{counts.components.slice(0,8).map(c=><li key={c.id}>
        {manifest?.components.find(m=>m.id===c.id)?.name ?? "(no longer published)"} · {quantity(c.instances,"instance")} · {quantity(c.files,"file")} · {c.detached} detached · {c.insertions} inserted in period · {c.detachments} detached in period</li>)}</ul></details>}
      {(["styles","variables"] as const).map(kind=>counts[kind].length>0 && <details key={kind}><summary>{kind==="styles" ? "Style usage" : "Variable usage"}</summary>
        <ul>{counts[kind].slice(0,8).map(row=><li key={row.id}>{manifest?.[kind].find(asset=>asset.id===row.id)?.name ?? "(no longer published)"} · {quantity(row.layers,"layer")} · {quantity(row.files,"file")}</li>)}</ul></details>)}
      {!!counts.files.length && <details><summary>Files using this library</summary><ul>{counts.files.map(f=><li key={f.name}>
        {f.name} · {quantity(f.instances,"instance")} · {f.detached} detached</li>)}</ul></details>}
    </>}
  </section>;
}

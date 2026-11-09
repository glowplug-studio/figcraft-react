import {pendingVariables} from "./engine/library-variables";
import type {PublishedLibrary} from "./engine/published-library";
import {LibraryPublishForm} from "./LibraryPublishForm";
import { StyleSwatch } from "./StyleEditor";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { listComponents } from "./engine/component-assets";
import { owningInstance } from "./engine/component-tree";
import { renderAssetThumbnail } from "./engine/canvas";
import type { Document } from "./engine/document";

export const componentDragType = "application/x-figcraft-component";

// Native Assets renders at most eight visible thumbnails per frame. Also bound simultaneous image decodes.
const thumbnails = new Set<()=>Promise<void>>();
let scheduled = false, rendering = 0;
function scheduleThumbnails() {
  if (scheduled || !thumbnails.size || rendering >= 8) return;
  scheduled = true;
  requestAnimationFrame(()=>{
    scheduled = false;
    for (const draw of thumbnails) {
      if (rendering >= 8) break;
      thumbnails.delete(draw);
      rendering++;
      void draw().finally(()=>{rendering--; scheduleThumbnails();});
    }
  });
}

function AssetThumbnail({doc,id}:{doc:Document;id:string}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas = ref.current!;
    const active = new AbortController();
    const draw = async () => {
      const pixels = Math.max(32,Math.ceil(canvas.parentElement!.clientWidth*devicePixelRatio));
      try { await renderAssetThumbnail(canvas,doc,id,pixels,active.signal); }
      catch { if (!active.signal.aborted) canvas.width = 1; }
    };
    const observer = new IntersectionObserver(entries=>{
      if (!entries.some(entry=>entry.isIntersecting)) return;
      observer.disconnect();
      thumbnails.add(draw); scheduleThumbnails();
    },{rootMargin:"100px"});
    observer.observe(canvas);
    return ()=>{observer.disconnect(); thumbnails.delete(draw); active.abort();};
  },[doc,id]);
  return <canvas ref={ref} aria-hidden="true" width="1" height="1"/>;
}

function localAssets(doc: Document) {
  return listComponents(doc).filter(asset=>{
    const id = String(asset.id), node = doc.nodes[id];
    return !(node.kind === "component" && doc.nodes[node.parent].kind === "componentSet") && !owningInstance(doc,id,false);
  }).map(asset=>({...asset,path:asset.folder.join(" / ")})).sort((a,b)=>{
    const compare = (x:string,y:string)=>x<y ? -1 : x>y ? 1 : 0;
    return compare(a.path.toLowerCase(),b.path.toLowerCase()) || compare(a.label.toLowerCase(),b.label.toLowerCase());
  });
}

interface AssetProps {
  doc: Document;
  editable: boolean;
  dispatch(command: string, params: unknown): Record<string,unknown>|undefined;
  save():Promise<void>;
  source(path:string):PublishedLibrary|undefined;
  addLibrary(file:File):Promise<void>;
  place(id: string): void;
  start(id: string, event: DragEvent<HTMLButtonElement>): void;
  end(): void;
}

export function AssetsPanel({doc,editable,dispatch,place,start,end,source,addLibrary,save}:AssetProps) {
  const [query,setQuery] = useState("");
  const [collapsed,setCollapsed] = useState<ReadonlySet<string>>(()=>new Set());
  const [libraryStatus,setLibraryStatus]=useState("");
  const [loadingLibrary,setLoadingLibrary]=useState(false);
  const picker=useRef<HTMLInputElement>(null);
  const [publish,setPublish] = useState(false);
  const [menu,setMenu] = useState<string>();
  const all = useMemo(()=>localAssets(doc),[doc]);
  const search = query.trim().toLowerCase();
  const styles = (doc.styles ?? []).filter(style=>style.name.toLowerCase().includes(search));
  const groups = useMemo(()=>{
    const folders = new Map<string,typeof all>();
    for (const asset of all) {
      if (!asset.name.toLowerCase().includes(search)) continue;
      const list = folders.get(asset.path);
      if (list) list.push(asset); else folders.set(asset.path,[asset]);
    }
    return folders;
  },[all,search]);
  return <section className="figcraft-assets" aria-label="Assets" onKeyDown={e=>{if(e.key === "Escape") {setMenu(undefined);setQuery("");}}}>
    <input aria-label="Search assets" placeholder="Search assets" type="search" value={query} onChange={e=>setQuery(e.target.value)}/>
    <button type="button" aria-expanded={publish} onClick={()=>setPublish(!publish)}>Publish library…</button>
    {publish && <LibraryPublishForm doc={doc} editable={editable} dispatch={dispatch} save={save}/>}
    <button type="button" disabled={!editable || loadingLibrary} onClick={()=>picker.current?.click()}>Add library…</button>
    <input type="file" ref={picker} hidden aria-label="Choose published library" accept=".figcraft" onChange={async e=>{
      const file=e.currentTarget.files?.[0];e.currentTarget.value="";
      if (!file) return;
      setLoadingLibrary(true);setLibraryStatus("Reading library…");
      try {await addLibrary(file);setLibraryStatus("");}
      catch (error) {setLibraryStatus(error instanceof Error ? error.message : "Could not add library");}
      finally {setLoadingLibrary(false);}
    }}/>
    {libraryStatus && <p role="status">{libraryStatus}</p>}
    {!!doc.libraryLinks?.length && <section aria-label="Enabled libraries"><h3>Enabled libraries</h3>
      {doc.libraryLinks.map(link=>{
        const publication=source(link.path),manifest=publication?.manifest;
        const pending=publication && pendingVariables(doc,publication);
        const count=pending ? pending.variables.length+pending.collections.length : 0;
        return <div key={link.id}><strong>{link.name}</strong>
          <p>{manifest?.id===link.id ? "Published version "+manifest.version : "Choose the library file to load its assets."}</p>
          {count>0 && <button type="button" disabled={!editable} onClick={()=>dispatch("library.acceptUpdates",{ids:[link.id]})}>
            Accept {count} {count===1 ? "update" : "updates"}</button>}
          <button type="button" disabled={!editable} aria-label={"Remove library "+link.name}
            onClick={()=>dispatch("library.remove",{id:link.id})}>Remove</button></div>;
      })}</section>}
    <h3>Local components</h3>
    {!groups.size && <p>{search ? "No matching components" : "No components yet."}</p>}
    {[...groups].map(([path,assets])=>{
      const open = !!search || !collapsed.has(path);
      return <div key={path}>
        {path && <button type="button" className="figcraft-asset-folder" aria-expanded={open} onClick={()=>{
          setCollapsed(previous=>{const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next;});
        }}>{path}</button>}
        {(open || !path) && <div className="figcraft-asset-grid">{assets.map(asset=>{
          const id = String(asset.id), hidden = /^[._]/.test(asset.name);
          return <div key={id} onBlur={e=>{if (!e.currentTarget.contains(e.relatedTarget)) setMenu(v=>v === id ? undefined : v);}}>
            <button type="button" className="figcraft-asset-tile" aria-label={"Place "+asset.name} disabled={!editable}
              title={asset.name+" · Click to place in the centre. Drag to place, or hold Alt over an instance to swap."}
              draggable={editable} onDragStart={e=>start(id,e)} onDragEnd={end} onClick={()=>place(id)}
              onContextMenu={e=>{e.preventDefault();setMenu(id);}}>
              <span className="figcraft-asset-preview"><AssetThumbnail doc={doc} id={id}/></span>
              <span>{asset.label}</span>
            </button>
            <button type="button" className="figcraft-asset-options" aria-expanded={menu === id} aria-label={"Options for "+asset.name}
              onClick={()=>setMenu(menu === id ? undefined : id)}>{hidden ? "◌" : "⋯"}</button>
            {menu === id && <button type="button" className="figcraft-asset-hide" disabled={!editable} aria-pressed={hidden} onClick={()=>{
              dispatch("component.hideWhenPublishing",{id,on:!hidden});setMenu(undefined);
            }}>Hide when publishing</button>}
          </div>;
        })}</div>}
      </div>;
    })}
    <h3>Local styles</h3>
    {!styles.length && <p>{search ? "No matching styles" : "No styles yet."}</p>}
    {styles.map(style => <button key={style.id} type="button" disabled={!editable} className="figcraft-style-asset"
      title={style.description || style.name} onClick={()=>dispatch("style.apply",{style:style.id})}>
      <StyleSwatch style={style}/>{style.name}
    </button>)}
  </section>;
}

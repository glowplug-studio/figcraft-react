import {useLibraryVariables} from "./LibraryVariablesContext";
import {pendingLibraryAssets} from "./engine/library-updates";
import {localStyles} from "./engine/library-styles";
import type {PublishedLibrary} from "./engine/published-library";
import {LibraryPublishForm} from "./LibraryPublishForm";
import { StyleSwatch } from "./StyleEditor";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {compareScalarKeys} from "./engine/text-breaks";
import { assetFolder, listComponents } from "./engine/component-assets";
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

interface Tile {id:string;name:string;label:string;path:string}
function orderTiles(tiles:Tile[]) {
  return tiles.sort((a,b)=>compareScalarKeys(a.path.toLowerCase(),b.path.toLowerCase()) ||
    compareScalarKeys(a.label.toLowerCase(),b.label.toLowerCase()) || a.id.length-b.id.length || compareScalarKeys(a.id,b.id));
}
function localAssets(doc:Document) {
  const tiles=listComponents(doc).filter(asset=>{
    const id=String(asset.id),node=doc.nodes[id];
    return !asset.library && !(node.kind==="component" && doc.nodes[node.parent].kind==="componentSet") && !owningInstance(doc,id,false);
  }).map(asset=>({id:String(asset.id),name:asset.name,label:asset.label,path:asset.folder.join(" / ")}));
  return orderTiles(tiles);
}
const libraryTiles=new WeakMap<PublishedLibrary,Tile[]>();
function publishedTiles(library:PublishedLibrary) {
  const cached=libraryTiles.get(library);
  if (cached) return cached;
  const tiles=library.manifest.components.filter(c=>c.published).map(({id,name})=>{
    const node=library.document.nodes[id];
    const {label,folder}=node ? assetFolder(library.document,id) : {label:name,folder:[]};
    return {id,name,label,path:folder.join(" / ")};
  });
  libraryTiles.set(library,orderTiles(tiles));
  return tiles;
}
function folders(tiles:readonly Tile[],search:string) {
  const result=new Map<string,Tile[]>();
  for (const tile of tiles) {
    if (!tile.name.toLowerCase().includes(search)) continue;
    const list=result.get(tile.path);
    if (list) list.push(tile);else result.set(tile.path,[tile]);
  }
  return result;
}

interface AssetProps {
  publish:boolean;
  doc: Document;
  editable: boolean;
  dispatch(command: string, params: unknown): Record<string,unknown>|undefined;
  save():Promise<void>;
  source(path:string):PublishedLibrary|undefined;
  addLibrary(file:File):Promise<void>;
  place(id:string,library?:string):void;
  start(id: string, event: DragEvent<HTMLButtonElement>,library?:PublishedLibrary): void;
  end(): void;
}

export function AssetsPanel({doc,editable,dispatch,place,start,end,source,addLibrary,save,publish}:AssetProps) {
  const {sources}=useLibraryVariables();
  const catalogues=useMemo(()=>new Map(sources.map(s=>[s.id,s])),[sources]);
  const [query,setQuery] = useState("");
  const [collapsed,setCollapsed] = useState<ReadonlySet<string>>(()=>new Set());
  const [libraryStatus,setLibraryStatus]=useState("");
  const [swapping,setSwapping]=useState<string>();
  const [loadingLibrary,setLoadingLibrary]=useState(false);
  const picker=useRef<HTMLInputElement>(null);
  const [menu,setMenu] = useState<string>();
  const all = useMemo(()=>localAssets(doc),[doc]);
  const search = query.trim().toLowerCase();
  const styles = localStyles(doc).filter(style=>style.name.toLowerCase().includes(search));
  const groups=useMemo(()=>folders(all,search),[all,search]);
  function toggle(key:string) {
    setCollapsed(previous=>{
      const next=new Set(previous);
      if (next.has(key)) next.delete(key);else next.add(key);
      return next;
    });
  }
  function renderFolders(groups:Map<string,Tile[]>,library?:PublishedLibrary) {
    return [...groups].map(([path,assets])=>{
      const key=JSON.stringify([library?.manifest.id ?? null,path]),open=!!search || !collapsed.has(key);
      return <div key={path}>
        {path && <button type="button" className="figcraft-asset-folder" aria-expanded={open} onClick={()=>toggle(key)}>{path}</button>}
        {(open || !path) && <div className="figcraft-asset-grid">{assets.map(asset=>{
          const id = asset.id, hidden = /^[._]/.test(asset.name);
          return <div key={id} onBlur={e=>{if (!e.currentTarget.contains(e.relatedTarget)) setMenu(v=>v === id ? undefined : v);}}>
            <button type="button" className="figcraft-asset-tile" aria-label={"Place "+asset.name} disabled={!editable}
              title={asset.name+" · Click to place in the centre. Drag to place, or hold Alt over an instance to swap."}
              draggable={editable} onDragStart={e=>start(id,e,library)} onDragEnd={end} onClick={()=>place(id,library?.manifest.id)}
              onContextMenu={library ? undefined : e=>{e.preventDefault();setMenu(id);}}>
              <span className="figcraft-asset-preview"><AssetThumbnail doc={library?.document ?? doc} id={id}/></span>
              <span>{asset.label}</span>
            </button>
            {!library && <button type="button" className="figcraft-asset-options" aria-expanded={menu === id} aria-label={"Options for "+asset.name}
              onClick={()=>setMenu(menu === id ? undefined : id)}>{hidden ? "◌" : "⋯"}</button>}
            {!library && menu === id && <button type="button" className="figcraft-asset-hide" disabled={!editable} aria-pressed={hidden} onClick={()=>{
              dispatch("component.hideWhenPublishing",{id,on:!hidden});setMenu(undefined);
            }}>Hide when publishing</button>}
          </div>;
        })}</div>}
      </div>;
    });
  }
  return <section className="figcraft-assets" aria-label="Assets" onKeyDown={e=>{if(e.key === "Escape") {setMenu(undefined);setSwapping(undefined);setQuery("");}}}>
    <input aria-label="Search assets" placeholder="Search assets" type="search" value={query} onChange={e=>setQuery(e.target.value)}/>
    <button type="button" aria-expanded={publish} onClick={()=>dispatch(publish ? "libraries.open" : "libraries.publish",{})}>Publish library…</button>
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
        const pending=publication && manifest?.id===link.id && pendingLibraryAssets(doc,publication);
        const count=pending ? pending.components.length+pending.styles.length+pending.variables.length+pending.collections.length : 0;
        const loaded=publication && manifest?.id===link.id ? publication : undefined;
        const tiles=folders(loaded ? publishedTiles(loaded) : [],search);
        const styles=catalogues.get(link.id)?.styles.filter(s=>s.name.toLowerCase().includes(search)) ?? [];
        if (search && !tiles.size && !styles.length) return null;
        const key=JSON.stringify([link.id]),expanded=!!search || !collapsed.has(key);
        return <div key={link.id} role="group" aria-label={link.name+" assets"}>
          <button type="button" aria-expanded={expanded} onClick={()=>toggle(key)}>{link.name}</button>
          <p>{loaded ? "Published version "+loaded.manifest.version : "Choose the library file to load its assets."}</p>
          {expanded && loaded && renderFolders(tiles,loaded)}
          {expanded && styles.map(style=>
              <button key={style.id} type="button" disabled={!editable} className="figcraft-style-asset"
                title={style.description || style.name} onClick={()=>dispatch("library.applyStyle",{library:link.id,style:style.id})}>
                <StyleSwatch style={style}/>{style.name}
              </button>)}
          {count>0 && <button type="button" disabled={!editable} onClick={()=>dispatch("library.acceptUpdates",{ids:[link.id]})}>
            Accept {count} {count===1 ? "update" : "updates"}</button>}
          {doc.libraryLinks!.length>1 && <button type="button" disabled={!editable}
            aria-label={"Swap library "+link.name} aria-expanded={swapping===link.id}
            onClick={()=>setSwapping(swapping===link.id ? undefined : link.id)}>Swap…</button>}
          {swapping===link.id && <div role="group" aria-label={"Swap "+link.name+" to"}>
            {doc.libraryLinks!.filter(other=>other.id!==link.id).map(other=>
              <button type="button" key={other.id} disabled={!editable || source(other.path)?.manifest.id!==other.id}
                onClick={()=>{
                  const result=dispatch("library.swap",{from:link.id,to:other.id});
                  setSwapping(undefined);
                  if (!result) return;
                  const unmatched=Array.isArray(result.unmatched) ? result.unmatched : [];
                  setLibraryStatus("Swapped "+link.name+" to "+other.name+" ("+result.components+" components, "+
                    result.styles+" styles, "+result.variables+" variables)."+
                    (unmatched.length ? " Unmatched assets include "+unmatched.join(", ")+".":""));
                }}>{other.name}</button>)}
          </div>}
          <button type="button" disabled={!editable} aria-label={"Remove library "+link.name}
            onClick={()=>dispatch("library.remove",{id:link.id})}>Remove</button></div>;
      })}</section>}
    <h3>Local components</h3>
    {!groups.size && <p>{search ? "No matching components" : "No components yet."}</p>}
    {renderFolders(groups)}
    <h3>Local styles</h3>
    {!styles.length && <p>{search ? "No matching styles" : "No styles yet."}</p>}
    {styles.map(style => <button key={style.id} type="button" disabled={!editable} className="figcraft-style-asset"
      title={style.description || style.name} onClick={()=>dispatch("style.apply",{style:style.id})}>
      <StyleSwatch style={style}/>{style.name}
    </button>)}
  </section>;
}

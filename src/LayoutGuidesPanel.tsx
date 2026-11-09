import { useState } from "react";
import { LayoutNumber, type LayoutFieldHost } from "./LayoutNumber";
import { sameComponentValue } from "./engine/component-groups";
import { isFrameLike, type DocumentNode } from "./engine/document";
import { parseColour } from "./engine/colour-css";
import { toCssHex, withAlpha } from "./engine/colour";
import { readGrids, type LayoutGrid } from "./engine/shared-styles";

type Props = LayoutFieldHost & {nodes:readonly DocumentNode[]; enabled:boolean};
type Patch = Partial<LayoutGrid>;

export function LayoutGuidesPanel({nodes,enabled,...host}:Props) {
  const [open,setOpen] = useState<number>();
  const [drag,setDrag] = useState<number>();
  if (!nodes.length || !nodes.every(isFrameLike)) return null;
  const ids = nodes.map(n=>n.id), list = nodes[0].grids ?? [];
  const common = nodes.every(n=>sameComponentValue(n.grids ?? [],list));
  const params = (index:number, patch:Patch) => ({ids,props:{grids:list.map((grid,i)=>i===index ? {...grid,...patch} : grid)}});
  const set = (index:number, patch:Patch) => host.dispatch("node.set",params(index,patch));
  function move(from:number,to:number) {
    host.dispatch("grid.move",{ids,from,to});
    setOpen(index=>index === undefined ? index : index === from ? to : from < index && index <= to ? index-1 : to <= index && index < from ? index+1 : index);
  }
  return <fieldset aria-label="Layout guides" disabled={!enabled}>
    <legend>Layout grid</legend>
    <button type="button" onClick={()=>host.dispatch("grid.add",{ids})}>Add layout grid</button>
    {!common && <p>Mixed grids</p>}
    {common && list.map((grid,i)=>{
      const cols = grid.kind === "columns", square = grid.kind === "grid";
      const fixed = grid.align !== "stretch";
      const field = (key:"size"|"count"|"gutter"|"offset",label:string,min:number) => <LayoutNumber {...host}
        variableField={`layoutGrids/${i}/${key}`} label={label} min={min} value={key === "count" && !grid.count && fixed ? undefined : grid[key]} placeholder={key === "count" ? "Auto" : undefined}
        params={value=>params(i,{[key]:key === "count" ? Math.min(1000,Math.max(min,Math.round(value))) : Math.max(min,value)})}/>;
      return <div key={i} className="figcraft-layout-guide" role="group" aria-label={"Guide "+(i+1)}
        onDragOver={e=>{if(drag !== undefined)e.preventDefault();}} onDrop={e=>{
          if (drag !== undefined) {e.preventDefault();move(drag,i);setDrag(undefined);}
        }}>
        <div className="figcraft-style-actions">
          <button type="button" draggable aria-label={"Guide "+(i+1)+" settings"} aria-expanded={open===i}
            onDragStart={e=>{e.dataTransfer.setData("text/plain",String(i));setDrag(i);}} onDragEnd={()=>setDrag(undefined)}
            onClick={()=>setOpen(open===i ? undefined : i)}>Settings</button>
          <select aria-label="Guide type" value={grid.kind} onChange={e=>{
            const kind=e.target.value;
            const fresh=readGrids([kind === "rows" ? {kind,size:0,color:{r:0,g:.4,b:1,a:.1}} : kind === "columns" ? {kind,size:0} : {}])[0];
            set(i,fresh);
          }}><option value="grid">Grid</option><option value="columns">Columns</option><option value="rows">Rows</option></select>
          <button type="button" aria-pressed={grid.visible} aria-label="Guide visibility" onClick={()=>set(i,{visible:!grid.visible})}>{grid.visible ? "Visible" : "Hidden"}</button>
          <button type="button" disabled={i===list.length-1} aria-label="Move guide up" onClick={()=>move(i,i+1)}>↑</button>
          <button type="button" disabled={!i} aria-label="Move guide down" onClick={()=>move(i,i-1)}>↓</button>
          <button type="button" aria-label="Remove guide" onClick={()=>{
            host.dispatch("grid.remove",{ids,index:i});
            setOpen(index=>index === undefined || index === i ? undefined : index>i ? index-1 : index);
          }}>Remove</button>
        </div>
        {open === i && <div className="figcraft-guide-fields">
          {!square && <>
            {field("count","Guide count",fixed ? 0 : 1)}
            <label>Alignment<select aria-label="Guide alignment" value={grid.align} onChange={e=>{
              const align=e.target.value as LayoutGrid["align"];
              set(i,{align,...(align !== "stretch" && grid.size <= 0 && {size:60}),...(align === "stretch" && {count:Math.max(1,grid.count)})});
            }}><option value="stretch">Stretch</option><option value="min">{cols ? "Left" : "Top"}</option><option value="center">Centre</option>
              <option value="max">{cols ? "Right" : "Bottom"}</option></select></label>
          </>}
          {(square || fixed) && field("size",square ? "Grid size" : cols ? "Column width" : "Row height",1)}
          {!square && grid.align !== "center" && field("offset",fixed ? "Guide offset" : "Guide margin",0)}
          {!square && field("gutter","Guide gutter",0)}
          <label>Colour<input aria-label="Guide colour" type="color" value={toCssHex({...grid.color,a:1}).slice(0,7)} onChange={e=>{
            const color=parseColour(e.target.value);
            if (color) set(i,{color:withAlpha(color,grid.color.a)});
          }}/></label>
          <LayoutNumber {...host} label="Guide opacity" value={Math.round(grid.color.a*100)} min={0} suffix="%"
            params={n=>params(i,{color:withAlpha(grid.color,Math.min(1,Math.max(0,n/100)))})}/>
        </div>}
      </div>;
    }).reverse()}
  </fieldset>;
}

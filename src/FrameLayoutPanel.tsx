import { useState } from "react";
import { sameAutoLayout } from "./engine/auto-layout";
import type { Document, NodeId } from "./engine/document";

import { LayoutNumber } from "./LayoutNumber";

export function FrameLayoutPanel({document,selection,enabled,dispatch}: {
  document: Document; selection: readonly NodeId[]; enabled: boolean; dispatch: (command:string, params:unknown) => void;
}) {
  const [individual,setIndividual] = useState(false);
  const first = document.nodes[selection[0]], layout = first?.kind === "frame" ? first.layout : undefined;
  if (!layout || !selection.every(id => {
    const n = document.nodes[id];
    return n?.kind === "frame" && sameAutoLayout(n.layout,layout);
  })) return null;
  const set = (props: Record<string,unknown>) => dispatch("node.set",{ids:selection,props});
  const horizontal = layout.mode !== "vertical", grid = layout.mode === "grid", auto = layout.mainAlign.startsWith("space");
  const spread = !grid && layout.wrap && layout.contentAlign === "spaceBetween";
  const [top,right,bottom,left] = layout.padding;
  const number = (label: string, key: string, value?:number, min?:number, extra?:Record<string,unknown>, placeholder?:string) =>
    <LayoutNumber key={[key,selection.join(),value].join("/")} label={label} value={value} min={min} placeholder={placeholder}
      commit={(n,all) => set({...extra,[all && key.startsWith("padding") ? "padding" : key]:n})}/>;
  const positions = ["min","center","max"] as const;
  return <fieldset aria-label="Auto layout" disabled={!enabled}><legend>Auto layout</legend>
    <div role="group" aria-label="Layout direction">
      {(["vertical","horizontal","grid"] as const).map(mode => <button key={mode} type="button" aria-pressed={layout.mode === mode}
        onClick={() => set({layout:mode})}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}
      {!grid && <button type="button" aria-pressed={layout.wrap} onClick={() => set({wrap:!layout.wrap})}>Wrap</button>}
    </div>
    <div role="group" aria-label="Child alignment" style={{display:"grid",gridTemplateColumns:"repeat(3, 2rem)"}}>
      {positions.flatMap((y,row) => positions.map((x,col) => {
        const main = horizontal ? x : y, cross = horizontal ? y : x;
        const active = (auto || layout.mainAlign === main) && (spread || (layout.crossAlign === "baseline" ? "min" : layout.crossAlign) === cross);
        return <button type="button" key={row*3+col} aria-pressed={active}
          aria-label={["Top","Middle","Bottom"][row]+" "+["left","centre","right"][col]}
          onClick={() => set({mainAlign:auto && !grid ? layout.mainAlign : main,crossAlign:cross})}>{active ? "●" : "·"}</button>;
      }))}
    </div>
    {grid ? <>
      {number("Column gap","columnGap",layout.gap,0)}{number("Row gap","rowGap",layout.crossGap,0)}
      {number("Columns","gridColumns",layout.gridColumns,1)}{number("Rows","gridRows",layout.gridRows,1)}
    </> : <>
      {number("Gap between items","gap",auto ? undefined : layout.gap,undefined,undefined,"Auto")}
      <label>Auto gap<select value={auto ? layout.mainAlign : "min"} onChange={e => set({mainAlign:e.target.value})}>
        <option value="min">Fixed</option><option value="spaceBetween">Space between</option>
        <option value="spaceEvenly">Space evenly</option><option value="spaceAround">Space around</option>
      </select></label>
      {horizontal && <label><input type="checkbox" checked={layout.crossAlign === "baseline"}
        onChange={e => set({crossAlign:e.target.checked ? "baseline" : "min"})}/>Align text baselines</label>}
    </>}
    <button type="button" aria-expanded={individual} onClick={() => setIndividual(!individual)}>Individual padding</button>
    {individual ? <>
      {number("Left padding","paddingLeft",left,0)}{number("Top padding","paddingTop",top,0)}
      {number("Right padding","paddingRight",right,0)}{number("Bottom padding","paddingBottom",bottom,0)}
    </> : <>
      {number("Horizontal padding","paddingHorizontal",left === right ? left : undefined,0,undefined,"Mixed")}
      {number("Vertical padding","paddingVertical",top === bottom ? top : undefined,0,undefined,"Mixed")}
    </>}
    {!grid && layout.wrap && <>
      {number(horizontal ? "Gap between rows" : "Gap between columns","crossGap",spread ? undefined : layout.crossGap,0,{contentAlign:"auto"},"Auto")}
      <label>{horizontal ? "Row gap" : "Column gap"}<select value={layout.contentAlign} onChange={e => set({contentAlign:e.target.value})}>
        <option value="auto">Fixed</option><option value="spaceBetween">Space between</option>
      </select></label>
    </>}
    <label>Strokes<select value={String(layout.strokesIncluded)} onChange={e => set({strokesIncluded:e.target.value === "true"})}>
      <option value="true">Included in layout</option><option value="false">Excluded from layout</option>
    </select></label>
    <label>Canvas stacking<select value={String(layout.reverseZ)} onChange={e => set({reverseZ:e.target.value === "true"})}>
      <option value="false">Last on top</option><option value="true">First on top</option>
    </select></label>
  </fieldset>;
}

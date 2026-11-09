import { layerSizing, sameAutoLayout } from "./engine/auto-layout";
import type { Document, FrameNode, LayerNode, NodeId } from "./engine/document";
import { inspectedGridCell } from "./engine/grid-placement";
import { LayoutNumber, type LayoutFieldHost } from "./LayoutNumber";

const axes = [
  {axis:"horizontal",size:"width",sizing:"sizingH",min:"minWidth",max:"maxWidth"},
  {axis:"vertical",size:"height",sizing:"sizingV",min:"minHeight",max:"maxHeight"},
] as const;

export function ChildLayoutPanel({document,selection,enabled,...host}: LayoutFieldHost & {
  document: Document; selection: readonly NodeId[]; enabled: boolean;
}) {
  const {dispatch} = host;
  if (!selection.length) return null;
  const layers = selection.map(id => document.nodes[id]).filter((n): n is LayerNode => !!n && n.kind !== "page");
  if (!layers.length || layers.length !== selection.length) return null;
  const first = layers[0];
  const parents = layers.map(n => document.nodes[n.parent]);
  const parentLayout = parents.every((p): p is FrameNode => p.kind === "frame" && !!p.layout);
  const frameLayout = first.kind === "frame" && !!first.layout && layers.every(n => n.kind === "frame" && sameAutoLayout(first.layout,n.layout));
  const text = layers.every(n => n.kind === "text");
  if (!parentLayout && !frameLayout && !text) return null;
  const inFlow = parentLayout && layers.every(n => !n.childLayout?.absolute);
  const grid = inFlow && parents.every(p => p.layout?.mode === "grid");
  const cell = grid && layers.length === 1 ? inspectedGridCell(document,parents[0],first.id) : undefined;
  const absolute = layers.every(n => n.childLayout?.absolute);
  const common = <T,>(read: (node: LayerNode) => T) => {
    const value = read(first);
    return layers.every(n => read(n) === value) ? value : undefined;
  };
  const set = (props:Record<string,unknown>) => dispatch("node.set",{ids:selection,props});
  const field = (label:string,value:number | undefined,min:number,props:(n:number)=>Record<string,unknown>) =>
    <LayoutNumber {...host} key={[label,selection.join()].join("/")} label={label} value={value} min={min} placeholder="Mixed" params={n => ({ids:selection,props:props(n)})}/>;
  return <fieldset aria-label="Layout sizing" disabled={!enabled}><legend>Layout sizing</legend>
    {parentLayout && <button type="button" aria-pressed={absolute} onClick={() => set({absolute:!absolute})}>
      {absolute ? "Use auto layout" : "Ignore auto layout (absolute position)"}</button>}
    {axes.map(({axis,size,sizing,min,max}) => {
      const mode = common(n => layerSizing(n)[axis]);
      const hasLimits = layers.some(n => n.childLayout?.[min] !== undefined || n.childLayout?.[max] !== undefined);
      return <div key={size}><label>{size === "width" ? "Width sizing" : "Height sizing"}
        <select aria-label={size === "width" ? "Width sizing" : "Height sizing"} value={mode ?? ""} onChange={e => {
          const key = e.target.value;
          if (key === min || key === max) set({[key]:first[size]});
          else set({[sizing]:key});
        }}>
          {mode === undefined && <option value="" disabled>Mixed</option>}
          <option value="fixed">Fixed</option>
          {(frameLayout || text) && <option value="hug">Hug contents</option>}
          {inFlow && <option value="fill">Fill container</option>}
          {(frameLayout || inFlow) && <>
            {first.childLayout?.[min] === undefined && <option value={min}>Add min {size}</option>}
            {first.childLayout?.[max] === undefined && <option value={max}>Add max {size}</option>}
          </>}
        </select></label>
        {(frameLayout || inFlow) && hasLimits && <>
          {([min,max] as const).map((key,index) => {
            const name = (index ? "Max " : "Min ")+size;
            return layers.some(n => n.childLayout?.[key] !== undefined)
              ? field(name,common(n=>n.childLayout?.[key]),0,n=>({[key]:n}))
              : <button key={key} type="button" onClick={()=>set({[key]:first[size]})}>Add {name.toLowerCase()}</button>;
          })}
          <button type="button" onClick={() => set({[min]:null,[max]:null})}>Remove min and max {size}</button>
        </>}
      </div>;
    })}
    {grid && <fieldset><legend>Grid cell</legend>
      {cell && <>
        {field("Column",cell.column+1,1,n=>({gridColumn:n-1,gridRow:cell.row}))}
        {field("Row",cell.row+1,1,n=>({gridColumn:cell.column,gridRow:n-1}))}
        {(first.childLayout?.gridColumn !== undefined || first.childLayout?.gridRow !== undefined) &&
          <button type="button" onClick={() => set({gridColumn:null,gridRow:null})}>Place automatically</button>}
      </>}
      {field("Column span",common(n=>Math.max(1,n.childLayout?.gridColumnSpan ?? 0)),1,n=>({gridColumnSpan:n}))}
      {field("Row span",common(n=>Math.max(1,n.childLayout?.gridRowSpan ?? 0)),1,n=>({gridRowSpan:n}))}
      {(["gridAlignH","gridAlignV"] as const).map(key => {
        const horizontal = key === "gridAlignH", val = common(n=>n.childLayout?.[key] ?? "auto");
        return <label key={key}>{horizontal ? "Horizontal align" : "Vertical align"}
          <select aria-label={horizontal ? "Horizontal align" : "Vertical align"} value={val ?? ""} onChange={e=>set({[key]:e.target.value})}>
            {val === undefined && <option value="" disabled>Mixed</option>}
            <option value="auto">Auto</option><option value="min">{horizontal ? "Left" : "Top"}</option>
            <option value="center">Centre</option><option value="max">{horizontal ? "Right" : "Bottom"}</option>
          </select></label>;
      })}
    </fieldset>}
  </fieldset>;
}

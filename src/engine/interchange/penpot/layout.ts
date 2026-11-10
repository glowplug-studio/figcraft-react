import { type AutoLayout, type GridTrack, layerSizing, wireAutoLayout, wireChildLayout } from "../../auto-layout";
import { isFrameLike, type LayerNode } from "../../document";
import { children, entries, object, string, type JsonObject } from "../rest/values";
import { numberField as num, records, fingerprint } from "./values";

type Warn = (s: string) => void;
const sizing = (x: unknown) => x === "auto" || x === "hug" ? "hug" : x === "fill" ? "fill" : "fixed";
const align = (x: unknown) => x === "end" ? "max" : x === "center" ? "center" : "min";
const main = (x: unknown) => x === "space-between" ? "spaceBetween" : x === "space-around" ? "spaceAround" : x === "space-evenly" ? "spaceEvenly" : align(x);
const sides = ["p1", "p2", "p3", "p4"];
const gridKeys = new Set(["grid_columns","grid_rows","grid_column","grid_row","grid_column_span","grid_row_span"]);

function tracks(list: JsonObject[]) {
  const result: GridTrack[] = [];
  for (const track of list) {
    if (track.type === "auto") result.push({sizing:"hug",value:0});
    else if (track.type === "fixed") result.push({sizing:"fixed",value:Math.max(0,num(track,"value",0))});
    else if (track.type === "flex") result.push({sizing:"fill",value:Math.max(.001,num(track,"value",1))});
    else return;
  }
  return result;
}

export function autoLayout(raw: JsonObject, warn: Warn): AutoLayout | undefined {
  const mode = string(raw.layout) ?? string(raw.layoutMode);
  if (mode === undefined) return;
  const cols = records(raw.layoutGridColumns), rows = records(raw.layoutGridRows), pad = object(raw.layoutPadding);
  const reason = ["row-reverse","column-reverse"].includes(String(raw.layoutFlexDir)) ? "reverse flow" :
    raw.layoutAlignItems === "stretch" ? "stretch alignment" :
    raw.layoutWrapType === "wrap" && ["space-around","space-evenly"].includes(String(raw.layoutAlignContent)) ? "wrapped-line distribution" :
    sides.some(k=>num(pad,k,0)<0) ? "negative padding" : [...cols,...rows].some(t=>t.type==="percent") ? "percentage tracks" : undefined;
  if (reason) {warn("Penpot " + reason + " is unsupported; saved positions and source metadata were kept");return;}
  const gap = object(raw.layoutGap), rowGap = num(gap,"rowGap",0,0,1e5), columnGap = num(gap,"columnGap",0,0,1e5);
  const base = {padding: sides.map(k=>num(pad,k,0,0,1e5)) as [number,number,number,number], crossAlign: align(raw.layoutAlignItems),
    strokesIncluded:false, mainAlign:main(raw.layoutJustifyContent), gap:columnGap, crossGap:rowGap, wrap:false, reverseZ:false,
    contentAlign:"auto", gridColumns:2, gridRows:2, columnTracks:[], rowTracks:[]} as const;
  if (mode === "flex") {
    const vertical = raw.layoutFlexDir === "column";
    if (!vertical && typeof raw.layoutFlexDir === "string" && raw.layoutFlexDir !== "row") {warn("Unknown Penpot flex direction retained at absolute positions");return;}
    const wrap = raw.layoutWrapType === "wrap";
    return {...base, mode: vertical ? "vertical" : "horizontal", wrap, gap: vertical ? rowGap : columnGap,
      crossGap: vertical ? columnGap : rowGap, contentAlign: wrap && raw.layoutAlignContent === "space-between" ? "spaceBetween" : "auto", reverseZ:true};
  }
  if (mode !== "grid") {warn("Unsupported Penpot layout '" + mode + "' retained at absolute positions");return;}
  if (!cols.length || !rows.length || cols.length > 256 || rows.length > 256) {warn("Unsupported Penpot grid dimensions; positions kept");return;}
  const columnTracks = tracks(cols), rowTracks = tracks(rows);
  if (!columnTracks || !rowTracks) {warn("Unsupported Penpot grid " + (!columnTracks ? "column" : "row") + " tracks; positions kept");return;}
  return {...base, mode:"grid", mainAlign:main(raw.layoutJustifyItems), gridColumns:cols.length,gridRows:rows.length,columnTracks,rowTracks};
}

export function cells(layer: JsonObject) {
  const map = new Map<string,JsonObject>();
  for (const [,v] of entries(layer.layoutGridCells)) {
    const cell = object(v);
    for (const id of children(cell.shapes)) if (typeof id === "string" && !map.has(id)) map.set(id, cell);
  }
  return map;
}

export function childLayout(raw: JsonObject, cell: JsonObject | undefined, meta: Record<string,string>) {
  const margins = object(raw.layoutItemMargin), self = string(raw.layoutItemAlignSelf);
  if (["m1","m2","m3","m4"].some(k=>num(margins,k,0)!==0) || self !== undefined && self !== "auto") meta["penpot.unsupported.itemLayout"]="true";
  if (self !== undefined && !["auto","start","flex-start","center","end","flex-end","stretch","baseline"].includes(self)) meta["penpot.unsupported.alignSelf"]="true";
  const nullable = (key:string) => Object.hasOwn(raw,key) ? Math.max(0,num(raw,key,0)) : null;
  const slot = (key:string, offset:number) => {
    const value = cell?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < offset || value-offset > 0xffffffff) return;
    return value-offset;
  };
  const alignment = (v:unknown) => ["start","center","end"].includes(String(v)) ? align(v) : undefined;
  return {sizing_h:sizing(raw.layoutItemHSizing),sizing_v:sizing(raw.layoutItemVSizing),absolute:raw.layoutItemAbsolute===true,
    min_w:nullable("layoutItemMinW"),max_w:nullable("layoutItemMaxW"),min_h:nullable("layoutItemMinH"),max_h:nullable("layoutItemMaxH"),
    grid_column:slot("column",1) ?? null,grid_row:slot("row",1) ?? null,
    grid_column_span:cell ? Math.max(1,slot("columnSpan",0) ?? 1) : 0,grid_row_span:cell ? Math.max(1,slot("rowSpan",0) ?? 1) : 0,
    ...(alignment(cell?.justifySelf) && {grid_align_h:alignment(cell?.justifySelf)}), ...(alignment(cell?.alignSelf) && {grid_align_v:alignment(cell?.alignSelf)})};
}

function stretch(tracks: readonly GridTrack[], kids: readonly LayerNode[], horizontal: boolean, inner: number, gap: number) {
  if (tracks.some(t=>t.sizing === "fill")) return tracks;
  const sizes = tracks.map(t=>t.sizing === "fixed" ? t.value : 0);
  for (const n of kids) {
    const index = horizontal ? n.childLayout?.gridColumn : n.childLayout?.gridRow;
    const span = horizontal ? n.childLayout?.gridColumnSpan : n.childLayout?.gridRowSpan;
    if (index !== undefined && tracks[index]?.sizing === "hug" && (span ?? 0) <= 1 && layerSizing(n)[horizontal ? "horizontal" : "vertical"] !== "fill")
      sizes[index]=Math.max(sizes[index],horizontal ? n.width : n.height);
  }
  const count = tracks.filter(t=>t.sizing==="hug").length;
  const share = (inner - sizes.reduce((a,b)=>a+b,0) - gap*Math.max(0,tracks.length-1))/count;
  if (!count || !Number.isFinite(share) || share<=0) return tracks;
  return tracks.map((t,i)=>t.sizing==="hug" ? {sizing:"fill" as const,value:sizes[i]+share} : t);
}

export function finishLayout(frame: LayerNode, layout: AutoLayout | undefined, children: LayerNode[], raw: JsonObject, warn: Warn) {
  if (!layout) return;
  const kids = children.filter(c=>!c.childLayout?.absolute);
  if (kids.some(n=>n.sourceMetadata?.["penpot.unsupported.itemLayout"])) {
    warn("Penpot item margins or self-alignment are unsupported; saved positions and source metadata were kept");return;
  }
  if (layout.mode !== "grid") {
    const axis = layout.mode === "horizontal" ? "horizontal" : "vertical";
    return layout.mainAlign.startsWith("space") && kids.some(n=>layerSizing(n)[axis] === "fill") ? {...layout,mainAlign:"min" as const} : layout;
  }
  const [pt,pr,pb,pl] = layout.padding;
  return {...layout, columnTracks:raw.layoutJustifyContent==="stretch" && layerSizing(frame).horizontal!=="hug" ?
    stretch(layout.columnTracks,kids,true,frame.width-pl-pr,layout.gap) : layout.columnTracks,
    rowTracks:raw.layoutAlignContent==="stretch" && layerSizing(frame).vertical!=="hug" ?
    stretch(layout.rowTracks,kids,false,frame.height-pt-pb,layout.crossGap) : layout.rowTracks};
}

export function layoutFingerprint(node: LayerNode, kids: LayerNode[]) {
  const children = kids.map(n=>[n.sourceMetadata?.["penpot.id"] ?? null, wireChildLayout(n.childLayout,layerSizing(n)) ?? childLayout({},undefined,{})]);
  return fingerprint({layout:isFrameLike(node) && node.layout ? wireAutoLayout(node.layout) : null, children}, gridKeys);
}

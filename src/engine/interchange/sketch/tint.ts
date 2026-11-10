import { children, clamp, numeric, object, type JsonObject } from "../rest/values";
import type { SketchNode } from "./geometry";

export function isRecord(value: unknown): value is SketchNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const byteLength = (s:string) => /^[\x00-\x7F]*$/.test(s) ? s.length : new TextEncoder().encode(s).length;
export function sketchWeight(input:unknown, depth=0):number {
  if (depth>256) return 1;
  if (typeof input==="string") return 1+Math.floor(byteLength(input)/8);
  let cost=1;
  if (Array.isArray(input)) for (const v of input) cost+=sketchWeight(v,depth+1);
  else if (isRecord(input)) for (const key of Object.keys(input)) cost+=Math.floor(byteLength(key)/8)+sketchWeight(input[key],depth+1);
  return cost;
}
export function sketchTint(layer: JsonObject, legacy: boolean) {
  const f=children(object(layer.style).fills).map(object).find(p=>p.isEnabled!==false && (Number.isInteger(p.layeringType) ? p.layeringType===1 : legacy));
  if (f && (!Number.isInteger(f.fillType) || f.fillType===0) && isRecord(f.color)) return f.color;
}
export function setSketchTint(node:SketchNode, colour:JsonObject) {
  if (!Object.hasOwn(node,"style")) node.style={_class:"style"};
  if (isRecord(node.style)) node.style.fills=[{_class:"fill",isEnabled:true,fillType:0,color:colour}];
}
export function tintSketchLayers(layers:readonly unknown[], tint:JsonObject, depth=0) {
  if (depth>64) return;
  const alpha=(v:unknown)=>clamp(numeric(object(v).alpha) ?? 1,0,1);
  const tinted=(v:unknown)=>({...tint,alpha:alpha(tint)*alpha(v)});
  const text=(attrs:unknown)=>{if (isRecord(attrs)) attrs.MSAttributedStringColorAttribute=tinted(attrs.MSAttributedStringColorAttribute);};
  for (const l of layers) {
    if (!isRecord(l)) continue;
    const style=object(l.style);
    for (const key of ["fills","borders"]) for (const p of children(style[key])) {
      if (isRecord(p) && p.isEnabled!==false && p.fillType!==4) Object.assign(p,{fillType:0,color:tinted(p.color)});
    }
    text(object(style.textStyle).encodedAttributes);
    for (const r of children(object(l.attributedString).attributes)) text(object(r).attributes);
    if (l._class==="symbolInstance") setSketchTint(l,tint);
    tintSketchLayers(children(l.layers),tint,depth+1);
  }
}

import {items,num,obj,paints} from "./fields";
import {figRegionFills} from "../rest/vector";
import type {KiwiValue,KiwiObject} from "./kiwi";

import {readNetworkBlob} from "./network-blob";
const caps=(name:KiwiValue|undefined)=>name==="ARROW_LINES" ? "LINE_ARROW" : name==="ARROW_EQUILATERAL" ? "TRIANGLE_ARROW" : name;
const join=(value:KiwiValue|undefined)=>value==="MITER" || value==="BEVEL" || value==="ROUND" ? value.toLowerCase() : undefined;
const mirror=(value:KiwiValue|undefined)=>value==="ANGLE" ? "angle" : value==="ANGLE_AND_LENGTH" ? "angleAndLength" : value==="NONE" ? "none" : undefined;

export function vectorNetwork(n:KiwiObject,out:Record<string,unknown>,blobs:(KiwiValue|undefined)[],warn:(s:string)=>void,paintBudget:{remaining:number}) {
  const data=obj(n.vectorData),index=num(data.vectorNetworkBlob);
  const bytes=index!==undefined && blobs[index];
  if (!(bytes instanceof Uint8Array)) return false;
  const net=readNetworkBlob(bytes);
  if (!net) {warn("damaged vector networks import as outlines");return false;}
  const styleTable=new Map<number,KiwiObject>();
  for (const v of items(data.styleOverrideTable)) {const s=obj(v),id=num(s.styleID);if (id) styleTable.set(id,s);}
  const axis=(name:string)=>{const extent=num(obj(n.size)[name]),norm=num(obj(data.normalizedSize)[name]);return extent!==undefined && norm!==undefined && norm>1e-9 ? extent/norm : 1;};
  const kx=axis("x"), ky=axis("y");
  const {regions}=net;
  const styles=net.vertices.map(v=>v.style),degree=new Uint32Array(net.vertices.length);
  let missingPoint=false,unknownJoin=false,specialJoin=false,missingSegment=false,styledSegment=false;
  const vertices=net.vertices.map(v=>{
    const id=v.style,style=styleTable.get(id),r=num(style?.cornerRadius),j=join(style?.strokeJoin);
    if (id && !style) missingPoint=true;
    if (style?.strokeJoin!==undefined && !j) unknownJoin=true;
    if (j && style?.strokeJoin!==(n.strokeJoin ?? "MITER")) specialJoin=true;
    return {x:v.x*kx,y:v.y*ky,...(r!==undefined && r>0 && {radius:r}),mirror:mirror(style?.handleMirroring),join:j};
  });
  const segments=net.segments.map(s=>{
    degree[s.a]++;degree[s.b]++;
    if (s.style) {if (styleTable.has(s.style)) styledSegment=true;else missingSegment=true;}
    return {a:s.a,b:s.b,ta:[s.ta.x*kx,s.ta.y*ky],tb:[s.tb.x*kx,s.tb.y*ky]};
  });
  if (styledSegment) warn("style settings of some vector segments aren't supported; those segments use the layer's stroke");
  if (missingSegment) warn("some vector segments refer to style settings missing from the file; they use the layer's stroke");
  const hasFill=Array.isArray(out.fills) && out.fills.some(p=>p.visible!==false);
  if (!segments.length || !regions.length && hasFill && out.fillGeometry) return false;
  const converted=regions.map(({style,winding,loops})=>{
    const region:{winding:string;loops:number[][];[figRegionFills]?:unknown}={winding,loops};
    if (!style) return region;
    const record=styleTable.get(style);
    if (!record) {warn("vector region references a missing fill style; layer fill used");return region;}
    if (record.fillPaints===undefined) return region;
    if (!Array.isArray(record.fillPaints)) {warn("invalid vector region fill paint list; layer fill used");return region;}
    const source=record.fillPaints,cost=source.length+source.reduce((total:number,p)=>total+items(obj(p).stops).length,0);
    if (source.length>256 || source.some(p=>items(obj(p).stops).length>256) || cost>paintBudget.remaining) {
      warn("vector region paint data exceeded import limits and was skipped");return region;
    }
    paintBudget.remaining-=cost;
    const mapped=paints(source,warn);
    if (mapped.length!==source.length) warn("invalid vector region paints were skipped");
    if (source.some(p=>obj(p).colorVar || items(obj(p).stopsVar).some(s=>obj(s).colorVar))) warn("variable-bound vector region paints keep resolved appearance; live bindings were left out");
    if (record.styleIdForFill) warn("linked vector region fill styles keep resolved appearance; live style links were left out");
    region[figRegionFills]=mapped;
    return region;
  });
  if (missingPoint) warn("some vector points refer to point settings missing from the file; they use the layer's joins and plain corners");
  if (unknownJoin) warn("vector points with unknown stroke joins use the layer join");
  if (specialJoin && (items(n.dashPattern).length || items(n.variableWidthPoints).length)) warn("point stroke joins were preserved; dashed or variable-width strokes render with the layer join");
  const first=degree.indexOf(1),last=degree.lastIndexOf(1),a=styleTable.get(styles[first])?.strokeCap,b=styleTable.get(styles[last])?.strokeCap;
  if (a!==undefined || b!==undefined) {out.strokeCapStart=caps(a ?? n.strokeCap ?? "NONE");out.strokeCapEnd=caps(b ?? n.strokeCap ?? "NONE");}
  out.vectorNetwork={vertices,segments,regions:converted};
  return true;
}

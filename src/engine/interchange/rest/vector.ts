import type { PathCommand } from "../../corners";
import { parseSvgPath } from "../../svg-path";
import { readVectorNetwork, wireVectorNetwork } from "../../vector-codec";
import { networkFromPath, sanitiseNetwork } from "../../vector-network";
import { pathBounds } from "../../vector-path";
import { children, clamp, list, maximumCoordinate, maximumSize, object, string, type ImportWarnings, type JsonObject } from "./values";
import {restPaints,type ImportImages} from "./paint";
import type { Paint } from "../../solid-paint";

export const figRegionFills=Symbol("Fig vector region paints");
const limit=200000;
function geometry(input:unknown,warnings:ImportWarnings) {
  const commands:PathCommand[]=[];
  let winding:"nonZero"|"evenOdd"|undefined;
  for (const value of list(input)) {
    const p=object(value), d=string(p.path);
    if (d===undefined) continue;
    if (d.length>4*1024*1024 || /[^\x00-\x7f]/.test(d) && new TextEncoder().encode(d).length>4*1024*1024) {warnings.add("very long vector paths were skipped");continue;}
    try {
      const part=parseSvgPath(d);
      if (commands.length+part.length>limit) throw new Error();
      const b=pathBounds(part);
      if (b && [b.x,b.y,b.x+b.width,b.y+b.height].some(n=>Math.abs(n)>maximumCoordinate)) throw new Error();
      winding??=p.windingRule==="EVENODD" ? "evenOdd" : "nonZero";
      for (const command of part) commands.push(command);
    } catch {warnings.add("invalid or oversized vector path data was skipped");}
  }
  if (commands.length) return {commands,winding:winding ?? "nonZero"};
}
function editable(input:unknown,images:ImportImages,warnings:ImportWarnings) {
  const raw=object(input),regions=children(raw.regions);
  let size=children(raw.vertices).length+children(raw.segments).length;
  if (size>limit) return;
  for (const r of regions) {
    for (const loop of children(object(r).loops)) size+=children(loop).length;
    if (size>limit) return;
  }
  const net=readVectorNetwork({...raw,regions:regions.map(r=>{const p=object(r) as Readonly<Record<PropertyKey,unknown>>;return {loops:p.loops,winding:p.winding,...(Array.isArray(p[figRegionFills]) && {fills:restPaints(p[figRegionFills],images,warnings)})};})});
  if (net.vertices.some(p=>[p.x,p.y,p.radius].some(n=>Math.abs(n)>maximumCoordinate)) ||
      net.segments.some(s=>[...s.ta,...s.tb].some(n=>Math.abs(n)>maximumCoordinate))) return;
  const result=sanitiseNetwork({...net,vertices:net.vertices.map(p=>({...p,radius:clamp(p.radius,0,maximumSize)}))});
  return result.segments.length ? result : undefined;
}
export function vectorFields(n:JsonObject,properties:{fills:Paint[];strokes:Paint[];stroke:{weight:number}},warnings:ImportWarnings,images:ImportImages) {
  if (Object.hasOwn(n,"vectorNetwork") || Object.hasOwn(n,"vectorNetworkRef")) {
    try {
      const net=editable(n.vectorNetwork,images,warnings);
      if (net) return {network:wireVectorNetwork(net)};
    } catch { /* Malformed networks fall back to the REST outlines. */ }
    warnings.add("invalid or oversized vector networks import as outlines");
  }
  const fill=geometry(n.fillGeometry,warnings), stroke=geometry(n.strokeGeometry,warnings);
  const useStroke=Boolean(stroke && (!fill || properties.strokes.some(p=>p.visible) && properties.stroke.weight>0 && !properties.fills.some(p=>p.visible)));
  const chosen=useStroke ? stroke : fill;
  if (!chosen) warnings.add("vectors without geometry are empty (export the file JSON with geometry=paths)");
  const net=networkFromPath(chosen?.commands ?? []);
  const network=wireVectorNetwork({...net,regions:net.regions.map(region=>({...region,winding:chosen?.winding ?? "nonZero"}))});
  return {network,...(useStroke && {fills:properties.strokes,strokes:[]})};
}

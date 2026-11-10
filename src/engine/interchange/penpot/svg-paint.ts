import { identity, inverse, multiply, type Affine } from "../../affine";
import { withAlpha } from "../../colour";
import { type Gradient, type GradientHandle } from "../../gradient";
import { children, clamp, entries, object, string, type JsonObject } from "../rest/values";
import { rootId } from "./archive";
import { hex, numberField } from "./values";

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function length(value: unknown, fallback: number, user = false): number {
  if (typeof value !== "string") return user ? NaN : fallback;
  const raw = value.trim();
  const percent = !user && raw.endsWith("%");
  const token = user ? raw.replace(/(?:px)+$/, "") : percent ? raw.slice(0, -1).trim() : raw;
  const n = decimal.test(token) ? Number(token) / (percent ? 100 : 1) : NaN;
  return Math.abs(n) <= (user ? 1e6 : 1e4) ? n : NaN;
}

function transform(value: string): Affine | undefined {
  let m = identity, rest = value.trim();
  while (rest) {
    const match = /^,*\s*(\w+)\s*\(([^()]*)\)/.exec(rest);
    if (!match) return;
    const args = match[2].split(/[\s,]+/).filter(Boolean);
    if (!args.every(a => decimal.test(a) && Number.isFinite(Number(a)))) return;
    const [x,y,z] = args.map(Number), radians = x * Math.PI / 180;
    let step: Affine;
    switch (match[1]) {
      case "translate": if (args.length < 1 || args.length > 2) return; step = [1,0,0,1,x,y ?? 0]; break;
      case "scale": if (args.length < 1 || args.length > 2) return; step = [x,0,0,y ?? x,0,0]; break;
      case "rotate":
        if (args.length !== 1 && args.length !== 3) return;
        step = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
        if (args.length === 3) step = multiply([1,0,0,1,y,z],multiply(step,[1,0,0,1,-y,-z]));
        break;
      case "skewX": if (args.length !== 1) return; step = [1,0,Math.tan(radians),1,0,0]; break;
      case "skewY": if (args.length !== 1) return; step = [1,Math.tan(radians),0,1,0,0]; break;
      case "matrix": if (args.length !== 6) return; step = [x,y,z,Number(args[3]),Number(args[4]),Number(args[5])]; break;
      default: return;
    }
    m = multiply(m, step);
    rest = rest.slice(match[0].length).trim();
  }
  return m;
}

function svgStop(node: JsonObject) {
  const a = object(node.attrs), style = object(a.style);
  const css = new Map<string,string>();
  for (const pair of (string(a.style) ?? "").split(";")) {
    const i = pair.indexOf(":");
    if (i < 0) continue;
    const key = pair.slice(0,i).trim();
    if (!css.has(key)) css.set(key,pair.slice(i+1).trim());
  }
  const c = hex(string(a["stop-color"]) ?? string(a.stopColor) ?? string(style.stopColor) ?? css.get("stop-color"));
  const pos = length(a.offset,numberField(a,"offset",0));
  if (!c || !Number.isFinite(pos)) return;
  const alpha = string(a["stop-opacity"]) ?? string(a.stopOpacity) ?? string(style.stopOpacity) ?? css.get("stop-opacity");
  const opacity = alpha && decimal.test(alpha) ? Number(alpha) : numberField(a,"stop-opacity",numberField(a,"stopOpacity",1));
  return {position:Math.fround(clamp(pos,0,1)),color:withAlpha(c,c.a*clamp(opacity,0,1))};
}

function gradient(radial: boolean, attrs: JsonObject, node: JsonObject, toUnit?: Affine): Gradient | undefined {
  if (typeof attrs.spreadMethod === "string" && attrs.spreadMethod !== "pad") return;
  const user = attrs.gradientUnits === "userSpaceOnUse";
  if (!user && typeof attrs.gradientUnits === "string" && attrs.gradientUnits !== "objectBoundingBox" || user && !toUnit) return;
  const coord = (k:string, d:number) => length(attrs[k],d,user);
  let from:GradientHandle,to:GradientHandle,width:GradientHandle;
  if (radial) {
    const x=coord("cx",.5),y=coord("cy",.5),r=coord("r",.5);
    const fx = typeof attrs.fx === "string" ? coord("fx",x) : x, fy = typeof attrs.fy === "string" ? coord("fy",y) : y;
    if (!(r>0 && Math.abs(fx-x)<=1e-6 && Math.abs(fy-y)<=1e-6)) return;
    from=[x,y];to=[x+r,y];width=[x,y+r];
  } else {
    const x=coord("x1",0),y=coord("y1",0),x2=coord("x2",1),y2=coord("y2",0);
    from=[x,y];to=[x2,y2];width=[x-(y2-y),y+x2-x];
  }
  let space = transform(string(attrs.gradientTransform) ?? "");
  if (!space) return;
  if (user) space=multiply(toUnit!,space);
  const handles=[from,to,width].map(([x,y]):GradientHandle=>[space[0]*x+space[2]*y+space[4],space[1]*x+space[3]*y+space[5]]);
  if (handles.some(p=>p.some(v=>!(Math.abs(v)<=1e6)))) return;
  const stops=[];
  for (const raw of children(node.content).slice(0,128).map(object)) {
    if (raw.tag!=="stop") continue;
    const stop=svgStop(raw);
    if (!stop) return;
    stops.push(stop);
  }
  if (!stops.length) return;
  return {kind:radial?"radial":"linear",from:handles[0],to:handles[1],width:handles[2],stops:stops.sort((a,b)=>a.position-b.position)};
}

type Visit = (node:JsonObject,key?:string)=>void;
function walk(value:unknown,visit:Visit,full:()=>boolean,depth=0,key?:string) {
  if (depth>32 || full()) return;
  const node=object(value);
  visit(node,key);
  if (Array.isArray(value)) {
    for (const item of value.slice(0,1024)) walk(item,visit,full,depth+1);
  } else if (Object.hasOwn(node,"content")) walk(node.content,visit,full,depth+1);
  else for (const [k,v] of entries(node).slice(0,1024)) walk(v,visit,full,depth+1,k);
}
const isGradient = (n:JsonObject)=>n.tag==="linearGradient" || n.tag==="radialGradient";
const href = (a:JsonObject)=>(string(a.xlinkHref) ?? string(a.href) ?? string(a["xlink:href"]))?.trim().match(/^#(.*)$/)?.[1];

export class SvgPaintServers {
  private shared=new Map<string,Gradient>();
  constructor(shapes:ReadonlyMap<string,JsonObject>) {
    let count=0;
    const seen=new Set<string>();
    for (const id of [...shapes.keys()].sort()) {
      if (count>8192) break;
      const shape=shapes.get(id)!;
      for (const key of ["content","svgDefs"]) if (Object.hasOwn(shape,key)) {
        walk(shape[key], node=>{
          count++;
          const attrs=object(node.attrs), id=string(attrs.id);
          if (!isGradient(node) || !id || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(id) || href(attrs)!==undefined) return;
          const paint=this.convert(node.tag==="radialGradient",attrs,node);
          if (!paint) return;
          if (seen.has(id)) this.shared.delete(id);
          else {seen.add(id);this.shared.set(id,paint);}
        },()=>count>8192);
      }
    }
  }

  // Malformed or overflowing SVG transforms leave the original attribute on the layer.
  private convert(radial:boolean,attrs:JsonObject,node:JsonObject,unit?:Affine) {
    try { return gradient(radial,attrs,node,unit); } catch { return undefined; }
  }

  resolve(id:string,shape:JsonObject,absolute:Affine,x:number,y:number,w:number,h:number) {
    const local=new Map<string,JsonObject>();
    walk(shape.svgDefs,(node,key)=>{
      const name=string(object(node.attrs).id) ?? key;
      if (isGradient(node) && name!==undefined && !local.has(name)) local.set(name,node);
    },()=>local.size>1024);
    let node=local.get(id);
    if (!node) return this.shared.get(id);
    const radial=node.tag==="radialGradient",visited=new Set<string>(), attrs:Record<string,unknown>=Object.create(null);
    let stops:JsonObject | undefined;
    for (let depth=0;node && depth<8;depth++) {
      if (!node.attrs || typeof node.attrs!=="object" || Array.isArray(node.attrs)) return;
      const own=object(node.attrs);
      for (const [k,v] of Object.entries(own)) if (!Object.hasOwn(attrs,k)) attrs[k]=v;
      if (!stops && children(node.content).some(n=>object(n).tag==="stop")) stops=node;
      visited.add(string(own.id) ?? id);
      const parent=href(own);
      node=parent!==undefined && !visited.has(parent) ? local.get(parent) : undefined;
    }
    if (!stops) return;
    const t=object(shape.svgTransform),n=(k:string,d:number)=>numberField(t,k,d);
    const saved:Affine=[n("a",1),n("b",0),n("c",0),n("d",1),n("e",0),n("f",0)];
    const localSpace:Affine=shape.type==="path" ? inverse(absolute) : [1,0,0,1,-x,-y];
    return this.convert(radial,attrs,stops,multiply(multiply([1/w,0,0,1/h,0,0],localSpace),saved));
  }
}

export function svgFillSource(shape:JsonObject,shapes:ReadonlyMap<string,JsonObject>) {
  const attrs=object(shape.svgAttrs),style=string(object(attrs.style).fill),attr=string(attrs.fill);
  const reference=(style ?? attr)?.trim().match(/^url\(#([\s\S]*)\)$/)?.[1].trim();
  let fills:readonly unknown[] | undefined;
  if (style!==undefined) {
    if (hex(style)) fills=[{fillColor:style}];
  } else if (!children(shape.fills).length) {
    fills=[];
    if (attr!==undefined) fills=[{fillColor:attr}];
    else {
      let parent=string(shape.parentId);
      for (let depth=0;parent && parent!==rootId && depth<128;depth++) {
        const p=shapes.get(parent);
        if (!p || p.type==="frame" || p.type==="bool") break;
        if (children(p.fills).length) {fills=children(p.fills).slice(0,1);break;}
        if ((p.type==="group" || p.type==="svg-raw") && Object.hasOwn(p,"svgAttrs")) {fills=[{fillColor:"#000000"}];break;}
        parent=string(p.parentId);
      }
    }
  }
  return {fills,reference:reference && new TextEncoder().encode(reference).length<=200 ? reference : undefined};
}

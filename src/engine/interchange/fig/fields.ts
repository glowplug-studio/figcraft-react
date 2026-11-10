import { identity, transformPoint, type Affine } from "../../affine";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { KiwiObject, KiwiValue } from "./kiwi";

export const obj = (v: KiwiValue | undefined): KiwiObject =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) ? v : {};
export const items = (v: KiwiValue | undefined): KiwiValue[] => Array.isArray(v) ? v : [];
export const num = (v: KiwiValue | undefined) => {
  const n = typeof v === "bigint" || typeof v === "boolean" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
export function guid(v: KiwiValue | undefined) {
  const o = obj(v), s = num(o.sessionID), l = num(o.localID);
  if (s !== undefined && l !== undefined) return Math.max(0, Math.trunc(s)) + ":" + Math.max(0, Math.trunc(l));
}
export function matrix(v: KiwiValue | undefined): Affine | undefined {
  const m = obj(v), values = [m.m00,m.m10,m.m01,m.m11,m.m02,m.m12].map(num);
  if (values.every((x): x is number => x !== undefined)) return [values[0],values[1],values[2],values[3],values[4],values[5]];
}
export const rows = ([a,b,c,d,e,f]: Affine) => [[a,c,e],[b,d,f]];
export function colour(v: KiwiValue | undefined) {
  const c = obj(v);
  return {r:num(c.r) ?? 0, g:num(c.g) ?? 0, b:num(c.b) ?? 0, a:num(c.a) ?? 1};
}
export function bound(v: KiwiValue | undefined, fields: Record<string,string>) {
  const o=obj(v), result:Record<string,unknown>={};
  for (const [key,field] of Object.entries(fields)) {
    const binding=obj(o[key]);
    if (binding.dataType!=="ALIAS") continue;
    const value=obj(binding.value), id=guid(obj(value.alias).guid);
    if (id) result[field]={type:"VARIABLE_ALIAS",id};
  }
  return Object.keys(result).length ? result : undefined;
}

export function paints(values: KiwiValue | undefined, warn:(note:string)=>void) {
  return items(values).flatMap(value => {
    const p=obj(value),type=p.type;
    if (typeof type !== "string") return [];
    const out:Record<string,unknown> = {type,visible:p.visible,opacity:p.opacity,blendMode:p.blendMode};
    const t=matrix(p.transform);
    if (type==="SOLID") {
      if (p.color) out.color=colour(p.color);
      out.boundVariables=bound(p,{colorVar:"color"});
    } else if (type.startsWith("GRADIENT_")) {
      let inv=identity;
      if (t) {
        const [a,b,c,d,e,f]=t, det=a*d-b*c;
        if (Math.abs(det)>1e-12) {
          const r=1/det;
          inv=[r*d,-r*b,-r*c,r*a,r*(c*f-d*e),r*(b*e-a*f)];
        }
      }
      const linear=type==="GRADIENT_LINEAR";
      out.gradientHandlePositions=[[linear?0:.5,.5],[1,.5],[linear?0:.5,1]].map(([x,y])=>transformPoint(inv,{x,y}));
      const vars=items(p.stopsVar);
      out.gradientStops=items(p.stops).map((v,i)=>{
        const s=obj(v);return {position:num(s.position) ?? 0,color:s.color && colour(s.color),boundVariables:bound(vars[i],{colorVar:"color"})};
      });
    } else if (type==="IMAGE") {
      const hash=obj(p.image).hash;
      out.imageRef=hash instanceof Uint8Array && hash.length<=64 ? bytesToHex(hash) : "";
      out.scaleMode=p.imageScaleMode ?? "FILL";
      if (t && out.scaleMode==="STRETCH") out.imageTransform=rows(t);
      out.scalingFactor=p.scale;out.rotation=p.rotation;
      if (p.filterColorAdjust!==undefined) warn(p.paintFilter!==undefined ?
        "image filters are ambiguous because both filter containers are present; filter conversion was skipped" :
        "legacy image filter container is unsupported; filter conversion was skipped");
      else if (p.paintFilter!==undefined) {
        const filters:Record<string,number>={};
        if (typeof p.paintFilter!=="object" || Array.isArray(p.paintFilter) || p.paintFilter instanceof Uint8Array) warn("malformed image paintFilter container was skipped");
        else for (const [key,val] of Object.entries(p.paintFilter)) {
          const known=["exposure","contrast","vibrance","temperature","tint","highlights","shadows"].includes(key);
          const n=typeof val==="boolean" ? undefined : num(val);
          if (n===undefined || !known && n!==0) {
            const reason=n===undefined ? "malformed "+(known?"":"unsupported ") : "nonzero unsupported ";
            warn(reason+"image filter `"+Array.from(key).slice(0,200).join("")+"` was skipped");
          } else if (known) filters[key==="vibrance" ? "saturation" : key]=n;
        }
        if (Object.keys(filters).length) out.filters=filters;
      }
    }
    return [out];
  });
}

export function effects(values:KiwiValue|undefined) {
  return items(values).flatMap(value=>{
    const e=obj(value);
    if (typeof e.type!=="string") return [];
    return [{type:e.type==="FOREGROUND_BLUR" ? "LAYER_BLUR" : e.type==="GRAIN" ? "TEXTURE" : e.type,
      radius:e.radius,spread:e.spread,startRadius:e.startRadius,density:e.density,opacity:e.opacity,visible:e.visible,
      showShadowBehindNode:e.showShadowBehindNode,clipToShape:e.clipToShape,blendMode:e.blendMode,noiseType:e.noiseType,
      color:e.color && colour(e.color),secondaryColor:e.secondaryColor && colour(e.secondaryColor),
      offset:e.offset,noiseSizeVector:e.noiseSize,startOffset:e.startOffset,endOffset:e.endOffset,
      blurType:e.blurOpType==="PROGRESSIVE" ? "PROGRESSIVE" : undefined,
      boundVariables:bound(e,{colorVar:"color",radiusVar:"radius",spreadVar:"spread",xVar:"offsetX",yVar:"offsetY",startRadiusVar:"startRadius"})}];
  });
}

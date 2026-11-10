import { solidPaint } from "../../solid-paint";
import { colour } from "../../colour";
import { restEffects } from "./effects";
import { isFrameLikeKind, isLeafKind } from "../../document";
import { sanitiseWidthProfile } from "../../width-profile";
import { ImportImages, restBlend, restPaints } from "./paint";
import { clamp, clipped, finite, list, maximumSize, numeric, object, string, type ImportWarnings, type JsonObject } from "./values";

const length=(value:unknown,fallback:number)=>clamp(numeric(value) ?? fallback,0,maximumSize);
const caps=new Map([["ROUND","round"],["SQUARE","square"],["LINE_ARROW","lineArrow"],["TRIANGLE_ARROW","triangleArrow"],
  ["TRIANGLE_FILLED","triangleArrow"],["DIAMOND_FILLED","diamondFilled"],["CIRCLE_FILLED","circleFilled"]]);
function stroke(n:JsonObject,type:string) {
  const weight=length(n.strokeWeight,1),sides=object(n.individualStrokeWeights);
  const align=string(n.strokeAlign);
  const defaultAlign=type==="line" || type==="vector" ? "center" : "inside";
  const cap=(end:unknown)=>caps.get(string(end) ?? string(n.strokeCap) ?? "") ?? "none";
  let dashes=n.strokeDashes===undefined && type==="componentSet" ? [10,5] : list(n.strokeDashes).filter(finite).map(v=>length(v,0));
  if (!dashes.some(d=>d>0)) dashes=[];
  const angle=numeric(n.strokeMiterAngle);
  const points=list(n.strokeWidthProfile).slice(0,64).flatMap(p=>Array.isArray(p) && finite(p[0]) && finite(p[1]) ?
    [{t:p[0],scale:p[1],bias:numeric(p[2]) ?? 0}] : []);
  return {weight,align:align && ["INSIDE","OUTSIDE","CENTER"].includes(align) ? align.toLowerCase() : defaultAlign,
    ...(Object.hasOwn(n,"individualStrokeWeights") && {sides:["top","right","bottom","left"].map(side=>length(sides[side],weight))}),
    cap_start:cap(n.strokeCapStart),cap_end:cap(n.strokeCapEnd),join:n.strokeJoin==="ROUND" ? "round" : n.strokeJoin==="BEVEL" ? "bevel" : "miter",
    miter_limit:angle && angle>0 && angle<180 ? clamp(1/Math.sin(angle*Math.PI/360),1,100) : 4,dashes,
    ...(points.length && {width_profile:sanitiseWidthProfile({points})})};
}
const formats=new Map([["jpg","jpg"],["jpeg","jpg"],["webp","webp"],["svg","svg"],["pdf","pdf"],["xml","vectorDrawable"],["vd","vectorDrawable"],["vectordrawable","vectorDrawable"]]);
function exportSettings(input:unknown) {
  return list(input).map(entry=>{
    const e=object(entry),c=object(e.constraint);
    const by=c.type==="WIDTH" ? "width" : c.type==="HEIGHT" ? "height" : "scale";
    const value=numeric(c.value);
    return {size:{by,value:value && value>0 ? Math.min(value,by==="scale" ? 64 : maximumSize) : 1},
      suffix:clipped(string(e.suffix) ?? ""),format:formats.get(string(e.format)?.toLowerCase().replace(/^\.+/,"") ?? "") ?? "png"};
  });
}

export function restProperties(n:JsonObject,type:string,images:ImportImages,warnings:ImportWarnings) {
  const fills=restPaints(n.fills,images,warnings),strokes=restPaints(n.strokes,images,warnings);
  const radii=list(n.rectangleCornerRadii).filter(finite).map(r=>length(r,0));
  const hasCorners=["rectangle","polygon","star","vector","section"].includes(type) || isFrameLikeKind(type);
  const constraints=object(n.constraints);
  const horizontal=new Map([["RIGHT","right"],["LEFT_RIGHT","leftRight"],["CENTER","center"],["SCALE","scale"]]);
  const vertical=new Map([["BOTTOM","bottom"],["TOP_BOTTOM","topBottom"],["CENTER","center"],["SCALE","scale"]]);
  const propRefs=Object.fromEntries(Object.entries(object(n.componentPropertyReferences)).filter(([k,v])=>["visible","characters","mainComponent"].includes(k) && typeof v==="string"));
  return {visible:n.visible!==false,locked:n.locked===true,opacity:clamp(numeric(n.opacity) ?? 1,0,1),
    blend:restBlend(n.blendMode) ?? (isLeafKind(type) ? "normal" : "passThrough"),
    is_mask:n.isMask===true,mask_type:n.maskType==="LUMINANCE" ? "luminance" : n.maskType==="VECTOR" ? "vector" : "alpha",
    fills:type==="group" ? [] : type==="text" && !Array.isArray(n.fills) ? [solidPaint(colour(0,0,0))] : fills,strokes,stroke:stroke(n,type),effects:restEffects(n.effects,warnings),
    ...(hasCorners && {corners:{radii:radii.length===4 ? radii : Array(4).fill(length(n.cornerRadius,type==="componentSet" ? 5 : 0)),smoothing:clamp(numeric(n.cornerSmoothing) ?? 0,0,1)}}),
    constraints:{horizontal:horizontal.get(string(constraints.horizontal) ?? "") ?? "left",vertical:vertical.get(string(constraints.vertical) ?? "") ?? "top"},
    ...(isFrameLikeKind(type) && {clip:n.clipsContent!==false}),prop_refs:propRefs,exports:exportSettings(n.exportSettings)};
}

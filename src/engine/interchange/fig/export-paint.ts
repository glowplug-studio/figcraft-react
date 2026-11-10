import {bytesToHex} from "@noble/hashes/utils.js";
import {identity,inverse,type Affine} from "../../affine";
import type {BlendMode} from "../../blend";
import type {Document,LayerNode} from "../../document";
import type {Paint} from "../../solid-paint";
import {sanitiseWidthProfile} from "../../width-profile";
import {defaultStroke,type StrokeCap} from "../../stroke";
import type {KiwiObject} from "./kiwi";

const caps:Record<StrokeCap,string>={none:"NONE",square:"SQUARE",round:"ROUND",lineArrow:"ARROW_LINES",triangleArrow:"ARROW_EQUILATERAL",
  reversedTriangle:"ARROW_EQUILATERAL",circleFilled:"CIRCLE_FILLED",diamondFilled:"DIAMOND_FILLED"};
export const wireCap=(cap:StrokeCap)=>caps[cap];
export const wireBlend=(mode:BlendMode)=>mode==="plusDarker" ? "LINEAR_BURN" : mode==="plusLighter" ? "LINEAR_DODGE" : mode.replace(/[A-Z]/g,c=>"_"+c).toUpperCase();
export function wireMatrix([m00,m10,m01,m11,m02,m12]:Affine) {return {m00,m10,m01,m11,m02,m12};}
export function wireStroke(n:LayerNode,warn:(s:string)=>void):KiwiObject {
  const s=n.stroke ?? defaultStroke;
  const out:KiwiObject={strokeWeight:s.weight,strokeAlign:s.align.toUpperCase(),strokeJoin:s.join.toUpperCase(),strokeCap:caps[s.capStart],miterLimit:s.miterLimit};
  if (s.dashes.length) out.dashPattern=[...s.dashes];
  if (s.sides) {
    const [borderTopWeight,borderRightWeight,borderBottomWeight,borderLeftWeight]=s.sides;
    Object.assign(out,{borderStrokeWeightsIndependent:true,borderTopWeight,borderRightWeight,borderBottomWeight,borderLeftWeight});
  }
  if (s.widthProfile?.points.length && s.weight>0 && Number.isFinite(s.weight)) {
    const {points}=sanitiseWidthProfile(s.widthProfile);
    if (points.some(p=>Math.abs(p.bias)>1e-6)) warn("strokes wider on one side of their path were written with that width on both sides");
    out.variableWidthPoints=points.map(p=>({position:p.t,ascent:p.scale/2,descent:p.scale/2}));
  }
  if (s.brush) warn("brush strokes were written as plain strokes");
  if (s.capStart==="reversedTriangle" || s.capEnd==="reversedTriangle") warn("reversed triangle stroke ends were written as triangle arrows");
  if (s.capStart!==s.capEnd && n.kind!=="vector") warn("lines with different stroke ends use the start's at both ends");
  return out;
}
export class FigPaintWriter {
  readonly files=new Map<string,Blob>();
  readonly #hashes=new Map<string,Uint8Array>();
  constructor(readonly doc:Document,readonly warn:(s:string)=>void) {}
  async #hash(key:string) {
    const cached=this.#hashes.get(key);
    if (cached) return cached;
    const image=this.doc.images?.[key];
    let hash:Uint8Array=new Uint8Array();
    if (!image) this.warn("image fills whose image isn't in the document were written without one");
    else if (image.bytes.size>256*1024**2) this.warn("images larger than 256 MB were left out");
    else {
      hash=new Uint8Array(await crypto.subtle.digest("SHA-1",await image.bytes.arrayBuffer()));
      this.files.set(bytesToHex(hash),image.bytes);
    }
    this.#hashes.set(key,hash);return hash;
  }
  async list(paints:readonly Paint[]) {
    const output:KiwiObject[]=[];
    for (const p of paints) {
      const out:KiwiObject={visible:p.visible,blendMode:wireBlend(p.blend),opacity:p.opacity};
      switch (p.type) {
        case "solid":
          out.type="SOLID";out.color={...p.color,a:1};out.opacity=p.opacity*p.color.a;break;
        case "gradient": {
          const [fx,fy]=p.from,linear=p.kind==="linear",k=linear ? 1 : 2;
          const a=k*(p.to[0]-fx),b=k*(p.to[1]-fy),c=2*(p.width[0]-fx),d=2*(p.width[1]-fy);
          const handles:Affine=[a,b,c,d,fx-.5*(linear ? c : a+c),fy-.5*(linear ? d : b+d)];
          let t=identity;
          if (handles.every(Number.isFinite) && Math.abs(a*d-b*c)>1e-12) t=inverse(handles);
          else this.warn("gradients with handles on one line were written with the default direction");
          out.type="GRADIENT_"+p.kind.toUpperCase();out.transform=wireMatrix(t);
          out.stops=p.stops.map(s=>({position:s.position,color:{...s.color}}));break;
        }
        case "image":
          out.type="IMAGE";out.image={hash:await this.#hash(p.image),name:""};
          out.imageScaleMode=p.scale_mode==="crop" ? "STRETCH" : p.scale_mode.toUpperCase();
          out.rotation=((p.rotation%4+4)%4)*90;out.scale=p.scale;
          if (p.crop && p.scale_mode==="crop") out.transform=wireMatrix(p.crop);
          if (Object.values(p.filters).some(x=>x!==0)) this.warn("image adjustments (exposure, contrast, …) were left out");
          break;
        case "pattern":this.warn("pattern fills were left out");continue;
      }
      output.push(out);
    }
    return output;
  }
}

export function wireEffect(e:import("../../effects").Effect,warn:(s:string)=>void):KiwiObject {
  const out:KiwiObject={visible:e.visible},xy=(p:readonly [number,number])=>({x:p[0],y:p[1]});
  switch (e.type) {
    case "dropShadow":case "innerShadow":
      return {...out,type:e.type==="dropShadow" ? "DROP_SHADOW" : "INNER_SHADOW",color:{...e.color},offset:xy(e.offset),
        radius:e.radius,spread:e.spread,blendMode:wireBlend(e.blend),showShadowBehindNode:e.showBehind};
    case "layerBlur":case "backgroundBlur":
      return {...out,type:e.type==="layerBlur" ? "FOREGROUND_BLUR" : "BACKGROUND_BLUR",radius:e.radius,
        ...(e.blurType==="progressive" && {blurOpType:"PROGRESSIVE",startRadius:e.startRadius,startOffset:xy(e.start),endOffset:xy(e.end)})};
    case "noise":
      return {...out,type:"NOISE",noiseType:e.mode==="mono" ? "MONOTONE" : e.mode==="duo" ? "DUOTONE" : "MULTITONE",
        noiseSize:{x:e.size,y:e.sizeY ?? e.size},density:e.density,color:{...e.color},secondaryColor:{...e.secondary},opacity:e.opacity,blendMode:wireBlend(e.blend)};
    case "texture":return {...out,type:"GRAIN",noiseSize:{x:e.size,y:e.sizeY ?? e.size},radius:e.radius,clipToShape:e.clipToShape};
    case "glass":warn("glass effects keep only their frost");return {...out,type:"GLASS",radius:Math.max(0,Math.min(100,e.frost))};
  }
}

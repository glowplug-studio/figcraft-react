import { bindingItem } from "./variable-binding-key";
export { bindingItem, canonicalBinding } from "./variable-binding-key";
import { withAlpha, type Colour } from "./colour";
import { sameComponentValue } from "./component-groups";
import type { Document } from "./document";
import type { Effect } from "./effects";
import type { LayoutGrid, SharedStyle } from "./shared-styles";
import type { Paint } from "./solid-paint";
import { compareScalarKeys } from "./text-breaks";
import type { TextStyle } from "./text-style";
import { layerModes } from "./variable-modes";
import { resolveVariable, type Variables } from "./variables";

type Value = NonNullable<ReturnType<typeof resolveVariable>>;

function changedAt<T>(array:readonly T[],index:number,value:T):readonly T[] {
  if (sameComponentValue(array[index],value)) return array;
  const next=array.slice();
  next[index]=Object.freeze(value);
  return Object.freeze(next);
}

export function rebindPaintAlpha(paints:readonly Paint[],index:number,binding:boolean) {
  const paint=paints[index];
  if (paint?.type!=="solid") return paints;
  const opacity=binding ? (paint.colorAlpha>0 ? Math.min(1,Math.max(0,Math.fround(paint.opacity/paint.colorAlpha))) : 1)
    : Math.fround(paint.opacity*paint.color.a);
  return changedAt(paints,index,{...paint,opacity,colorAlpha:binding ? 1 : Math.fround(paint.colorAlpha*paint.color.a),color:withAlpha(paint.color,1)});
}

export function paintWithVariable(paints:readonly Paint[],index:number,field:string,color:Colour) {
  const paint=paints[index];
  const stop=/^stops\/(\d+)\/color$/.exec(field);
  if (stop) {
    const j=Number(stop[1]);
    if (paint?.type!=="gradient" || !paint.stops[j]) return paints;
    const stops=changedAt(paint.stops,j,{...paint.stops[j],color});
    return stops===paint.stops ? paints : changedAt(paints,index,{...paint,stops});
  }
  if (field!=="color" || !paint && index!==0) return paints;
  return changedAt<Paint>(paints,index,{type:"solid",color,opacity:paint?.opacity ?? 1,visible:paint?.visible ?? true,
    blend:paint?.blend ?? "normal",colorAlpha:paint?.colorAlpha ?? 1});
}

export function effectWithVariable(effects:readonly Effect[],i:number,field:string,value:Value) {
  const effect=effects[i];
  if (!effect) return effects;
  if (effect.type==="dropShadow" || effect.type==="innerShadow") {
    if (field==="color" && value.type==="color") return changedAt(effects,i,{...effect,color:value.value});
    if (value.type!=="number") return effects;
    const x=value.value;
    if (field==="offsetX" || field==="offsetY") {
      const [a,b]=effect.offset;
      const offset=Object.freeze([field==="offsetX" ? x : a,field==="offsetY" ? x : b] as const);
      return changedAt(effects,i,{...effect,offset});
    }
    if (field==="radius" || field==="spread") return changedAt(effects,i,{...effect,[field]:field==="spread" ? x : Math.max(0,x)});
  }
  if (value.type!=="number") return effects;
  const x=value.value;
  if ((effect.type==="layerBlur" || effect.type==="backgroundBlur") && (field==="radius" || field==="startRadius"))
    return changedAt(effects,i,{...effect,[field]:Math.max(0,x)});
  if (effect.type==="glass") {
    if (field==="lightAngle") {
      const rem=x%360;
      const angle=rem<0 ? rem+360 : rem+0;
      return changedAt(effects,i,{...effect,lightAngle:angle>180 ? angle-360 : angle});
    }
    if (field==="depth") return changedAt(effects,i,{...effect,depth:Math.min(1000,Math.max(1,x))});
    if (field==="radius") return changedAt(effects,i,{...effect,frost:Math.min(100,Math.max(0,x))});
    if (["lightIntensity","refraction","dispersion","splay"].includes(field)) return changedAt(effects,i,{...effect,[field]:Math.min(1,Math.max(0,x/100))});
  }
  return effects;
}

export function gridWithVariable(grids:readonly LayoutGrid[],i:number,field:string,x:number) {
  if (!grids[i] || !["size","gutter","count","offset"].includes(field)) return grids;
  const value=field==="count" ? Math.min(1000,Math.max(1,Math.round(x))) : field==="offset" ? x : Math.max(0,x);
  return changedAt(grids,i,{...grids[i],[field]:value});
}

function textWithVariable(style:TextStyle,key:string,value:Value):TextStyle {
  if (value.type==="string" && value.value.trim() && (key==="fontFamily" || key==="fontStyle")) return {...style,[key]:value.value};
  if (value.type!=="number") return style;
  const x=value.value;
  if (key==="fontSize") return {...style,fontSize:Math.min(5000,Math.max(1,x))};
  if (key==="lineHeight") return {...style,lineHeight:{unit:"pixels",value:Math.min(100000,Math.max(0,x))}};
  if (key==="letterSpacing") return {...style,letterSpacing:{unit:"pixels",value:Math.min(10000,Math.max(-10000,x))}};
  return style;
}

export function resolveStyle(style:SharedStyle,vars:Variables|undefined,modes:Readonly<Record<string,string>>={}):SharedStyle {
  if (!style.bound || !vars) return style;
  let next=style;
  for (const key of Object.keys(style.bound).sort(compareScalarKeys)) {
    const value=resolveVariable(vars,style.bound[key],modes);
    if (!value) continue;
    const item=bindingItem(key);
    if (next.type==="paint" && item?.list==="fills" && value.type==="color") {
      const paints=paintWithVariable(next.paints,item.index,item.field,value.value);
      if (paints!==next.paints) next={...next,paints};
    } else if (next.type==="grid" && item?.list==="layoutGrids" && value.type==="number") {
      const grids=gridWithVariable(next.grids,item.index,item.field,value.value);
      if (grids!==next.grids) next={...next,grids};
    } else if (next.type==="effect" && item?.list==="effects") {
      const effects=effectWithVariable(next.effects,item.index,item.field,value);
      if (effects!==next.effects) next={...next,effects};
    } else if (next.type==="text" && !item) {
      const resolved=textWithVariable(next.style,key,value);
      if (!sameComponentValue(resolved,next.style)) next={...next,style:Object.freeze(resolved)};
    }
  }
  return next===style ? style : Object.freeze(next);
}

export function styleForLayer(document:Document,style:SharedStyle|undefined,id:string) {
  return style?.bound ? resolveStyle(style,document.variables,layerModes(document,id)) : style;
}

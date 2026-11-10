import {children,clamp,numeric,object,string,type JsonObject} from "../rest/values";
import {sketchColour,type SketchNode} from "./geometry";
import {sketchGradient,sketchPoint} from "./gradient";

export interface SketchStyleContext {warn:(s:string)=>void;swatches:ReadonlySet<string>}
const names=["NORMAL","DARKEN","MULTIPLY","COLOR_BURN","LIGHTEN","SCREEN","COLOR_DODGE","OVERLAY","SOFT_LIGHT","HARD_LIGHT","DIFFERENCE","EXCLUSION","HUE","SATURATION","COLOR","LUMINOSITY","LINEAR_BURN","LINEAR_DODGE"];
const list=(v:unknown)=>children(v).slice(0,64).map(object);
const black={r:0,g:0,b:0,a:1};
const int=(v:unknown,d=0)=>Number.isInteger(v) ? Number(v) : d;
const unit=(v:unknown,d:number)=>clamp(numeric(v) ?? d,0,1);
function paint(cx:SketchStyleContext,f:JsonObject,w:number,h:number):SketchNode|undefined {
  const ty=int(f.fillType),ctx=object(f.contextSettings);
  let p:SketchNode;
  if (ty===0) {
    p={type:"SOLID",color:sketchColour(f.color) ?? black};
    const id=string(object(f.color).swatchID);
    if (id!==undefined && cx.swatches.has(id)) p.boundVariables={color:{type:"VARIABLE_ALIAS",id}};
  } else if (ty===1) {
    if (f.gradient===undefined) return;
    p=sketchGradient(object(f.gradient),w,h,cx.warn);
  } else if (ty===4) {
    const ref=string(object(f.image)._ref);
    if (ref===undefined) {cx.warn("image fills stored inside the JSON were skipped");return;}
    p={type:"IMAGE",imageRef:ref,scaleMode:"FILL"};
    switch (int(f.patternFillType,1)) {
      case 0:p.scaleMode="TILE";p.scalingFactor=clamp(numeric(f.patternTileScale) ?? 1,.01,100);break;
      case 2:p.scaleMode="STRETCH";p.imageTransform=[[1,0,0],[0,1,0]];break;
      case 3:p.scaleMode="FIT";break;
    }
  } else {cx.warn(ty===5 ? "noise fills were skipped" : "fills of type "+ty+" were skipped");return;}
  p.visible=f.isEnabled!==false;
  if (numeric(ctx.opacity)!==undefined) p.opacity=unit(ctx.opacity,1);
  if (Number.isInteger(ctx.blendMode) && names[Number(ctx.blendMode)]) p.blendMode=names[Number(ctx.blendMode)];
  return p;
}
export function sketchPaints(cx:SketchStyleContext,s:JsonObject,w:number,h:number,border=false) {
  return list(border ? s.borders : s.fills).filter(f=>border || f.layeringType!==1).flatMap(f=>{const p=paint(cx,f,w,h);return p ? [p] : [];});
}
export function sketchEffects(cx:SketchStyleContext,s:JsonObject) {
  const out:SketchNode[]=[];
  for (const key of ["shadows","innerShadows"]) for (const shadow of list(s[key])) {
    const color=sketchColour(shadow.color) ?? {...black,a:.5};
    out.push({type:key==="innerShadows" || shadow.isInnerShadow===true ? "INNER_SHADOW" : "DROP_SHADOW",visible:shadow.isEnabled!==false,
      radius:clamp(numeric(shadow.blurRadius) ?? 0,0,1e6),spread:numeric(shadow.spread) ?? 0,
      color:{...color,a:color.a*unit(object(shadow.contextSettings).opacity,1)},offset:{x:numeric(shadow.offsetX) ?? 0,y:numeric(shadow.offsetY) ?? 0}});
  }
  for (const b of [object(s.blur),...list(s.blurs)]) {
    if (b.isEnabled!==true) continue;
    const radius=clamp(numeric(b.radius) ?? 0,0,1e6),kind=int(b.type);
    if (kind===4) {out.push({type:"GLASS",visible:true,radius,refraction:unit(b.distortion,.5),depth:unit(b.depth,.5)});continue;}
    if (kind!==0 && kind!==3) cx.warn("motion and zoom blurs were drawn as plain blurs");
    const effect:SketchNode={type:kind===3 ? "BACKGROUND_BLUR" : "LAYER_BLUR",visible:true,radius:kind===0 || kind===1 || kind===3 ? 2*radius : radius/2};
    if (kind===3 && b.isProgressive===true && b.gradient!==undefined) {
      const g=object(b.gradient),stops=children(g.stops),at=(v:unknown)=>unit(object(object(v).color).alpha,1)*2*radius;
      const point=(v:unknown,x:number,y:number)=>{const p=sketchPoint(v) ?? {x,y};return {x:clamp(p.x,-1000,1000),y:clamp(p.y,-1000,1000)};};
      Object.assign(effect,{blurType:"PROGRESSIVE",startRadius:at(stops[0]),radius:at(stops.at(-1)),startOffset:point(g.from,.5,0),endOffset:point(g.to,.5,1)});
    }
    out.push(effect);
  }
  return out.slice(0,64);
}
export function sketchStyle(cx:SketchStyleContext,s:JsonObject,w:number,h:number,out:SketchNode) {
  const fills=sketchPaints(cx,s,w,h);
  if (fills.length) out.fills=fills;
  const borders=list(s.borders),strokes=sketchPaints(cx,s,w,h,true);
  if (strokes.length) {
    out.strokes=strokes;
    const visible=borders.filter(b=>b.isEnabled!==false),b=visible[0] ?? borders[0],t=numeric(b.thickness) ?? 1,pos=int(b.position);
    if (visible.some(other=>(numeric(other.thickness) ?? 1)!==t || int(other.position)!==pos))
      cx.warn("layers with several borders of different widths or positions use the first one's");
    out.strokeWeight=clamp(t,0,1e6);out.strokeAlign=pos===1 ? "INSIDE" : pos===2 ? "OUTSIDE" : "CENTER";
    if (visible[0]?.sides!==undefined) {
      const sides=object(b.sides),side=(k:string)=>clamp(clamp(t,0,1e6)-(numeric(sides[k]) ?? 0),0,1e6);
      out.individualStrokeWeights={top:side("topInset"),right:side("rightInset"),bottom:side("bottomInset"),left:side("leftInset")};
    }
    if (s.borderOptions!==undefined) {
      const o=object(s.borderOptions),dashes=children(o.dashPattern).flatMap(d=>typeof d==="number" && d>0 && Number.isFinite(d) ? [d] : []);
      if (dashes.length) out.strokeDashes=dashes;
      out.strokeCap=["NONE","ROUND","SQUARE"][int(o.lineCapStyle)] ?? "NONE";
      out.strokeJoin=["MITER","ROUND","BEVEL"][int(o.lineJoinStyle)] ?? "MITER";
    }
    for (const [key,field] of [["startMarkerType","strokeCapStart"],["endMarkerType","strokeCapEnd"]]) {
      const marker=int(s[key]);
      if (!marker) continue;
      const cap=marker===1 ? "LINE_ARROW" : marker===2 ? "TRIANGLE_ARROW" : marker===5 ? "CIRCLE_FILLED" : undefined;
      if (cap) out[field]=cap;else cx.warn("line ends other than arrows and filled circles were drawn without an end");
    }
  }
  const effects=sketchEffects(cx,s);
  if (effects.length) out.effects=effects;
  const ctx=object(s.contextSettings);
  if (numeric(ctx.opacity)!==undefined) out.opacity=unit(ctx.opacity,1);
  if (ctx.blendMode && Number.isInteger(ctx.blendMode) && names[Number(ctx.blendMode)]) out.blendMode=names[Number(ctx.blendMode)];
}
export function bitmapFilters(cx:SketchStyleContext,l:JsonObject) {
  const c=object(object(l.style).colorControls);
  if (c.isEnabled!==true) return;
  if (Math.abs(numeric(c.hue) ?? 0)>1e-6) cx.warn("hue changes of bitmaps were skipped");
  const b=clamp(numeric(c.brightness) ?? 0,-1,1),contrast=clamp(numeric(c.contrast) ?? 1,0,2);
  const e=clamp(contrast/clamp(contrast-2*b,1e-6,2),.25,4);
  return {saturation:clamp((numeric(c.saturation) ?? 1)-1,-1,1),contrast:clamp(contrast/e,0,2)-1,exposure:clamp(Math.log2(e)/2,-1,1)};
}

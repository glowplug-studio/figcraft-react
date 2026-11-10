import { identity,inverse,multiply,transformPoint,type Affine } from "../affine";
import { fromRgba8,toRgba8,withAlpha } from "../colour";
import { parseCssColour } from "../colour-css";
import { convertColour,type ColourProfile } from "../colour-spaces";
import type { Point,Rectangle } from "../geometry";
import type { ColourStop,GradientHandle } from "../gradient";
import { solidPaint,type Paint } from "../solid-paint";
import { svgLength,svgOpacity,transformList,type SvgStyle,type SvgUnits } from "./style";
import { svgNamespace } from "./xml";

export function localReference(el:Element,value:string|null|undefined):Element|undefined {
  const match=/^url\(\s*["']?#([^"'\s)]+)["']?\s*\)/.exec(value ?? "");
  const target=match && el.ownerDocument.getElementById(match[1]);
  return target?.namespaceURI===svgNamespace ? target : undefined;
}

export interface PaintTarget {
  toNode:Affine;
  bounds:Rectangle;
  width:number;
  height:number;
}

export function svgGradient(el:Element,target:PaintTarget,units:SvgUnits,opacity:number,profile:ColourProfile,cascade:(el:Element,parent?:SvgStyle)=>SvgStyle):Paint|undefined {
  const chain:Element[]=[];
  let def:Element|null=el;
  while (def && ["linearGradient","radialGradient"].includes(def.localName)) {
    if (chain.includes(def) || chain.length>=64) return;
    chain.push(def);
    const href:string|null=def.getAttribute("href") ?? def.getAttributeNS("http://www.w3.org/1999/xlink","href");
    def=href?.startsWith("#") ? el.ownerDocument.getElementById(href.slice(1)) : null;
  }
  const attr=(key:string)=>chain.find(g=>g.hasAttribute(key))?.getAttribute(key);
  const parent=chain.find(g=>Array.from(g.children).some(c=>c.localName==="stop"));
  if (!parent) return;
  let last=0;
  const stops:ColourStop[]=[];
  const ancestry=[];
  for(let ancestor:Element|null=parent;ancestor;ancestor=ancestor.parentElement) ancestry.push(ancestor);
  let inherited:SvgStyle|undefined;
  for(const ancestor of ancestry.reverse()) inherited=cascade(ancestor,inherited);
  for(const stop of parent.children) {
    if (stop.localName!=="stop") continue;
    const style=cascade(stop,inherited);
    const value=style.get("stop-color") ?? "black";
    const c=parseCssColour(value.toLowerCase()==="currentcolor" ? style.get("color") ?? "black" : value);
    const [r,g,b,a]=toRgba8(c ?? fromRgba8(0,0,0));
    const color=convertColour(withAlpha(fromRgba8(r,g,b),Math.fround(a/255*svgOpacity(style.get("stop-opacity")))),"srgb",profile);
    last=Math.max(last,Math.min(1,Math.max(0,svgLength(stop.getAttribute("offset"),1,1))));
    stops.push({position:last,color});
  }
  if (!stops.length) return;
  const single=()=>({...solidPaint(stops[stops.length-1].color),opacity});
  if (stops.length===1) return single();
  const bbox=attr("gradientUnits")!=="userSpaceOnUse", {x,y,width:w,height:h}=target.bounds;
  if (bbox && !(w>0 && h>0)) return;
  const space:Affine=bbox ? [w,0,0,h,x,y] : identity;
  const gradient=chain.find(g=>g.hasAttribute("gradientTransform")) as SVGGradientElement|undefined;
  const xf=multiply(multiply(target.toNode,space),gradient ? transformList(gradient.gradientTransform.baseVal) : identity);
  const len=(key:string,axis:"x"|"y"|"r",fallback:string)=>svgLength(attr(key) ?? fallback,bbox ? 1 :
    axis==="x" ? units.width : axis==="y" ? units.height : Math.hypot(units.width,units.height)/Math.SQRT2,units.font);
  const kind=el.localName==="linearGradient" ? "linear" : "radial";
  let origin:Point,u:Point,v:Point;
  if (kind==="linear") {
    origin={x:len("x1","x","0"),y:len("y1","y","0")};
    u={x:len("x2","x","100%")-origin.x,y:len("y2","y","0")-origin.y};
    v={x:-u.y,y:u.x};
  } else {
    const r=len("r","r","50%");
    if (!(r>0)) return single();
    origin={x:len("fx","x",attr("cx") ?? "50%"),y:len("fy","y",attr("cy") ?? "50%")};
    u={x:r,y:0};v={x:0,y:r};
  }
  const frame=multiply(xf,[u.x,u.y,v.x,v.y,origin.x,origin.y]);
  if (frame[0]*frame[3]===frame[1]*frame[2]) return single();
  let lo=0,hi=1;
  const spread=attr("spreadMethod");
  if (spread==="reflect" || spread==="repeat") {
    const inv=inverse(frame);
    const values=[[0,0],[target.width,0],[0,target.height],[target.width,target.height]].map(([x,y])=>{
      const p=transformPoint(inv,{x,y});
      return kind==="linear" ? p.x : Math.hypot(p.x,p.y);
    });
    const low=Math.min(0,Math.floor(Math.min(...values))),high=Math.max(1,Math.ceil(Math.max(...values)));
    if (high-low<=32) {lo=low;hi=high;}
  }
  const unit=(x:number,y:number):GradientHandle=>{
    const p=transformPoint(frame,{x,y});
    return [p.x/Math.max(target.width,1e-6),p.y/Math.max(target.height,1e-6)];
  };
  const expanded:ColourStop[]=[];
  for(let k=lo;k<hi;k++) {
    const flip=spread==="reflect" && Math.abs(k%2)===1;
    for (const stop of flip ? stops.slice().reverse() : stops)
      expanded.push({position:Math.fround((k-lo+(flip ? 1-stop.position : stop.position))/(hi-lo)),color:stop.color});
  }
  return {type:"gradient",kind,stops:expanded,from:unit(lo,0),to:unit(hi,0),width:kind==="linear" ? unit(lo,1) : unit(0,hi),
    opacity,colorAlpha:1,visible:true,blend:"normal"};
}

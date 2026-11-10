import { parseCssColour } from "../colour-css";
import { fromRgba8, toRgba8 } from "../colour";
import { solidPaint,type Paint } from "../solid-paint";
import { defaultStroke,type StrokeProps } from "../stroke";
import { svgLength,svgOpacity,type SvgStyle,type SvgUnits } from "./style";

export function inlinePaint(style:SvgStyle,key:"fill"|"stroke"):Paint|undefined {
  let paint=style.get(key) ?? (key==="fill" ? "black" : "none");
  if (/^url\(/.test(paint)) {
    paint=paint.replace(/^url\([^)]*\)\s*/,"");
    if (!paint) return;
  }
  if (paint==="none") return;
  const text=paint.toLowerCase()==="currentcolor" ? style.get("color") ?? "black" : paint;
  const colour=parseCssColour(text) ?? (key==="fill" ? fromRgba8(0,0,0) : undefined);
  if (!colour) return;
  const [r,g,b,a]=toRgba8(colour);
  const c=fromRgba8(r,g,b);
  return {...solidPaint(c),opacity:Math.fround(a/255*svgOpacity(style.get(key+"-opacity")))};
}

function rotateDash(dashes:number[],offset:number,butt:boolean) {
  const total=dashes.reduce((a,b)=>a+b,0);
  if (!(total>0)) return dashes;
  let o=((offset%total)+total)%total;
  if (o<1e-9) return dashes;
  for (const [i,d] of dashes.entries()) {
    if (o<d) {
      if (i%2 && !butt) return dashes;
      const out=[...(i%2 ? [0] : []),d-o,...dashes.slice(i+1),...dashes.slice(0,i),o];
      if (out.length%2) out.push(0);
      return out;
    }
    o-=d;
  }
  return dashes;
}

export function svgStroke(style:SvgStyle,units:SvgUnits,k:number,closed:boolean):StrokeProps {
  const base=Math.hypot(units.width,units.height)/Math.SQRT2;
  const len=(s:string|undefined,def=0)=>svgLength(s,base,units.font,def)*k;
  const cap=style.get("stroke-linecap"), join=style.get("stroke-linejoin");
  const caps=cap==="square" || cap==="round" ? cap : "none";
  let dashes=(style.get("stroke-dasharray") ?? "").split(/[\s,]+/).filter(Boolean).map(x=>len(x,NaN));
  if (!dashes.every(n=>Number.isFinite(n) && n>=0) || !dashes.some(n=>n>0)) dashes=[];
  if (dashes.length%2) dashes=dashes.concat(dashes);
  const off=len(style.get("stroke-dashoffset"));
  if (dashes.length && (closed || Math.abs(dashes[0]/2-off)>1e-3)) dashes=rotateDash(dashes,off,caps==="none");
  return {...defaultStroke,weight:len(style.get("stroke-width"),1),align:"center",capStart:caps,capEnd:caps,
    join:join==="round" || join==="bevel" ? join : "miter",miterLimit:Math.max(1,svgLength(style.get("stroke-miterlimit"),1,1,4)),dashes};
}

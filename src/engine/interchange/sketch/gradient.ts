import {children,clamp,numeric,object,type JsonObject} from "../rest/values";
import {sketchColour} from "./geometry";

export function sketchPoint(raw:unknown) {
  if (typeof raw!=="string") return;
  const parts=/^\{\s*([+\-.\deE]+)\s*,\s*([+\-.\deE]+)\s*\}$/.exec(raw.trim());
  if (!parts) return;
  const x=Number(parts[1]),y=Number(parts[2]);
  if (Number.isFinite(x) && Number.isFinite(y)) return {x,y};
}
type Colour=NonNullable<ReturnType<typeof sketchColour>>;
type Stop={position:number;color:Colour};
type Lab=[number,number,number];
const linear=(v:number)=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
const encoded=(v:number)=>clamp(v<=.0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055,0,1);
function lab(c:Colour):Lab {
  const r=linear(c.r),g=linear(c.g),b=linear(c.b);
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),
    s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function rgb(L:number,a:number,b:number,alpha:number):Colour {
  const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return {r:encoded(4.0767416621*l-3.3077115913*m+.2309699292*s),g:encoded(-1.2684380046*l+2.6097574011*m-.3413193965*s),
    b:encoded(-.0041960863*l-.7034186147*m+1.707614701*s),a:alpha};
}
function interpolate(stops:Stop[],polar:boolean) {
  if (stops.length<2 || stops.length*16>1024) return stops;
  const ordered=[...stops].sort((a,b)=>a.position-b.position),out:Stop[]=[];
  for (let i=1;i<ordered.length;i++) {
    const from=ordered[i-1],to=ordered[i],a=lab(from.color),b=lab(to.color);
    const c0=Math.hypot(a[1],a[2]),c1=Math.hypot(b[1],b[2]);
    let h0=Math.atan2(a[2],a[1]),h1=Math.atan2(b[2],b[1]);
    if (c0<1e-4) h0=h1;
    if (c1<1e-4) h1=h0;
    let d=h1-h0;
    if (d>Math.PI) d-=2*Math.PI;else if (d< -Math.PI) d+=2*Math.PI;
    for (let k=0;k<16;k++) {
      const t=k/16,mix=(x:number,y:number)=>x+(y-x)*t,c=mix(c0,c1),h=h0+d*t;
      out.push({position:mix(from.position,to.position),color:rgb(mix(a[0],b[0]),polar ? c*Math.cos(h) : mix(a[1],b[1]),
        polar ? c*Math.sin(h) : mix(a[2],b[2]),mix(from.color.a,to.color.a))});
    }
  }
  out.push(ordered[ordered.length-1]);return out;
}
export function sketchGradient(g:JsonObject,w:number,h:number,warn:(s:string)=>void) {
  const from=sketchPoint(g.from) ?? {x:.5,y:0},to=sketchPoint(g.to) ?? {x:.5,y:1};
  let stops=children(g.stops).slice(0,64).flatMap(v=>{
    const s=object(v),position=numeric(s.position),color=sketchColour(s.color);
    return position!==undefined && color ? [{position:clamp(position,0,1),color}] : [];
  });
  if (g.colorInterpolation===1 || g.colorInterpolation===2) {
    stops=interpolate(stops,g.colorInterpolation===2);
    warn("gradients mixed in OKLab or OKLCH became sRGB gradients with stops along the same colours");
  }
  const radial=g.gradientType===1,angular=g.gradientType===2,e=radial && (numeric(g.elipseLength) ?? 0)>0 ? Number(g.elipseLength) : 1;
  const dx=to.x-from.x,dy=to.y-from.y;
  const across=w>0 && h>0 ? {x:from.x-dy*h/w*e,y:from.y+dx*w/h*e} : radial ? from : {x:from.x-dy,y:from.y+dx};
  return {type:angular ? "GRADIENT_ANGULAR" : radial ? "GRADIENT_RADIAL" : "GRADIENT_LINEAR",gradientStops:stops,
    gradientHandlePositions:angular ? [{x:.5,y:.5},{x:1,y:.5},{x:.5,y:1}] : [from,to,across]};
}

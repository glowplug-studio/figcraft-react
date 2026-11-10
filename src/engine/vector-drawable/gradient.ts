import { inverse, multiply, type Affine } from "../affine";
import { colour, withAlpha, type Colour } from "../colour";
import { sortedStops, type ColourStop, type Gradient } from "../gradient";
import type { DrawableGradient, GroupTransform } from "./xml";

function stopColour(stops:readonly ColourStop[],t:number) {
  if (t<=stops[0].position) return stops[0].color;
  for (let i=1;i<stops.length;i++) {
    const a=stops[i-1], b=stops[i];
    if (t>b.position) continue;
    const k=b.position>a.position ? Math.fround((t-a.position)/(b.position-a.position)) : 1;
    const mix=(key:keyof Colour)=>a.color[key]+Math.fround(Math.fround(b.color[key]-a.color[key])*k);
    return colour(mix("r"),mix("g"),mix("b"),mix("a"));
  }
  return stops[stops.length-1].color;
}
function rotatedStops(stops:readonly ColourStop[],turn:number) {
  const d=((turn%1)+1)%1;
  if (d<1e-9 || d>1-1e-9) return stops;
  const seam=1-d, ends=stopColour(stops,seam);
  const rotated:ColourStop[]=[{position:0,color:ends}];
  for (const s of stops) if (s.position>seam) rotated.push({...s,position:s.position-seam});
  rotated.push({position:d,color:stopColour(stops,1)},{position:d,color:stops[0].color});
  for (const s of stops) if (s.position<seam) rotated.push({...s,position:s.position+d});
  rotated.push({position:1,color:ends});
  return rotated.filter((s,i)=>{
    const p=rotated[i-1];
    return !p || Math.abs(s.position-p.position)>=1e-9 || s.color.r!==p.color.r
      || s.color.g!==p.color.g || s.color.b!==p.color.b || s.color.a!==p.color.a;
  });
}

export function drawableGradient(g:Gradient,alpha:number,world:Affine,w:number,h:number):
  {fill:Colour | DrawableGradient; group?:{transform:GroupTransform; inverse:Affine}} | undefined {
  const stops=sortedStops(g.stops).map(s=>({...s,color:withAlpha(s.color,s.color.a*alpha)}));
  if (stops.length===1) return {fill:stops[0].color};
  const x=g.from[0]*w, y=g.from[1]*h;
  const [a,b,c,d,tx,ty]=multiply(world,[g.to[0]*w-x,g.to[1]*h-y,g.width[0]*w-x,g.width[1]*h-y,x,y]);
  const det=a*d-b*c;
  if (!Number.isFinite(det) || Math.abs(det)<=1e-12*Math.max(Number.MIN_VALUE,a*a+b*b+c*c+d*d)) return;
  if (g.kind==="linear") {
    const projection=(a*c+b*d)/(c*c+d*d);
    return {fill:{type:"linear",stops,line:[tx,ty,tx+a-c*projection,ty+b-d*projection]}};
  }
  const e=(a+d)/2, f=(a-d)/2, j=(b+c)/2, k=(b-c)/2;
  const q=Math.hypot(e,k), r=Math.hypot(f,j), sx=q+r, sy=q-r;
  if (Math.abs(sy)<=1e-9*sx) return;
  const first=Math.atan2(j,f), second=Math.atan2(k,e), phi=(first+second)/2;
  const cos=Math.cos(phi), sin=Math.sin(phi);
  const group={transform:{x:tx,y:ty,sx,sy,rotation:phi*180/Math.PI},inverse:inverse([sx*cos,sx*sin,-sy*sin,sy*cos,tx,ty])};
  return {fill:g.kind==="angular" ? {type:"sweep",stops:rotatedStops(stops,(second-first)/(4*Math.PI))}
    : {type:"radial",stops},group};
}

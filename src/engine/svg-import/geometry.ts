import { multiply,transformPoint,type Affine } from "../affine";
import { mapVectorPath,type PathCommand } from "../corners";
import { cubicDerivative,cubicLength,cubicPoint,type Cubic } from "../cubic";
import { TAU } from "../ellipse";
import type { Point,Rectangle } from "../geometry";
import { parseSvgPath } from "../svg-path";
import { pathBounds } from "../vector-path";
import { svgLength,type SvgUnits } from "./style";

type Path=readonly PathCommand[];
type Primitive={kind:"rectangle"|"ellipse";box:Rectangle;radius:number}|{kind:"line";a:Point;b:Point};
const pt=(x:number,y:number)=>({x,y});
const end=(c:PathCommand)=>c[0]==="Z" ? undefined : c[0]==="C" ? pt(c[5],c[6]) : pt(c[1],c[2]);
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export const translated=(x:number,y:number):Affine=>[1,0,0,1,x,y];
export const transformPath=(p:Path,xf:Affine)=>mapVectorPath(p,q=>transformPoint(xf,q));

function rounded(x:number,y:number,w:number,h:number,rx:number,ry:number):Path {
  const r=x+w,b=y+h,k=.5522848;
  if (!rx || !ry) return [["M",x,y],["L",r,y],["L",r,b],["L",x,b],["Z"]];
  return [["M",x+rx,y],["L",r-rx,y],["C",r-rx*(1-k),y,r,y+ry*(1-k),r,y+ry],
    ["L",r,b-ry],["C",r,b-ry*(1-k),r-rx*(1-k),b,r-rx,b],["L",x+rx,b],
    ["C",x+rx*(1-k),b,x,b-ry*(1-k),x,b-ry],["L",x,y+ry],
    ["C",x,y+ry*(1-k),x+rx*(1-k),y,x+rx,y],["Z"]];
}

export function elementPath(el:Element,u:SvgUnits):Path|undefined {
  const x=(name:string)=>svgLength(el.getAttribute(name),u.width,u.font);
  const y=(name:string)=>svgLength(el.getAttribute(name),u.height,u.font);
  switch (el.localName) {
    case "path":
      try {return parseSvgPath(el.getAttribute("d") ?? "",false,"svg");} catch {return [];}
    case "line": return [["M",x("x1"),y("y1")],["L",x("x2"),y("y2")]];
    case "rect": {
      const w=x("width"),h=y("height");
      if (!(w>0 && h>0)) return [];
      const rx=el.hasAttribute("rx") ? x("rx") : y("ry"), ry=el.hasAttribute("ry") ? y("ry") : rx;
      return rounded(x("x"),y("y"),w,h,Math.max(0,Math.min(rx,w/2)),Math.max(0,Math.min(ry,h/2)));
    }
    case "circle": case "ellipse": {
      const circle=el.localName==="circle", rad=svgLength(el.getAttribute("r"),Math.hypot(u.width,u.height)/Math.SQRT2,u.font);
      const rx=circle ? rad : x("rx"),ry=circle ? rad : y("ry"),cx=x("cx"),cy=y("cy"),k=.5522848;
      if (!(rx>0 && ry>0)) return [];
      return [["M",cx+rx,cy],["C",cx+rx,cy+ry*k,cx+rx*k,cy+ry,cx,cy+ry],["C",cx-rx*k,cy+ry,cx-rx,cy+ry*k,cx-rx,cy],
        ["C",cx-rx,cy-ry*k,cx-rx*k,cy-ry,cx,cy-ry],["C",cx+rx*k,cy-ry,cx+rx,cy-ry*k,cx+rx,cy],["Z"]];
    }
    case "polygon": case "polyline": {
      const coords=(el.getAttribute("points") ?? "").match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
      if (coords.length<4 || coords.length%2 || !coords.every(Number.isFinite)) return [];
      const path:PathCommand[]=[];
      for(let i=0;i<coords.length;i+=2) path.push([i ? "L" : "M",coords[i],coords[i+1]]);
      if (el.localName==="polygon") path.push(["Z"]);
      return path;
    }
  }
}

function recognise(path:Path,unstroked:boolean):Primitive|undefined {
  if (path.length>40 || path[0]?.[0]!=="M" || path.slice(1).some(e=>e[0]==="M")) return;
  const a=end(path[0])!;
  if (path.length===2 && path[1][0]==="L") {
    const b=end(path[1])!;
    if (distance(a,b)>1e-9) return {kind:"line",a,b};
    return;
  }
  const box=pathBounds(path);
  if (!box || !(box.width>1e-6 && box.height>1e-6)) return;
  const tol=.002*Math.max(box.width,box.height),last=path.at(-1)!;
  if (last[0]!=="Z" && (!unstroked || distance(end(last)!,a)>tol*.001)) return;
  let pen=a,length=0,area=0;
  const samples:Point[]=[],ends:Point[]=[a];
  const cross=(p:Point,q:Point)=>p.x*q.y-p.y*q.x;
  for(const c of path.slice(1)) {
    const next=end(c) ?? a;
    if (c[0]==="C") {
      const seg:Cubic=[pen,pt(c[1],c[2]),pt(c[3],c[4]),next];
      length+=cubicLength(seg);
      for(let i=0;i<8;i++) samples.push(cubicPoint(seg,i/8));
      // Three-point Gauss–Legendre integrates the cubic's signed area exactly.
      const integrand=(t:number)=>cross(cubicPoint(seg,t),cubicDerivative(seg,t));
      const delta=Math.sqrt(3/5)/2;
      area+=(5*integrand(.5-delta)+8*integrand(.5)+5*integrand(.5+delta))/36;
    } else {
      length+=distance(pen,next);
      area+=cross(pen,next)/2;
      for(let i=0;i<8;i++) samples.push(pt(pen.x+(next.x-pen.x)*i/8,pen.y+(next.y-pen.y)*i/8));
    }
    ends.push(next);pen=next;
  }
  const {x,y,width:w,height:h}=box,cx=x+w/2,cy=y+h/2;
  const close=(v:number)=>Math.abs(length-v)<=.005*Math.max(1e-9,v);
  const term=((w-h)/(w+h))**2;
  const ellipsePerimeter=Math.PI*(w+h)/2*(1+3*term/(10+Math.sqrt(4-3*term)));
  if (close(ellipsePerimeter) && samples.every(p=>Math.abs(Math.hypot((p.x-cx)/(w/2),(p.y-cy)/(h/2))-1)*Math.min(w,h)/2<=tol))
    return {kind:"ellipse",box,radius:0};
  const estimate=Math.sqrt(Math.max(0,(w*h-Math.abs(area))/(4-Math.PI)));
  let nearest=Infinity, radius=estimate;
  for(const p of ends) for(const r of [p.x-x,x+w-p.x,p.y-y,y+h-p.y]) {
    const d=Math.abs(r-estimate);
    if (d<=.05*estimate && d<nearest) {nearest=d;radius=r;}
  }
  radius=Math.min(radius,w/2,h/2);
  radius=radius<tol ? 0 : Math.round(radius*1e6)/1e6;
  if (!close(2*(w+h)-(8-TAU)*radius)) return;
  if (samples.every(p=>{
    const dx=Math.abs(p.x-cx)-w/2+radius,dy=Math.abs(p.y-cy)-h/2+radius;
    return Math.abs(Math.hypot(Math.max(0,dx),Math.max(0,dy))+Math.min(0,Math.max(dx,dy))-radius)<=tol;
  })) return {kind:"rectangle",box,radius};
}

export function placedPrimitive(path:Path,world:Affine,unstroked:boolean) {
  const p=recognise(path,unstroked);
  if (!p) return;
  if (p.kind==="line") {
    const a=transformPoint(world,p.a),b=transformPoint(world,p.b),width=distance(a,b);
    if (width<=1e-9) return;
    const cos=(b.x-a.x)/width,sin=(b.y-a.y)/width;
    const xf:Affine=[cos,sin,-sin,cos,a.x,a.y];
    return {kind:p.kind,xf,width,height:0,radius:0};
  }
  const [a,b,c,d,e,f]=multiply(world,translated(p.box.x,p.box.y)), sx=Math.hypot(a,b),sy=Math.hypot(c,d);
  if (sx<=1e-9 || sy<=1e-9 || Math.abs(a*c+b*d)>1e-6*sx*sy || p.radius>0 && Math.abs(sx-sy)>1e-6*Math.max(sx,sy)) return;
  const xf:Affine=[a/sx,b/sx,c/sy,d/sy,e,f];
  return {kind:p.kind,xf,width:p.box.width*sx,height:p.box.height*sy,radius:p.radius*sx};
}

export function closedForFill(path:Path,tol:number,all:boolean) {
  const result:PathCommand[]=[];
  let i=0, changed=false;
  while (i<path.length) {
    let j=i+1;
    while (j<path.length && path[j][0]!=="M") j++;
    const sub=path.slice(i,j),last=sub.at(-1)!;
    if (last[0]!=="Z" && (sub.length>=3 || sub.some(c=>c[0]==="C"))) {
      const first=end(sub[0])!,near=distance(end(last)!,first)<=tol;
      if (near) sub[sub.length-1]=last[0]==="C" ? ["C",last[1],last[2],last[3],last[4],first.x,first.y] : ["L",first.x,first.y];
      if (near || all) { sub.push(["Z"]); changed=true; }
    }
    for (const c of sub) result.push(c);
    i=j;
  }
  return changed ? result : path;
}

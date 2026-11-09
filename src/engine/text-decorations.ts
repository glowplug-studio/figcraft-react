import { transformPoint } from "./affine";
import type { PathCommand } from "./corners";
import { flattenCurve } from "./curve-flatten";
import type { Point, Rectangle } from "./geometry";
import type { ShapingFace } from "./shaping-face";
import { solidPaint } from "./solid-paint";
import type { FlowGlyph, FlowLine } from "./text-flow";
import { glyphPath } from "./text-glyph-path";
import { sameTextStyle } from "./text-ranges";
import { textSize, type TextStyle } from "./text-style";

export interface TextDecoration {
  rect:Rectangle;
  kind:"solid" | "dotted" | "wavy";
  thickness:number;
  style:TextStyle;
}

const waveAmplitude=(thickness:number)=>thickness*0.75+0.5;
function lengthPx(length:TextStyle["lineHeight"] | undefined,size:number,automatic:number) {
  if (!length || length.unit==="auto") return automatic;
  const value=length.unit==="percent" ? size*length.value/100 : length.value;
  return Number.isFinite(value) ? value : automatic;
}

// The native skip-ink test measures only line segments crossing the horizontal band.
function inkCut(g:FlowGlyph,top:number,bottom:number,gap:number):[number,number] | undefined {
  const scale=g.size/g.face.upem;
  const point=(x:number,y:number):Point=>({x:g.x+x*scale,y:g.y+y*scale});
  let prev=point(0,0), lo=Infinity, hi=-Infinity;
  const line=(p:Point)=>{
    const a=prev, dy=p.y-a.y;
    prev=p;
    let t0=0,t1=1;
    if (Math.abs(dy)<1e-12) {
      if (a.y<top || a.y>bottom) return;
    } else {
      const at=(top-a.y)/dy, bt=(bottom-a.y)/dy;
      t0=Math.max(0,Math.min(at,bt)); t1=Math.min(1,Math.max(at,bt));
      if (t0>t1) return;
    }
    const left=a.x+(p.x-a.x)*t0,right=a.x+(p.x-a.x)*t1;
    lo=Math.min(lo,left,right); hi=Math.max(hi,left,right);
  };
  for (const el of g.face.outline(g.id,g.coordinates,true)) {
    if (el[0]==="M") prev=point(el[1],el[2]);
    else if (el[0]==="L") line(point(el[1],el[2]));
    else if (el[0]==="Q") flattenCurve([prev,point(el[1],el[2]),point(el[3],el[4])],0.25,Infinity,line);
    else if (el[0]==="C") flattenCurve([prev,point(el[1],el[2]),point(el[3],el[4]),point(el[5],el[6])],0.25,Infinity,line);
  }
  return lo<=hi ? [lo-gap,hi+gap] : undefined;
}

export function textDecorations(lines:readonly FlowLine[],glyphs:readonly FlowGlyph[],faceFor:(style:TextStyle)=>ShapingFace | undefined) {
  const result:TextDecoration[]=[];
  for (const line of lines) {
    for (let i=line.first;i<line.last;) {
      const first=glyphs[i++], style=first.style;
      if (first.end===first.start || style.decoration==="none") continue;
      const fromGlyph=i-1;
      while (i<line.last && glyphs[i].start<glyphs[i].end && sameTextStyle(glyphs[i].style,style)) i++;
      const last=glyphs[i-1], end=last.x+last.advance;
      const face=faceFor(style) ?? first.face, size=textSize(style), scale=size/face.upem;
      const look=style.decorationLook, kind=look?.style ?? "solid";
      const th=Math.min(size,Math.max(0.1,lengthPx(look?.thickness,size,Math.max(0.5,face.underlineThickness*scale))));
      const underline=style.decoration==="underline";
      const top=underline && look?.offset && look.offset.unit!=="auto"
        ? line.baseline+Math.max(-size,Math.min(size,lengthPx(look.offset,size,0)))
        : line.baseline-(underline ? face.underlinePosition : face.strikePosition)*scale-th/2;
      const swing=kind==="wavy" ? waveAmplitude(th) : 0;
      const gap=Math.max(th,1), cuts:[number,number][]=[];
      if (underline && look?.skipInk) {
        for (let k=fromGlyph;k<i;k++) {
          const cut=inkCut(glyphs[k],top-gap/2-swing,top+th+gap/2+swing,gap);
          if (cut) cuts.push(cut);
        }
        cuts.sort((a,b)=>a[0]-b[0]);
      }
      cuts.push([end,end]);
      const paintStyle=look?.color ? {...style,fills:[solidPaint(look.color)]} : style;
      let x=first.x;
      for (const [left,right] of cuts) {
        const stop=Math.min(left,end);
        if (stop>x+0.5) result.push({rect:{x,y:top-swing,width:stop-x,height:(top+th+swing)-(top-swing)},kind,thickness:th,style:paintStyle});
        x=Math.max(x,right);
      }
    }
  }
  return result;
}

function appendCircle(path:PathCommand[],x:number,y:number,r:number) {
  const error=r/0.05, four=error<1/1.9608e-4, n=four ? 4 : Math.ceil((1.1163*error)**(1/6));
  const arm=four ? 0.551915024494 : 4/3*Math.tan(Math.PI/(2*n));
  const step=2*Math.PI/n;
  path.push(["M",x+r,y]);
  for (let i=1;i<=n;i++) {
    const end=i*step, start=end-step;
    const c0=Math.cos(start),s0=Math.sin(start),c1=i===n ? 1 : Math.cos(end),s1=i===n ? 0 : Math.sin(end);
    path.push(["C",x+r*(c0-arm*s0),y+r*(s0+arm*c0),x+r*(c1+arm*s1),y+r*(s1-arm*c1),x+r*c1,y+r*s1]);
  }
  path.push(["Z"]);
}

export function decorationPath(d:TextDecoration):PathCommand[] {
  const {x,y,width,height}=d.rect, right=x+width, bottom=y+height;
  if (d.kind==="solid") return [["M",x,y],["L",right,y],["L",right,bottom],["L",x,bottom],["Z"]];
  const path:PathCommand[]=[], th=Math.max(0.01,d.thickness), cy=(y+bottom)/2;
  if (d.kind==="dotted") {
    let cx=x+th/2;
    for (let i=0;i<2500 && (i===0 || cx<=right-th/2+1e-9);i++,cx+=th*2) appendCircle(path,cx,cy,th/2);
  } else {
    const amplitude=waveAmplitude(th), period=amplitude*6;
    const steps=Math.max(2,Math.min(2500,Math.ceil(width/period*8)));
    const add=(i:number,side:number,op:"L" | "M")=>{
      const px=x+width*i/steps;
      path.push([op,px,cy+amplitude*Math.sin(2*Math.PI*(px-x)/period)+side*th/2]);
    };
    for (let i=0;i<=steps;i++) add(i,-1,i===0 ? "M" : "L");
    for (let i=steps;i>=0;i--) add(i,1,"L");
    path.push(["Z"]);
  }
  return path;
}

/** Native advance boxes include half an em on each side and follow each glyph transform. */
export function textInkBounds(layout:{lines:readonly FlowLine[];glyphs:readonly FlowGlyph[];decorations:readonly TextDecoration[]}):Rectangle | undefined {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const include=(x:number,y:number)=>{left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);};
  for (const line of layout.lines) {
    if (line.last>layout.glyphs.length) continue;
    for (let i=line.first;i<line.last;i++) {
      const g=layout.glyphs[i], pad=Math.abs(g.size)*0.5;
      const x0=Math.min(g.x,g.x+g.advance)-pad,x1=Math.max(g.x,g.x+g.advance)+pad;
      const y0=line.top-pad,y1=line.top+line.height+pad;
      if (g.warp) {
        for (const x of [x0,x1]) for (const y of [y0,y1]) {
          const p=transformPoint(g.warp,{x,y}); include(p.x,p.y);
        }
      } else { include(x0,y0);include(x1,y1); }
    }
  }
  for (const {rect:r} of layout.decorations) { include(r.x,r.y);include(r.x+r.width,r.y+r.height); }
  return left<=right ? {x:left,y:top,width:right-left,height:bottom-top} : undefined;
}

/** Combine glyphs and decoration contours in native paint order for outline and boolean commands. */
export function textToPath(layout:{glyphs:readonly FlowGlyph[];decorations:readonly TextDecoration[]}):PathCommand[] {
  const path:PathCommand[]=[];
  for (const g of layout.glyphs) for (const el of glyphPath(g)) path.push(el);
  for (const d of layout.decorations) for (const el of decorationPath(d)) path.push(el);
  return path;
}

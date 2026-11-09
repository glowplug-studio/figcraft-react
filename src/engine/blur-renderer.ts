import { transformPoint, type Affine } from "./affine";
import { blurPixels } from "./effect-raster";
import type { Effect } from "./effects";
import type { Point } from "./geometry";
import { reserveLayerPixels } from "./mask-renderer";

type Blur = Extract<Effect,{type:"layerBlur"|"backgroundBlur"}>;
const clampRadius = (r:number) => Math.min(10000,Math.max(0,r));
export const blurRadius = (e:Blur) => clampRadius(e.blurType==="progressive" ? Math.max(e.radius,e.startRadius) : e.radius);

function levels(lo:number, hi:number) {
  const base=Math.max(1,lo);
  const result=lo<base ? [lo] : [];
  if (hi <= base) { if (hi>lo || !result.length) result.push(hi); return result; }
  const steps=Math.min(6,Math.max(1,Math.ceil(Math.log(hi/base)/Math.log(1.5))));
  for(let i=0;i<steps;i++) result.push(base*(hi/base)**(i/steps));
  result.push(hi);
  return result;
}

/** Native progressive blur mixes two neighbouring Gaussian levels at each
 * pixel centre. Each level reads only the area used by it plus its box-pass halo. */
export function progressiveBlur(data:Uint8Array,w:number,h:number,s0:number,s1:number,a:Point,b:Point) {
  const cap=(s:number)=>Number.isFinite(s) ? Math.max(0,Math.min(1e6,s)) : 0;
  s0=cap(s0); s1=cap(s1);
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if (!Number.isFinite(len2) || len2<=1e-12 || Math.abs(s1-s0)<.05) {
    blurPixels(data,w,h,4,s1); return;
  }
  const tx=dx/len2, ty=dy/len2, t0=(.5-a.x)*tx+(.5-a.y)*ty;
  const sigmas=levels(Math.min(s0,s1),Math.max(s0,s1));
  const regions=sigmas.map(()=>({x0:w,y0:h,x1:-1,y1:-1}));
  const selection=new Uint16Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const sigma=s0+(s1-s0)*Math.min(1,Math.max(0,t0+x*tx+y*ty));
    let k=0;
    while(k<sigmas.length-2 && sigmas[k+1]<=sigma) k++;
    const f=Math.round(255*Math.max(0,Math.min(1,(sigma-sigmas[k])/(sigmas[k+1]-sigmas[k]))));
    selection[y*w+x]=(k<<8)|f;
    for(let j=k;j<=k+(f>0?1:0);j++) {
      const bounds=regions[j];
      bounds.x0=Math.min(bounds.x0,x); bounds.x1=Math.max(bounds.x1,x);
      bounds.y0=Math.min(bounds.y0,y); bounds.y1=Math.max(bounds.y1,y);
    }
  }
  const acc=new Uint16Array(data.length);
  for(let k=0;k<sigmas.length;k++) {
    const {x0,y0,x1,y1}=regions[k];
    if (x1<x0) continue;
    const halo=Math.ceil(sigmas[k]*3)+3;
    const left=Math.max(0,x0-halo), top=Math.max(0,y0-halo);
    const width=Math.min(w,x1+halo+1)-left, height=Math.min(h,y1+halo+1)-top;
    const level=new Uint8Array(width*height*4);
    for(let row=0;row<height;row++){
      const start=((row+top)*w+left)*4;
      level.set(data.subarray(start,start+width*4),row*width*4);
    }
    blurPixels(level,width,height,4,sigmas[k]);
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const i=y*w+x, pair=selection[i], lower=pair>>>8, f=pair&255;
      const weight=lower===k ? 255-f : lower+1===k ? f : 0;
      if (!weight) continue;
      const src=((y-top)*width+x-left)*4;
      for(let c=0;c<4;c++) acc[i*4+c]+=weight*level[src+c];
    }
  }
  for(let i=0;i<data.length;i++) data[i]=Math.floor((acc[i]+127)/255);
}

export function applyBlur(ctx:CanvasRenderingContext2D,blur:Blur,width:number,height:number,xf:Affine,scale:number) {
  const {width:w,height:h}=ctx.canvas;
  if (!(blurRadius(blur)*scale/2>.3)) return;
  const progressive=blur.blurType==="progressive";
  const release=reserveLayerPixels(w,h,progressive ? 7 : 3);
  if (!release) return;
  try {
    const image=ctx.getImageData(0,0,w,h), pixels=image.data;
    const data=new Uint8Array(pixels.length);
    for(let i=0;i<data.length;i+=4) {
      const a=pixels[i+3];
      for(let c=0;c<3;c++) data[i+c]=Math.round(pixels[i+c]*a/255);
      data[i+3]=a;
    }
    const endSigma=clampRadius(blur.radius)*scale/2;
    if (progressive) {
      const point=(p:readonly [number,number])=>transformPoint(xf,{
        x:width*Math.max(-1000,Math.min(1000,p[0])), y:height*Math.max(-1000,Math.min(1000,p[1]))});
      progressiveBlur(data,w,h,clampRadius(blur.startRadius)*scale/2,endSigma,point(blur.start),point(blur.end));
    } else blurPixels(data,w,h,4,endSigma);
    for(let i=0;i<data.length;i+=4) {
      const a=data[i+3];
      for(let c=0;c<3;c++) pixels[i+c]=a ? Math.round(data[i+c]*255/a) : 0;
      pixels[i+3]=a;
    }
    ctx.putImageData(image,0,0);
  } finally {release();}
}

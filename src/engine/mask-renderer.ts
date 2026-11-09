import { multiply, transformBounds, type Affine } from "./affine";
import { maskOutline } from "./boolean-result";
import { tracePath } from "./corners";
import { layerTransform, type Document, type LayerNode } from "./document";
import type { Rectangle } from "./geometry";
import type { PaintSteps } from "./image-renderer";
import { pathBounds } from "./vector-path";

/** The native renderer accounts for live RGBA layers on the rendering thread. */
const layerByteLimit = 2 * 1024 ** 3;
let held = 0;
export function reserveLayerPixels(width:number,height:number,count:number) {
  const bytes=width*height*4*count;
  if (held+bytes>layerByteLimit) return;
  held+=bytes;
  return () => {held-=bytes;};
}

interface Outline {path:Path2D; rule:CanvasFillRule; bounds:Rectangle}
const outlines=new WeakMap<Document,Map<string,Outline|undefined>>();

function outlineFor(doc:Document,node:LayerNode,depth:number) {
  let cached=outlines.get(doc);
  if (!cached) {cached=new Map(); outlines.set(doc,cached);}
  const key=node.id+"/"+depth;
  if (cached.has(key)) return cached.get(key);
  const outline=maskOutline(doc,node,depth);
  const bounds=outline && pathBounds(outline.path);
  let result:Outline|undefined;
  if (outline && bounds) {
    const path=new Path2D(); tracePath(path,outline.path);
    result={path,rule:outline.rule,bounds};
  }
  cached.set(key,result);
  return result;
}

function applyLuminance(ctx:CanvasRenderingContext2D) {
  const {width,height}=ctx.canvas;
  const rows=Math.max(1,Math.floor(262144/width));
  for(let y=0;y<height;y+=rows) {
    const image=ctx.getImageData(0,y,width,Math.min(rows,height-y));
    const pixels=image.data;
    for(let i=0;i<pixels.length;i+=4) {
      const alpha=pixels[i+3];
      if (alpha) pixels[i+3]=Math.ceil((.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])*alpha/255);
    }
    ctx.putImageData(image,0,y);
  }
}

type DrawLayer = (ctx:CanvasRenderingContext2D,doc:Document,node:LayerNode,depth:number,nesting:number,scale:number)=>PaintSteps;
type Bounds = (ctx:CanvasRenderingContext2D,doc:Document,node:LayerNode,scale:number)=>Rectangle|undefined;

export function* drawMasked(ctx:CanvasRenderingContext2D,doc:Document,mask:LayerNode,
  children:readonly string[],start:number,end:number,depth:number,nesting:number,draw:DrawLayer,boundsOf:Bounds,scale:number):PaintSteps {
  if (start>=end || depth>256) return;
  const m=ctx.getTransform(), matrix:Affine=[m.a,m.b,m.c,m.d,m.e,m.f];
  const outline=mask.maskType==="vector" ? outlineFor(doc,mask,depth) : undefined;
  let bounds:Rectangle|undefined;
  if (mask.maskType==="vector") {
    if (!outline) return;
    const b=outline.bounds;
    bounds=transformBounds(multiply(multiply(matrix,layerTransform(mask)),[1,0,0,1,b.x,b.y]),b.width,b.height);
  } else bounds=boundsOf(ctx,doc,mask,scale);
  if (!bounds) return;
  // Native masked_area includes both the mask and content, with a pixel for antialiasing.
  let x0=bounds.x, y0=bounds.y, x1=x0+bounds.width, y1=y0+bounds.height;
  for (let i=start;i<end;i++) {
    const child=doc.nodes[children[i]];
    if (!child || child.kind==="page" || child.visible===false) continue;
    const box=boundsOf(ctx,doc,child,scale);
    if (!box) continue;
    x0=Math.min(x0,box.x); y0=Math.min(y0,box.y);
    x1=Math.max(x1,box.x+box.width); y1=Math.max(y1,box.y+box.height);
  }
  const left=Math.max(0,Math.floor(x0-1)), top=Math.max(0,Math.floor(y0-1));
  const width=Math.min(ctx.canvas.width,Math.ceil(x1+1))-left;
  const height=Math.min(ctx.canvas.height,Math.ceil(y1+1))-top;
  if (width<=0 || height<=0) return;
  const release=reserveLayerPixels(width,height,4);
  if (!release) return;

  const maskCanvas=ctx.canvas.ownerDocument.createElement("canvas");
  const contentCanvas=ctx.canvas.ownerDocument.createElement("canvas");
  try {
    maskCanvas.width=contentCanvas.width=width; maskCanvas.height=contentCanvas.height=height;
    const coverage=maskCanvas.getContext("2d",{willReadFrequently:mask.maskType==="luminance"})!;
    const content=contentCanvas.getContext("2d")!;
    coverage.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);
    if (outline) {
      coverage.transform(...layerTransform(mask));
      coverage.fillStyle="white"; coverage.fill(outline.path,outline.rule);
    } else {
      // The mask's own blend has no backdrop. Its painted alpha and node opacity still apply.
      yield* draw(coverage,doc,{...mask,isMask:false,blend:mask.blend==="normal"?"normal":"passThrough"},depth,nesting,scale);
      if (mask.maskType==="luminance") applyLuminance(coverage);
    }
    content.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);
    for (let i=start;i<end;i++) {
      const child=doc.nodes[children[i]];
      if (child && child.kind!=="page") yield* draw(content,doc,child,depth,nesting,scale);
    }
    content.resetTransform();
    content.globalCompositeOperation="destination-in";
    content.drawImage(maskCanvas,0,0);
    ctx.save();
    try {ctx.resetTransform(); ctx.drawImage(contentCanvas,left,top);}
    finally {ctx.restore();}
  } finally {
    maskCanvas.width=maskCanvas.height=contentCanvas.width=contentCanvas.height=0;
    release();
  }
}

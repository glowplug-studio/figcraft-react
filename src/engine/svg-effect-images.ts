import { multiply, type Affine } from "./affine";
import { backdropPixels, effectView as view, isolatedEffectDocument as alone, type EffectView as View } from "./export-effect-raster";
import { renderAreaPixels } from "./canvas";
import { type Document, type LayerNode } from "./document";
import { grainPixels } from "./grain-renderer";
import { worldTransform } from "./hierarchy";
import { base64Bytes } from "./recovery";
import { expand, worldRenderBounds } from "./render-bounds";
import { alphaFills } from "./shadow-renderer";
import { svgBlend, svgMatrix } from "./svg-format";
import { filterMargin } from "./svg-shadows";

const surface=()=>document.createElement("canvas");
async function image(canvas:HTMLCanvasElement,v:View,origin:Affine,attrs="") {
  const ctx=canvas.getContext("2d")!;
  let painted=false;
  // Scan narrow strips so inspecting an empty 4K layer needs no second full frame.
  for (let y=0;y<canvas.height && !painted;y+=64) {
    const rgba=ctx.getImageData(0,y,canvas.width,Math.min(64,canvas.height-y)).data;
    for (let i=3;i<rgba.length;i+=4) if (rgba[i]) { painted=true; break; }
  }
  if (!painted) return "";
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b ? resolve(b) : reject(new Error("Could not encode SVG effect image")),"image/png"));
  const xf=multiply(origin,[1/v.scale,0,0,1/v.scale,v.box.x,v.box.y]);
  return '<image transform="'+svgMatrix(xf)+'" width="'+canvas.width+'" height="'+canvas.height+'"'+attrs+' href="data:image/png;base64,'+base64Bytes(new Uint8Array(await blob.arrayBuffer()))+'"/>';
}

export function rasterWhole(doc:Document,node:LayerNode) {
  const visible=node.effects?.filter(e=>e.visible);
  return visible?.some(e=>e.type==="texture" || e.type==="layerBlur" && e.blurType==="progressive")
    || visible?.some(e=>e.type==="noise") && visible.some(e=>e.type==="layerBlur")
    || visible?.some(e=>e.type==="innerShadow") && (node.kind==="group" || alphaFills(doc,node,true));
}

export async function wholeEffectImage(doc:Document,node:LayerNode,origin:Affine,depth:number) {
  const b=worldRenderBounds(doc,node.id), world=worldTransform(doc,node.id);
  const k=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2])) || 1;
  const v=view(b && expand(b,filterMargin(node)*k));
  if (!v) return "";
  const canvas=surface();
  try {
    await renderAreaPixels(canvas,alone(doc,node,false),v.box,v.scale,[node.id],undefined,0,undefined,"srgb",false,depth);
    return await image(canvas,v,origin);
  } finally { canvas.width=canvas.height=0; }
}

export async function grainImages(doc:Document,node:LayerNode,origin:Affine,depth:number) {
  const effects=node.effects?.filter(e=>e.type==="noise" && e.visible);
  if (!effects?.length) return "";
  const world=worldTransform(doc,node.id);
  const k=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2]));
  let grain=Infinity;
  for (const e of effects) if (e.type==="noise") grain=Math.min(grain,2*Math.max(.01,Math.min(1000,e.size,e.sizeY ?? e.size))*k);
  const rate=grain>0 ? Math.min(4,Math.max(2,2/grain)) : 2;
  const v=view(worldRenderBounds(doc,node.id),rate);
  if (!v) return "";
  const canvas=surface();
  try {
    await renderAreaPixels(canvas,alone(doc,node,true),v.box,v.scale,[node.id],undefined,0,undefined,"srgb",false,depth);
    const ctx=canvas.getContext("2d")!, data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const source=new Uint8Array(data.data.buffer,data.data.byteOffset,data.data.byteLength);
    const work=ctx.createImageData(canvas.width,canvas.height);
    const xf=multiply(v.xf,world), seed=Number(BigInt.asUintN(32,BigInt(node.id)));
    const images:string[]=[];
    for (const e of effects) {
      if (e.type!=="noise") continue;
      const pixels=grainPixels(source,canvas.width,canvas.height,e,xf,v.scale,seed);
      if (!pixels) continue;
      for (let i=0;i<pixels.length;i+=4) {
        const a=pixels[i+3];
        for (let c=0;c<3;c++) work.data[i+c]=a ? Math.round(pixels[i+c]*255/a) : 0;
        work.data[i+3]=a;
      }
      ctx.putImageData(work,0,0);
      const style=svgBlend(e.blend).replace(' style="',";").replace('"',"");
      images.push(await image(canvas,v,origin,' style="image-rendering:pixelated'+style+'"'));
    }
    return images.join("");
  } finally { canvas.width=canvas.height=0; }
}

export async function backdropImage(doc:Document,node:LayerNode,roots:readonly string[],origin:Affine,attrs="") {
  return await backdropPixels(doc,node,roots,(canvas,v)=>image(canvas,v,origin,attrs)) ?? "";
}

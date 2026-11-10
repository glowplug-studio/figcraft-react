import { multiply, transformBounds, type Affine } from "./affine";
import { hasBackdrop, renderBackdrop, backdropPadding } from "./backdrop-renderer";
import { maskOutline } from "./boolean-result";
import { renderAreaPixels } from "./canvas";
import { isFrameLike, isLeaf, type Document, type DocumentNode, type LayerNode } from "./document";
import { grainPixels } from "./grain-renderer";
import { worldTransform } from "./hierarchy";
import { base64Bytes } from "./recovery";
import { expand, worldRenderBounds } from "./render-bounds";
import { alphaFills } from "./shadow-renderer";
import { shapePath } from "./shape-path";
import { svgBlend, svgMatrix } from "./svg-format";
import { filterMargin } from "./svg-shadows";
import { pathBounds } from "./vector-path";
import type { Rectangle } from "./geometry";

const surface=()=>document.createElement("canvas");
function view(box: Rectangle | undefined, rate=2) {
  if (!box || !(box.width>0 && box.height>0) || !Object.values(box).every(Number.isFinite)) return;
  const scale=Math.min(rate,4096/Math.max(box.width,box.height));
  const xf:Affine=[scale,0,0,scale,-box.x*scale,-box.y*scale];
  return {box,scale,xf,width:Math.max(1,Math.ceil(box.width*scale)),height:Math.max(1,Math.ceil(box.height*scale))};
}
type View = NonNullable<ReturnType<typeof view>>;

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

function alone(doc:Document,node:LayerNode,plain:boolean):Document {
  const effects=plain ? [] : node.effects?.filter(e=>e.type!=="backgroundBlur" && e.type!=="glass");
  const replacement:LayerNode={...node,isMask:false,effects,...(plain && {opacity:1,blend:"normal"})};
  const nodes={...doc.nodes,[node.id]:replacement};
  return {...doc,nodes};
}

function beneath(doc:Document, roots:readonly string[], id:string):Document {
  const nodes:Record<string,DocumentNode>={...doc.nodes};
  function hide(key:string) {
    const n=nodes[key];
    if (n && n.kind!=="page") nodes[key]={...n,visible:false};
  }
  hide(id);
  let current=id;
  for (let depth=0;depth<=256;depth++) {
    const root=roots.indexOf(current);
    if (root>=0) { for (let i=root+1;i<roots.length;i++) hide(roots[i]); break; }
    const parentId=nodes[current]?.parent;
    if (!parentId) break;
    const p=nodes[parentId];
    if (!p || isLeaf(p)) break;
    const siblings=p.children, index=siblings.indexOf(current);
    if (index>=0) {
      if (isFrameLike(p) && p.layout?.reverseZ) { for (let i=0;i<index;i++) hide(siblings[i]); }
      else for (let i=index+1;i<siblings.length;i++) hide(siblings[i]);
    }
    nodes[parentId]={...p,strokes:[]};
    current=parentId;
  }
  return {...doc,nodes};
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
  if (!hasBackdrop(node)) return "";
  const outline=isFrameLike(node) ? shapePath(node) : maskOutline(doc,node,0)?.path;
  const bounds=outline && pathBounds(outline);
  if (!bounds) return "";
  const world=worldTransform(doc,node.id), box=transformBounds(multiply(world,[1,0,0,1,bounds.x,bounds.y]),bounds.width,bounds.height);
  const v=view(box);
  if (!v) return "";
  const pad=backdropPadding(node,v.scale);
  const area={x:box.x-pad/v.scale,y:box.y-pad/v.scale,width:(v.width+2*pad)/v.scale,height:(v.height+2*pad)/v.scale};
  const canvas=surface();
  let rendered:CanvasRenderingContext2D|undefined;
  try {
    await renderAreaPixels(canvas,beneath(doc,roots,node.id),area,v.scale,roots,undefined,1e-6);
    rendered=renderBackdrop(canvas.getContext("2d")!,doc,node,pad,pad,v.width,v.height,multiply(v.xf,world),v.scale);
    return rendered ? await image(rendered.canvas,v,origin,attrs) : "";
  } finally {
    if (rendered) rendered.canvas.width=rendered.canvas.height=0;
    canvas.width=canvas.height=0;
  }
}

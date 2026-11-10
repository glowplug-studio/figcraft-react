import { identity,inverse,multiply,transformBounds,type Affine } from "../affine";
import { isLeaf,rectanglePaints,type Document as Drawing } from "../document";
import { worldTransform } from "../hierarchy";
import { imageTransform } from "../image-placement";
import { imageHash,type ImageResource } from "../image-resource";
import { readPaint,type Paint } from "../solid-paint";
import { translated } from "./geometry";
import type { PaintTarget } from "./gradient";
import { svgImageKey } from "./image";
import { svgLength,transformList,viewBox,viewportTransform,type SvgUnits } from "./style";

export interface TileContext {width:number;height:number;transform:Affine;units:SvgUnits}
interface Tile {key:string;resource:ImageResource;content:Affine}
export type TileCache=WeakMap<Element,Map<string,Tile|undefined>>;

async function drawTile(doc:Drawing,id:string,w:number,h:number,scale:number):Promise<Tile|undefined> {
  const frame=doc.nodes[id];
  let node=frame;
  while(!isLeaf(node) && node.children.length===1 && !(node.effects?.length || node.isMask || (node.opacity ?? 1)!==1)) node=doc.nodes[node.children[0]];
  if (node.kind==="rectangle" && !node.effects?.length && !node.strokes?.length && !node.corners && (node.opacity ?? 1)===1) {
    const fills=rectanglePaints(node),fill=fills[0];
    const resource=fill?.type==="image" && doc.images?.[fill.image];
    if (fills.length===1 && fill.type==="image" && resource && fill.visible && fill.opacity===1 && fill.scale_mode==="fill") {
      const content=multiply(worldTransform(doc,node.id),imageTransform(fill,resource.width,resource.height,node.width,node.height));
      const rect=transformBounds(content,resource.width,resource.height);
      if (rect.x>=-.001 && rect.y>=-.001 && rect.x+rect.width<=w+.001 && rect.y+rect.height<=h+.001) return {key:fill.image,resource,content};
    }
  }
  const {renderAreaPixels}=await import("../canvas");
  const canvas=document.createElement("canvas");
  try {
    if (!await renderAreaPixels(canvas,doc,{x:0,y:0,width:w,height:h},scale,[id])) return;
    const bytes=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
    if (!bytes) return;
    const encoded=new Uint8Array(await bytes.arrayBuffer());
    return {key:svgImageKey(encoded),resource:{bytes,digest:await imageHash(encoded),width:canvas.width,height:canvas.height},
      content:[w/canvas.width,0,0,h/canvas.height,0,0]};
  } finally {canvas.width=canvas.height=0;}
}

export async function svgPattern(server:Element,target:PaintTarget,u:SvgUnits,opacity:number,cache:TileCache,
  draw:(parent:Element,context:TileContext)=>Promise<{document:Drawing;id:string}>,note:(text:string)=>void) {
  const chain:Element[]=[];
  let el:Element|null=server;
  while(el?.localName==="pattern") {
    if (chain.includes(el) || chain.length>=64) return;
    chain.push(el);
    const href:string|null=el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink","href");
    el=href?.startsWith("#") ? server.ownerDocument.getElementById(href.slice(1)) : null;
  }
  const attr=(key:string)=>chain.find(n=>n.hasAttribute(key))?.getAttribute(key);
  const box=target.bounds, bbox=attr("patternUnits")!=="userSpaceOnUse";
  const len=(key:string,horizontal:boolean)=>svgLength(attr(key),bbox ? 1 : horizontal ? u.width : u.height,u.font)*(bbox ? horizontal ? box.width : box.height : 1);
  const w=len("width",true),h=len("height",false);
  if (!(w>0 && h>0)) return;
  const def=chain.find(n=>n.hasAttribute("patternTransform")) as SVGPatternElement|undefined;
  const matrix=multiply(multiply(target.toNode,def ? transformList(def.patternTransform.baseVal) : identity),
    translated(len("x",true)+(bbox ? box.x : 0),len("y",false)+(bbox ? box.y : 0)));
  const det=matrix[0]*matrix[3]-matrix[1]*matrix[2];
  if (Math.abs(det)<1e-12) return;
  const aspect=chain.find(n=>n.hasAttribute("viewBox")),view=aspect && viewBox(aspect);
  const scaled=attr("patternContentUnits")==="objectBoundingBox";
  const transform:Affine=aspect ? viewportTransform(aspect,w,h) : scaled ? [box.width,0,0,box.height,0,0] : identity;
  const parent=chain.find(n=>n.children.length);
  if (!parent) return;
  const units={width:view?.width ?? (scaled ? 1 : u.width),height:view?.height ?? (scaled ? 1 : u.height),font:u.font};
  const scale=Math.min(2048/Math.max(w,h),Math.max(.01,2*Math.sqrt(Math.abs(det))));
  const key=[w,h,scale,...transform,units.width,units.height,u.font].join(",");
  let tiles=cache.get(server);
  if (!tiles) {tiles=new Map();cache.set(server,tiles);}
  if (!tiles.has(key)) {
    const scene=await draw(parent,{width:w,height:h,transform,units});
    tiles.set(key,await drawTile(scene.document,scene.id,w,h,scale));
  }
  const tile=tiles.get(key);
  if (!tile) return;
  const {width:iw,height:ih}=tile.resource;
  const node=transformBounds(inverse(matrix),target.width,target.height);
  const image=transformBounds(tile.content,iw,ih);
  const copies=(lo:number,size:number,start:number,length:number,period:number)=>[
    Math.ceil((lo-start-length)/period+1e-6),Math.floor((lo+size-start)/period-1e-6)];
  const [x0,x1]=copies(node.x,node.width,image.x,image.width,w),[y0,y1]=copies(node.y,node.height,image.y,image.height,h);
  if (x0>x1 || y0>y1) return;
  const fields:Record<string,unknown>={type:"image",image:tile.key,opacity};
  if (x0===x1 && y0===y1) {
    const m=multiply(multiply(matrix,translated(x0*w,y0*h)),tile.content);
    const same=(mode:"fill"|"fit")=>{
      const expected=imageTransform({scale_mode:mode,scale:1,rotation:0,crop:null},iw,ih,target.width,target.height);
      return m.every((v,i)=>Math.abs(v-expected[i])<=.001*(1+Math.abs(v)));
    };
    if (!same("fill")) {
      if (same("fit")) fields.scale_mode="fit";
      else {fields.scale_mode="crop";fields.crop=multiply([1/iw,0,0,1/ih,0,0],multiply(inverse(m),[target.width,0,0,target.height,0,0]));}
    }
  } else {
    const [a,b,c,d,x,y]=multiply(matrix,tile.content);
    if (Math.abs(image.width-w)>=.001*w || Math.abs(image.height-h)>=.001*h || Math.abs(b)>=1e-9 || Math.abs(c)>=1e-9 || a<=0 || Math.abs(a-d)>=1e-6*a) {
      note("a rotated, skewed or spaced-out pattern was left out");return;
    }
    const phase=(v:number,period:number)=>Math.abs(v/period-Math.round(v/period));
    if (phase(x,iw*a)>.001 || phase(y,ih*a)>.001) note("a pattern's offset was dropped: its tiles start at the layer's corner");
    fields.scale_mode="tile";fields.scale=a;
  }
  return {paint:readPaint(fields) as Paint,image:{hash:tile.key,resource:tile.resource}};
}

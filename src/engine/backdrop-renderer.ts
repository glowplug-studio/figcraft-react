import { type Affine } from "./affine";
import { maskOutline } from "./boolean-result";
import { applyBlur, blurRadius } from "./blur-renderer";
import { readBackdrop } from "./backdrop-stack";
import { tracePath } from "./corners";
import type { Document, LayerNode } from "./document";
import { subtreeIds } from "./hierarchy";
import { reserveLayerPixels } from "./mask-renderer";
import { shapePath } from "./shape-path";

export function hasBackdrop(node: LayerNode) {
  return node.effects?.some(e=>e.visible && e.type==="backgroundBlur" && blurRadius(e)>0);
}
export function nestedBackdrop(doc:Document,node:LayerNode) {
  return "children" in node && subtreeIds(doc,node.id).some(id=>{
    const child=doc.nodes[id];
    return id!==node.id && child.kind!=="page" && hasBackdrop(child);
  });
}

/** Captures background blur separately from the content that casts shadows.
 * Each entry samples the same backdrop, then composites through the shape. */
export function renderBackdrop(ctx:CanvasRenderingContext2D, doc:Document, node:LayerNode,
  left:number, top:number, width:number, height:number, xf:Affine, scale:number) {
  const outline=node.kind==="frame" ? {path:shapePath(node),rule:"nonzero" as const} : maskOutline(doc,node,0);
  if (!outline?.path.length) return;
  let maxRadius=0;
  for(const e of node.effects ?? []) if(e.visible && e.type==="backgroundBlur") maxRadius=Math.max(maxRadius,blurRadius(e));
  if (!maxRadius) return;
  const pad=Math.min(2048,Math.ceil(1.5*maxRadius*scale+3)), w=width+pad*2,h=height+pad*2;
  const release=reserveLayerPixels(w,h,3);
  if (!release) return;
  const make=()=>ctx.canvas.ownerDocument.createElement("canvas");
  const source=make(), filtered=make(), output=make();
  let complete=false;
  try {
    source.width=filtered.width=w; source.height=filtered.height=h;
    output.width=width; output.height=height;
    const back=source.getContext("2d")!, work=filtered.getContext("2d",{willReadFrequently:true})!, out=output.getContext("2d")!;
    readBackdrop(back,ctx,left-pad,top-pad);
    const path=new Path2D(); tracePath(path,outline.path);
    out.save(); out.setTransform(...xf); out.clip(path,outline.rule); out.resetTransform();
    const padded:Affine=[xf[0],xf[1],xf[2],xf[3],xf[4]+pad,xf[5]+pad];
    for(const e of node.effects ?? []) if(e.visible && e.type==="backgroundBlur" && blurRadius(e)>0) {
      work.clearRect(0,0,w,h); work.drawImage(source,0,0);
      applyBlur(work,e,node.width,node.height,padded,scale);
      out.drawImage(filtered,-pad,-pad);
    }
    out.restore(); complete=true;
    return out;
  } finally {
    filtered.width=filtered.height=source.width=source.height=0;
    if(!complete) output.width=output.height=0;
    release();
  }
}

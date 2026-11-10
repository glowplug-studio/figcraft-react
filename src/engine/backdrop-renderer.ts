import { type Affine } from "./affine";
import { maskOutline } from "./boolean-result";
import { applyBlur, blurRadius } from "./blur-renderer";
import { readBackdrop } from "./backdrop-stack";
import { tracePath } from "./corners";
import { isFrameLike, type Document, type LayerNode } from "./document";
import { glassBackdropRadius, renderGlass } from "./glass-renderer";
import { subtreeIds } from "./hierarchy";
import { reserveLayerPixels } from "./mask-renderer";
import { shapePath } from "./shape-path";

export function hasBackdrop(node: LayerNode) {
  return node.effects?.some(e=>e.visible && (e.type==="glass" || e.type==="backgroundBlur" && blurRadius(e)>0));
}
export function nestedBackdrop(doc:Document,node:LayerNode) {
  return "children" in node && subtreeIds(doc,node.id).some(id=>{
    const child=doc.nodes[id];
    return id!==node.id && child.kind!=="page" && hasBackdrop(child);
  });
}

export function backdropPadding(node:LayerNode,scale:number) {
  let maxRadius=0;
  for (const e of node.effects ?? []) {
    if (!e.visible) continue;
    if (e.type === "backgroundBlur") maxRadius = Math.max(maxRadius, blurRadius(e));
    if (e.type === "glass") maxRadius = Math.max(maxRadius, glassBackdropRadius(e));
  }
  return maxRadius ? Math.min(2048,Math.ceil(1.5*maxRadius*scale+3)) : 0;
}

/** Captures background blur separately from the content that casts shadows.
 * Each entry samples the same backdrop, then composites through the shape. */
export function renderBackdrop(ctx:CanvasRenderingContext2D, doc:Document, node:LayerNode,
  left:number, top:number, width:number, height:number, xf:Affine, scale:number) {
  const outline=isFrameLike(node) ? {path:shapePath(node),rule:"nonzero" as const} : maskOutline(doc,node,0);
  if (!outline?.path.length) return;
  if (!hasBackdrop(node)) return;
  const pad=backdropPadding(node,scale), w=width+pad*2,h=height+pad*2;
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
    const padded:Affine=[xf[0],xf[1],xf[2],xf[3],xf[4]+pad,xf[5]+pad];
    for (const e of node.effects ?? []) {
      if (!e.visible) continue;
      if (e.type === "glass") {
        renderGlass(out,back,node,outline.path,path,outline.rule,xf,e,scale,pad);
      } else if (e.type === "backgroundBlur" && blurRadius(e)>0) {
        work.clearRect(0,0,w,h); work.drawImage(source,0,0);
        applyBlur(work,e,node.width,node.height,padded,scale);
        out.save(); out.setTransform(...xf); out.clip(path,outline.rule); out.resetTransform();
        out.drawImage(filtered,-pad,-pad); out.restore();
      }
    }
    complete=true;
    return out;
  } finally {
    filtered.width=filtered.height=source.width=source.height=0;
    if(!complete) output.width=output.height=0;
    release();
  }
}

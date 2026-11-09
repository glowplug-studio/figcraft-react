import { multiply } from "./affine";
import { backdropParent } from "./backdrop-stack";
import { hasBackdrop, nestedBackdrop, renderBackdrop } from "./backdrop-renderer";
import { applyBlur, blurRadius } from "./blur-renderer";
import { applyGrain } from "./grain-renderer";
import { rectangleTransform, type Document, type LayerNode } from "./document";
import type { PaintSteps } from "./image-renderer";
import { hasShadows, ShadowLayer } from "./shadow-renderer";

/** Effects have page-space offsets and radii. An outline's spread also follows its local affine. */
export function effectReach(node: LayerNode) {
  let page = 0, local = 0;
  for (const e of node.effects ?? []) if (e.visible && e.type === "dropShadow") {
    page = Math.max(page, Math.min(1e12, 2 * Math.abs(e.radius) + Math.abs(e.offset[0]) + Math.abs(e.offset[1]) + 4 * Math.abs(e.spread)));
    local = Math.max(local, Math.min(1e12, 4 * Math.max(0, e.spread)));
  }
  let squared = 0, scatter = 0;
  for (const e of node.effects ?? []) if (e.visible && e.type === "layerBlur") squared += (1.5 * blurRadius(e)) ** 2;
  for (const e of node.effects ?? []) if (e.visible && e.type === "texture" && !e.clipToShape) scatter += Math.min(1e12,Math.abs(e.radius));
  return { page: page + Math.sqrt(squared) + scatter, local };
}

export function usesPixelLayer(node: LayerNode) {
  return node.effects?.some(e => e.visible && (e.type === "dropShadow" || e.type === "innerShadow" || e.type === "glass" || e.type === "noise" || e.type === "texture" ||
    (e.type === "layerBlur" || e.type === "backgroundBlur") && blurRadius(e) > 0));
}

export function effectMargin(node:LayerNode,scale:number) {
  let margin = 0;
  let blurMargin = 0;
  for (const e of node.effects ?? []) {
    if (e.visible && e.type === "backgroundBlur") margin = Math.max(margin, Math.ceil(2 * blurRadius(e) * scale));
    if (e.visible && e.type === "texture") blurMargin += Math.abs(e.radius) * scale;
    if (e.visible && e.type === "layerBlur") blurMargin += 2 * blurRadius(e) * scale;
    if (e.visible && (e.type === "dropShadow" || e.type === "innerShadow")) {
      const reach = 2 * Math.abs(e.radius) + 4 * Math.abs(e.spread) + Math.abs(e.offset[0]) + Math.abs(e.offset[1]);
      margin = Math.max(margin, Math.min(2048, Math.ceil(reach * scale) + 1));
    }
  }
  return Math.min(2048, margin + Math.ceil(blurMargin));
}

/** A backdrop with drop shadows is read twice when children need the initial
 * backdrop. The shadows cast from the content and the final blur sees them. */
export function* drawLayerEffects(context:CanvasRenderingContext2D,scratch:CanvasRenderingContext2D,
  node:LayerNode,draw:(target:CanvasRenderingContext2D,shadows?:ShadowLayer)=>PaintSteps,
  left:number,top:number,doc:Document,scale:number):PaintSteps {
  const {width,height}=scratch.canvas;
  const shadows = hasShadows(node) ? new ShadowLayer(scratch,doc,node,scale) : undefined;
  const backdrop = hasBackdrop(node);
  const casts = backdrop && node.effects?.some(e=>e.visible && e.type==="dropShadow");
  const m = scratch.getTransform();
  const xf = multiply([m.a,m.b,m.c,m.d,m.e,m.f],rectangleTransform(node));
  const readBack = () => renderBackdrop(context,doc,node,left,top,width,height,xf,scale);
  const hasFilters = node.effects?.some(e=>e.visible && (e.type==="layerBlur" || e.type==="noise" || e.type==="texture"));
  const filter = () => {
    if (!hasFilters) return;
    for (const e of node.effects ?? []) {
      if (!e.visible) continue;
      if (e.type === "layerBlur") applyBlur(scratch,e,node.width,node.height,xf,scale);
      if (e.type === "noise" || e.type === "texture") applyGrain(scratch,e,xf,scale,node.id);
    }
  };
  let firstBack: CanvasRenderingContext2D | undefined, original: HTMLCanvasElement | undefined;
  let detachBack: (()=>void) | undefined, detachLayer: (()=>void) | undefined;
  try {
    if (backdrop && (!casts || nestedBackdrop(doc,node))) firstBack=readBack();
    if (casts && firstBack) {
      detachBack=backdropParent(firstBack,context,left,top,node.opacity??1,node.blend??"normal");
      detachLayer=backdropParent(scratch,firstBack,0,0,1,"normal");
    } else {
      detachLayer=backdropParent(scratch,context,left,top,node.opacity??1,node.blend??"normal");
      if (firstBack) {
        scratch.save(); scratch.resetTransform(); scratch.drawImage(firstBack.canvas,0,0); scratch.restore();
      }
    }
    yield* draw(scratch,shadows);
    if (casts && hasFilters) {
      original=context.canvas.ownerDocument.createElement("canvas");
      original.width=width; original.height=height; original.getContext("2d")!.drawImage(scratch.canvas,0,0);
    }
    filter();
    shadows?.drop(context,left,top);
    if (casts) {
      const after=readBack();
      if (after) {
        try {
          scratch.save(); scratch.resetTransform();
          if (original) { scratch.clearRect(0,0,width,height); scratch.drawImage(original,0,0); }
          scratch.globalCompositeOperation="destination-over"; scratch.drawImage(after.canvas,0,0); scratch.restore();
          filter();
        } finally {after.canvas.width=after.canvas.height=0;}
      }
    }
  } finally {
    detachLayer?.(); detachBack?.();
    if (original) original.width=original.height=0;
    if (firstBack) firstBack.canvas.width=firstBack.canvas.height=0;
    shadows?.dispose();
  }
}

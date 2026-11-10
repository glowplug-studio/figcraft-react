import { transformBounds, type Affine } from "../../affine";
import { children, clamp, numeric, object, string, type JsonObject } from "../rest/values";
import type { SketchNode } from "./geometry";
import { sketchPaints, type SketchStyleContext } from "./style";

const identityRows = [[1,0,0], [0,1,0]];

export function sketchMask(layer: JsonObject, node: SketchNode) {
  if (layer.hasClippingMask === true) {
    node.isMask = true;
    node.maskType = layer.clippingMaskMode === 1 ? "ALPHA" : "VECTOR";
  }
}

export function sketchFade(cx: SketchStyleContext, layer: JsonObject, node: SketchNode, world: Affine, w: number, h: number): SketchNode {
  const ctx = object(object(layer.style).contextSettings);
  if (ctx.isProgressive !== true || ctx.gradient === undefined || node.isMask === true) return node;
  const fills = sketchPaints(cx, { fills: [{ fillType: 1, gradient: ctx.gradient }] }, w, h);
  if (!fills.length) return node;
  const id = string(layer.do_objectID) ?? "layer", absoluteBoundingBox = transformBounds(world,w,h), size = { x:w, y:h };
  const mask = { type:"RECTANGLE", id:id+"-fade-mask", name:"Fade", visible:true, size,
    relativeTransform:identityRows, absoluteBoundingBox, fills, isMask:true, maskType:"ALPHA" };
  const inner = { ...node, id:id+"-faded", relativeTransform:identityRows, absoluteBoundingBox, visible:true };
  return { type:"GROUP", id, name:node.name ?? "Fade", size, absoluteBoundingBox, relativeTransform:node.relativeTransform,
    constraints:node.constraints, locked:node.locked, visible:node.visible, children:[mask,inner] };
}

interface Child { breaks: boolean; drawn?: boolean; node: SketchNode }

/** A Sketch mask can also draw its own outline, and stops at the next explicit chain break. */
export function sketchMaskGroups(childrenWithBreaks: readonly Child[], world: Affine, w: number, h: number, root: boolean) {
  const built: Child[] = [], out: SketchNode[] = [];
  for (const child of childrenWithBreaks) {
    const node = child.node;
    if (node.isMask === true && node.maskType !== "ALPHA" &&
        ["fills","strokes","effects"].some(key => children(node[key]).some(v => object(v).visible !== false))) {
      const copy: SketchNode = { ...node, name:(string(node.name) ?? "Mask")+" (drawn)" };
      delete copy.id; delete copy.isMask; delete copy.maskType;
      built.push({ breaks:child.breaks, drawn:true, node:copy });
    }
    built.push(child);
  }
  for (let i=0; i<built.length;) {
    const { node } = built[i];
    if (node.isMask !== true) { out.push(node); i++; continue; }
    const opacity = node.maskType === "ALPHA" ? undefined : numeric(node.opacity);
    const faded = opacity !== undefined && opacity < 1;
    let end = i+1;
    while (end < built.length && !built[end].breaks) end++;
    if (end === built.length && !faded) { out.push(node); i++; continue; }
    const start = faded && built[i-1]?.drawn ? i-1 : i;
    if (start < i) out.pop();
    const masked = built.slice(start,end).map(child => {
      if (!child.drawn || !faded) return child.node;
      const copy = { ...child.node }; delete copy.opacity;
      return copy;
    });
    out.push({ type:"GROUP", name:"Mask group", relativeTransform:identityRows, size:{ x:w,y:h },
      ...(!root && { absoluteBoundingBox:transformBounds(world,w,h) }), ...(faded && { opacity:clamp(opacity,0,1) }), children:masked });
    i=end;
  }
  return out;
}

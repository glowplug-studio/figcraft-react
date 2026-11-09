import { multiply, transformBounds, type Affine } from "./affine";
import { blurRadius } from "./blur-renderer";
import { isFrameLike, isLeaf, layerTransform, type Document, type LayerNode } from "./document";
import type { Effect } from "./effects";
import { fullSweep } from "./ellipse";
import type { Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { bandCaps, defaultStroke, hasVisibleStroke, strokeMaxWeight, type StrokeCap } from "./stroke";

function expand(box:Rectangle, x:number, y=x, dx=0, dy=0):Rectangle {
  return {x:box.x-x+dx,y:box.y-y+dy,width:box.width+2*x,height:box.height+2*y};
}
function union(a:Rectangle | undefined,b:Rectangle) {
  if (!a) return b;
  const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y);
  return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};
}
function intersect(a:Rectangle,b:Rectangle) {
  const x=Math.max(a.x,b.x), y=Math.max(a.y,b.y);
  const width=Math.min(a.x+a.width,b.x+b.width)-x, height=Math.min(a.y+a.height,b.y+b.height)-y;
  return width>0 && height>0 ? {x,y,width,height} : undefined;
}
function boxMitres(node:LayerNode) {
  return node.kind === "rectangle" || isFrameLike(node) || node.kind === "ellipse" && fullSweep(node.sweep);
}
const arrow = (cap?:StrokeCap)=>!!cap && !["none","round","square"].includes(cap);
function outlineReach(node:LayerNode) {
  let reach=0;
  if (hasVisibleStroke(node)) {
    const stroke=node.stroke ?? defaultStroke;
    const weight=stroke.sides ? Math.max(...stroke.sides) : strokeMaxWeight(stroke);
    const base=weight*(stroke.align === "inside" ? 0 : stroke.align === "center" ? .5 : 1);
    const arrows=arrow(stroke.capStart) || arrow(stroke.capEnd) || node.kind === "vector" && node.network.vertices.some(v=>arrow(v.cap));
    const cap=arrows ? Math.max(weight,stroke.weight)*3 : weight;
    const miter=boxMitres(node) ? 1 : Math.max(1,Math.min(4,stroke.miterLimit));
    const corners=stroke.dashes.length && bandCaps(stroke).includes("square") ? Math.max(miter,Math.SQRT2) : miter;
    reach=Math.max(base,node.kind === "line" || node.kind === "vector" ? cap : 0)*corners;
  }
  if (node.kind !== "text" || !node.text.path && node.text.leadingTrim === "none") return reach;
  const t=node.text;
  const size=Math.min(5000,t.runs.reduce((n,run)=>Math.max(n,run.style.fontSize),t.style.fontSize));
  const lines=Math.min(10000,Math.max(1,t.characters.split("\n").length-(t.characters.endsWith("\n") ? 1 : 0)));
  return reach+size*((t.path ? 1.5*lines : 0)+(t.leadingTrim === "none" ? 0 : .5));
}

/** Document::world_render_bounds, including clipped frames and each mask's sibling run. */
export function worldRenderBounds(doc:Document,id:string):Rectangle | undefined {
  const root=doc.nodes[id];
  if (!root || root.kind === "page") return;
  function visit(node:LayerNode, world:Affine, depth:number):Rectangle {
    const reach=outlineReach(node);
    const localBox=(pad:number)=>transformBounds(multiply(world,[1,0,0,1,-pad,-pad]),node.width+2*pad,node.height+2*pad);
    const base=localBox(reach);
    const stroke=node.stroke ?? defaultStroke;
    const exact=boxMitres(node) && !(hasVisibleStroke(node) && (stroke.dashes.length || stroke.widthProfile?.points.length || stroke.brush));
    let miter=0, squaredBlur=0, texture=0;
    const shadows:Extract<Effect,{type:"dropShadow"|"innerShadow"}>[]=[];
    for (const effect of node.effects ?? []) {
      if (!effect.visible) continue;
      if (effect.type === "dropShadow") {
        shadows.push(effect);
        if (!exact) miter=Math.max(miter,Math.max(0,effect.spread)*3);
      }
      if (effect.type === "layerBlur") squaredBlur+=(1.5*blurRadius(effect))**2;
      if (effect.type === "texture" && !effect.clipToShape) texture+=Math.abs(effect.radius);
    }
    const layer=Math.sqrt(squaredBlur)+texture;
    function grow(box:Rectangle) {
      const moved=expand(box,layer);
      let result=moved;
      for (const shadow of shadows) {
        const g=1.5*Math.abs(shadow.radius)+Math.max(0,shadow.spread)+miter;
        result=union(result,expand(moved,g,g,...shadow.offset));
      }
      return result;
    }
    let own=grow(base);
    if (node.kind !== "group" && !(node.kind === "text" && hasVisibleStroke(node))) {
      for (const shadow of shadows) {
        if (shadow.spread<=0) continue;
        const s=shadow.spread*4;
        const outline=exact ? localBox(reach+shadow.spread) : expand(base,s*Math.hypot(world[0],world[2]),s*Math.hypot(world[1],world[3]));
        const g=layer+Math.abs(shadow.radius)*1.5;
        own=union(own,expand(outline,g,g,...shadow.offset));
      }
    }
    if (isLeaf(node) || depth>=256 || isFrameLike(node) && node.clip) return own;
    let kids:Rectangle|undefined, mask:Rectangle|undefined, run:Rectangle|undefined;
    function finishRun() {
      const visible=run && mask ? intersect(run,mask) : run;
      if (visible) kids=union(kids,visible);
      run=undefined;
    }
    for (const id of node.children) {
      const child=doc.nodes[id];
      if (child.kind === "page") continue;
      if (child.isMask) {
        finishRun();
        mask=child.visible === false ? undefined : visit(child,multiply(world,layerTransform(child)),depth+1);
      } else if (child.visible !== false) {
        run=union(run,visit(child,multiply(world,layerTransform(child)),depth+1));
      }
    }
    finishRun();
    if (!kids) return own;
    const content=grow(kids);
    return node.kind === "group" ? content : union(own,content);
  }
  return visit(root,worldTransform(doc,id),0);
}

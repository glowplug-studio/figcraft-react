import { multiply, type Affine } from "../../affine";
import { children, object, type JsonObject } from "../rest/values";
import { frameSize, sketchBase, sketchLocal, type SketchNode } from "./geometry";
import { sketchMask } from "./masks";
import { sketchCompound, sketchShows } from "./path";

interface GroupHooks {
  layer: (layer:JsonObject, parent:Affine, depth:number, root:boolean, fill:boolean, border:boolean) => Promise<SketchNode | undefined>;
  appearance: (layer:JsonObject, node:SketchNode, w:number, h:number) => void;
  warn: (s:string) => void;
}
const strokeAndPaintFields = ["fills","strokes","strokeWeight","strokeAlign","strokeDashes","strokeCap","strokeCapStart","strokeCapEnd","strokeJoin","effects","opacity","blendMode","styles"];
function removeOperandStrokes(node:SketchNode, depth=0) {
  if (depth>64) return;
  delete node.strokes;
  for (const child of children(node.children)) removeOperandStrokes(child as SketchNode,depth+1);
}
export async function sketchShapeGroup(cx:GroupHooks, layer:JsonObject, parent:Affine, depth:number, root:boolean) {
  const kids=children(layer.layers).map(object), {w,h}=frameSize(layer), world=multiply(parent,sketchLocal(layer,w,h));
  const border=sketchShows(layer,"borders");
  if (kids.length===1) {
    const only=kids[0], node=await cx.layer(only,world,depth+1,false,sketchShows(layer,"fills"),border);
    if (!node) return;
    const {w:cw,h:ch}=frameSize(only);
    const group=sketchBase(layer,"GROUP",parent,multiply(world,sketchLocal(only,cw,ch)),cw,ch,root);
    for (const key of ["id","name","relativeTransform","absoluteBoundingBox","constraints","locked"]) {
      if (group[key]===undefined) delete node[key]; else node[key]=group[key];
    }
    node.visible=group.visible!==false && node.visible!==false;
    if (Object.hasOwn(layer,"style")) {
      for (const key of strokeAndPaintFields) delete node[key];
      cx.appearance(layer,node,cw,ch);
    }
    sketchMask(layer,node);
    return node;
  }
  const runs:JsonObject[][]=[];
  for (const child of kids) {
    if (runs.length && !(Number.isInteger(child.booleanOperation) && Number(child.booleanOperation)>=0)) runs[runs.length-1].push(child);
    else runs.push([child]);
  }
  if (runs.length===1) {
    const net=sketchCompound(layer,runs[0],cx.warn);
    if (net) {
      const node=sketchBase(layer,"VECTOR",parent,world,w,h,root);
      node.vectorNetwork=net;
      sketchMask(layer,node);
      cx.appearance(layer,node,w,h);
      return node;
    }
  }
  let chain:SketchNode[]=[], operation="UNION";
  for (const [index,run] of runs.entries()) {
    let operands:SketchNode[]=[];
    const compound=run.length>1 && sketchCompound(layer,run,cx.warn);
    if (compound) {
      const node=sketchBase(run[0],"VECTOR",world,world,w,h,false);
      delete node.id;
      node.vectorNetwork=compound;
      operands=[node];
    } else for (const child of run) {
      const built=await cx.layer(child,world,depth+2,false,true,border);
      if (built) operands.push(built);
    }
    if (!operands.length) continue;
    for (const node of operands) removeOperandStrokes(node);
    const next=["UNION","SUBTRACT","INTERSECT","EXCLUDE"][Number(run[0].booleanOperation)] ?? "UNION";
    if (index && next!==operation && chain.length>1) {
      const inner=sketchBase(layer,"BOOLEAN_OPERATION",parent,world,w,h,false);
      delete inner.id;
      inner.name=operation[0]+operation.slice(1).toLowerCase();
      inner.relativeTransform=[[1,0,0],[0,1,0]];
      inner.booleanOperation=operation;
      inner.children=chain;
      chain=[inner];
    }
    if (index) operation=next;
    for (const item of operands) chain.push(item);
  }
  if (chain.length) {
    const node=sketchBase(layer,"BOOLEAN_OPERATION",parent,world,w,h,root);
    node.booleanOperation=operation;
    node.children=chain;
    sketchMask(layer,node);
    cx.appearance(layer,node,w,h);
    return node;
  }
}

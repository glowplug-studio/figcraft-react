import { type Document, type DocumentNode, type LayerNode, type LeafNode, type NodeId, type TextNode, isLeaf, rectanglePaints, rectangleTransform,
  withLayerTransform, withRectanglePaints } from "./document";
import { withEffects } from "./effects";
import { ancestors, HierarchyDraft } from "./hierarchy";
import { inspectedId, parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { strokeGeometry } from "./shape-path";
import { textPathData } from "./text-path-data";

import {transformBounds} from "./affine";
import {measurePath, nearestOnPolylines, type MeasuredPolyline} from "./path-measure";
import {hitPathLeaf} from "./selection";
import type {Point} from "./geometry";
import {newTextData} from "./text-data";
import {readableTextFill} from "./text-edit";

const firstSubpaths=new WeakMap<LeafNode,readonly MeasuredPolyline[]>();
export function textPathAt(document:Document,point:Point,zoom:number) {
  const reach=6/Math.max(1e-6,zoom);
  let start=0;
  const pathId=hitPathLeaf(document,point,(node,world)=>{
    if (node.kind==="text") return false;
    const b=transformBounds(world,node.width,node.height);
    if (point.x<b.x-reach || point.x>b.x+b.width+reach || point.y<b.y-reach || point.y>b.y+b.height+reach) return false;
    let lines=firstSubpaths.get(node);
    if (!lines) {
      lines=measurePath(strokeGeometry(node))?.slice(0,1) ?? [];
      firstSubpaths.set(node,lines);
    }
    const hit=nearestOnPolylines(lines,point,world);
    if (!hit || hit.distance>reach) return false;
    start=hit.t;
    return true;
  });
  return pathId ? {pathId,startFraction:start} : undefined;
}

export function textPathOffset(value:unknown) {
  try { return Math.max(0,Math.min(1,parseNumber(value))); } catch { return undefined; }
}
export function canSupplyTextPath(node:DocumentNode) {
  return node.kind!=="page" && node.kind!=="booleanOp" && node.kind!=="group" && node.kind!=="text";
}
export function putTextOnPath(document:Document, selection:readonly NodeId[], params:Record<string,unknown>) {
  if (Object.keys(params).some(key=>!["id","ids","text","path","start","flip"].includes(key))) throw new Error("Unknown text path option");
  const raw = Array.isArray(params.ids) ? params.ids : parseNodeId(params.id) ? [params.id] : selection;
  const ids = raw.map(parseNodeId).filter((id):id is NodeId=>id!==undefined);
  const textId = parseNodeId(params.text) ?? ids.find(id=>document.nodes[id]?.kind==="text");
  const pathId = parseNodeId(params.path) ?? ids.find(id=>id!==textId && document.nodes[id]?.kind!=="text");
  const source = pathId && document.nodes[pathId], node = textId && document.nodes[textId];
  if (!source || source.kind==="page" || !canSupplyTextPath(source)) throw new Error("Select a layer with a path");
  if (!node || node.kind!=="text" || ancestors(document,node.id).includes(source.id)) throw new Error("Select a text layer outside the path layer");
  const elements = strokeGeometry(source);
  if (!elements.length) throw new Error("The selected layer has an empty path");
  const path = Object.freeze({d:textPathData(elements),start:textPathOffset(params.start) ?? 0,flip:parseBoolean(params.flip) ?? false});
  const parent=document.nodes[source.parent];
  if (isLeaf(parent)) throw new Error("Invalid path parent");
  const draft=new HierarchyDraft(document);
  draft.reparent(node.id,parent.id,parent.children.indexOf(source.id));
  draft.remove(source.id);
  const text=placeText(node,source,path);
  draft.set(text); draft.normaliseGroups();
  return {document:validateChangedGeometry(draft), selection:Object.freeze([text.id]), result:{id:inspectedId(text.id)}};
}

function placeText(node:TextNode,source:LayerNode,path:NonNullable<TextNode["text"]["path"]>) {
  let text:TextNode=withLayerTransform({...node,parent:source.parent,width:source.width,height:source.height,text:Object.freeze({...node.text,path})},rectangleTransform(source));
  const fills=rectanglePaints(source);
  if (fills.some(p=>p.visible)) text=withRectanglePaints(text,fills);
  if (source.effects?.length) text=withEffects(text,source.effects);
  return Object.freeze(text);
}

export function createTextOnPath(document:Document,id:string,target:{pathId:string;startFraction:number}) {
  const source=document.nodes[target.pathId];
  if (!source || !isLeaf(source) || source.kind==="text") throw new Error("Expected a shape or vector path");
  const parent=document.nodes[source.parent];
  if (isLeaf(parent)) throw new Error("Invalid path parent");
  const node:TextNode={kind:"text",id,parent:parent.id,name:"",x:0,y:0,width:1,height:14,
    ...(source.sizing && {textSizing: source.sizing}), ...(source.childLayout && {childLayout: source.childLayout}),
    fill:readableTextFill(document,parent.id),...(source.constraints && {constraints:source.constraints}),text:newTextData()};
  const path=Object.freeze({d:textPathData(strokeGeometry(source)),start:target.startFraction,flip:false});
  const text=placeText(node,source,path);
  const draft=new HierarchyDraft(document);
  draft.insert(text,parent.id,parent.children.indexOf(source.id));
  draft.remove(source.id);draft.normaliseGroups();
  return validateChangedGeometry(draft);
}

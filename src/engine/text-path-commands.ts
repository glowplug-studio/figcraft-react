import { type Document, type DocumentNode, type NodeId, type TextNode, isLeaf, rectanglePaints, rectangleTransform,
  withLayerTransform, withRectanglePaints } from "./document";
import { withEffects } from "./effects";
import { ancestors, HierarchyDraft } from "./hierarchy";
import { inspectedId, parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { shapePath } from "./shape-path";
import { textPathData } from "./text-path-data";
import { drawnVectorNetwork } from "./vector-rounded";
import { vectorStrokePath } from "./vector-path";

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
  const elements = source.kind==="vector" ? vectorStrokePath(drawnVectorNetwork(source)) : shapePath(source);
  if (!elements.length) throw new Error("The selected layer has an empty path");
  const path = Object.freeze({d:textPathData(elements),start:textPathOffset(params.start) ?? 0,flip:parseBoolean(params.flip) ?? false});
  const parent=document.nodes[source.parent];
  if (isLeaf(parent)) throw new Error("Invalid path parent");
  const draft=new HierarchyDraft(document);
  draft.reparent(node.id,parent.id,parent.children.indexOf(source.id));
  draft.remove(source.id);
  let text:TextNode=withLayerTransform({...node,parent:parent.id,width:source.width,height:source.height,text:Object.freeze({...node.text,path})},rectangleTransform(source));
  const fills=rectanglePaints(source);
  if (fills.some(p=>p.visible)) text=withRectanglePaints(text,fills);
  if (source.effects?.length) text=withEffects(text,source.effects);
  draft.set(Object.freeze(text)); draft.normaliseGroups();
  return {document:validateChangedGeometry(draft), selection:Object.freeze([text.id]), result:{id:inspectedId(text.id)}};
}

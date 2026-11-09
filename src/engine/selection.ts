import { fontGeometryCache } from "./font-generation";
import { booleanResult } from "./boolean-result";
import { isFrameLike, isLeaf, nodeTypeName, type LayerNode, type LeafNode } from "./document";
import { hitsPath } from "./corners";
import { hasShapePath, shapePath } from "./shape-path";
import { identity, inverse, multiply, transformPoint, type Affine } from "./affine";
import { layerTransform, pageOf, rectanglePaints, type Document, type NodeId } from "./document";
import { defaultStroke, hasVisibleStroke, strokeMaxWeight } from "./stroke";
import { ancestors, pageForNode } from "./hierarchy";
import type { Point } from "./geometry";
import { inspectedId, parseNodeId } from "./parameters";
import { hitsVector } from "./vector-presentation";

/** Upstream cmd/edit.rs selection commands; selection does not enter document history. */
export const selectionSpecs = Object.freeze({
  "select.set": { label: "Select", undo: false },
  "select.add": { label: "Add to selection", undo: false },
  "select.remove": { label: "Remove from selection", undo: false },
  "select.all": { label: "Select all", undo: false },
  "select.none": { label: "Select none", undo: false },
  "select.inverse": { label: "Select inverse", undo: false },
  "select.children": { label: "Select children", undo: false },
  "select.parent": { label: "Select parent", undo: false },
});

export interface SelectionExecution {
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly result: Record<string, unknown>;
}

function parsedTargets(params: Record<string, unknown>): NodeId[] {
  return Array.isArray(params.ids)
    ? params.ids.map(parseNodeId).filter((id): id is NodeId => id !== undefined)
    : [parseNodeId(params.id)].filter((id): id is NodeId => id !== undefined);
}

function clean(document: Document, ids: readonly NodeId[]): readonly NodeId[] {
  const seen = new Set<NodeId>();
  return Object.freeze(ids.filter(id => {
    const node = document.nodes[id];
    if (!node || node.kind === "page" || pageForNode(document, id) !== document.currentPage || seen.has(id)) return false;
    seen.add(id);
    return true;
  }));
}

export function executeSelection(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): SelectionExecution {
  if (!Object.hasOwn(selectionSpecs, command)) throw new Error(`Unsupported selection command: ${command}`);
  const allowed = command === "select.set" || command === "select.add" || command === "select.remove" ? ["id", "ids"] : [];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);

  let current = document;
  let ids: readonly NodeId[];
  const first = document.nodes[selection[0]];
  const siblingParent = first?.kind !== "page" && first?.parent ? document.nodes[first.parent] : undefined;
  const siblings = siblingParent && !isLeaf(siblingParent) ? siblingParent.children : pageOf(document).children;
  if (command === "select.none") {
    ids = [];
  } else if (command === "select.all" || command === "select.inverse") {
    ids = siblings.filter(id => {
      const node = document.nodes[id];
      return node && node.kind !== "page" && node.visible !== false && node.locked !== true
        && (command !== "select.inverse" || !selection.includes(id));
    });
  } else if (command === "select.children") {
    const children = selection.flatMap(id => {
      const node = document.nodes[id];
      return node && node.kind !== "page" && !isLeaf(node) ? node.children : [];
    });
    ids = children.length ? children : selection;
  } else if (command === "select.parent") {
    const parents = selection.map(id => document.nodes[id]?.parent).filter((id): id is NodeId => id !== undefined && id !== null && document.nodes[id]?.kind !== "page");
    ids = parents.length ? [...new Set(parents)] : selection;
  } else {
    const targets = parsedTargets(params);
    if (command === "select.set") {
      // Validate every parsed ID before changing the current page or selection.
      for (const id of targets) if (!Object.hasOwn(document.nodes, id)) throw new Error(`No node ${id}`);
      const first = targets[0];
      const targetPage = first === undefined ? undefined : pageForNode(document, first);
      if (first!==undefined && targetPage===undefined && document.libraryStore?.root) throw Error(first+" isn't on a page (it is a library component)");
      if (targetPage !== undefined && targetPage !== document.currentPage) {
        if (!document.pages.includes(targetPage)) throw new Error(`${first} isn't on a page`);
        current = Object.freeze({ ...document, currentPage: targetPage });
      }
      ids = targets;
    } else if (command === "select.add") {
      ids = [...selection];
      for (const id of targets) if (!ids.includes(id)) ids = [...ids, id];
    } else {
      ids = selection.filter(id => !targets.includes(id));
    }
  }
  const cleaned = clean(current, ids);
  return { document: current, selection: cleaned, result: command === "select.none" ? { ok: true } : { selection: cleaned } };
}

/** Match native level_target for supported containers, using the current selection as context. */
export function targetForLeaf(document: Document, leaf: NodeId, selection: readonly NodeId[]): NodeId {
  const chain: NodeId[] = [];
  let id: NodeId | null = leaf;
  while (id !== null && document.nodes[id]?.kind !== "page") {
    chain.push(id);
    id = document.nodes[id]?.parent ?? null;
  }
  chain.reverse();
  let target = 0;
  for (const selected of selection) {
    const parent = document.nodes[selected]?.parent;
    if (!parent) continue;
    const at = chain.indexOf(parent);
    if (at >= 0 && at + 1 < chain.length) target = Math.max(target, at + 1);
  }
  if (target === 0 && chain.length > 1 && isFrameLike(document.nodes[chain[0]])) target = 1;
  return chain[target] ?? leaf;
}

type MaskedChildren = Map<NodeId, LayerNode>;
const siblingMasks = fontGeometryCache<Document,Map<readonly NodeId[],MaskedChildren | null>>();

/** A hidden mask ends the preceding run. The boundary itself belongs to the run below for hits. */
function masksBelow(document:Document, children:readonly NodeId[]) {
  let parents=siblingMasks.get(document);
  if (!parents) {parents=new Map(); siblingMasks.set(document,parents);}
  const cached=parents.get(children);
  if (cached!==undefined) return cached;
  let result:MaskedChildren|null=null, mask:LayerNode|undefined;
  for (const id of children) {
    if (mask) (result??=new Map()).set(id,mask);
    const child=document.nodes[id];
    if (child && child.kind!=="page" && child.isMask) mask=child.visible===false ? undefined : child;
  }
  parents.set(children,result);
  return result;
}

function hitsLayer(node:LayerNode, world:Affine, point:Point, tolerance:number):boolean {
  if (node.kind==="group" || node.kind==="booleanOp") return false;
  const local=world[0]===1 && world[1]===0 && world[2]===0 && world[3]===1
    ? {x:point.x-world[4],y:point.y-world[5]} : transformPoint(inverse(world),point);
  if (isFrameLike(node) || node.kind==="text") return local.x>=-tolerance && local.x<node.width+tolerance
    && local.y>=-tolerance && local.y<node.height+tolerance;
  if (node.kind==="line") {
    const half=Math.max(strokeMaxWeight(node.stroke??defaultStroke)/2,tolerance*2.5);
    return local.x>=-half && local.x<=node.width+half && Math.abs(local.y)<=half;
  }
  if (node.kind==="vector") return hitsVector(node,local,tolerance);
  if (hasShapePath(node) || node.stroke || node.strokes) {
    const visible=hasVisibleStroke(node), filled=rectanglePaints(node).some(p=>p.visible);
    const reach=Math.max(strokeMaxWeight(node.stroke??defaultStroke)/2,visible && !filled ? tolerance*2.5 : tolerance);
    if (local.x < -reach || local.y < -reach || local.x > node.width+reach || local.y > node.height+reach) return false;
    return hitsPath(shapePath(node),local,reach,filled || !visible);
  }
  return Math.hypot(Math.max(0,-local.x,local.x-node.width),Math.max(0,-local.y,local.y-node.height))<=tolerance;
}

function worldFrom(parent:Affine,node:LayerNode):Affine {
  return parent===identity ? layerTransform(node) : multiply(parent,layerTransform(node));
}

function covers(document:Document,node:LayerNode,parent:Affine,point:Point,depth:number):boolean {
  if (depth>=512) return false;
  const world=worldFrom(parent,node);
  if (hitsLayer(node,world,point,0)) return true;
  return !isLeaf(node) && node.children.some(id=>{
    const child=document.nodes[id];
    return child && child.kind!=="page" && child.visible!==false && !child.isMask && covers(document,child,world,point,depth+1);
  });
}

interface PointLayer {id:number|string; name:string; type:string; depth:number}

function queryPoint(document:Document,point:Point,tolerance:number,selection:readonly NodeId[],enterBooleans:boolean,stack?:PointLayer[],
  pathHit?:(node:LeafNode,world:Affine)=>boolean) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const coverage=new Map<NodeId,boolean>();
  function visitChildren(children:readonly NodeId[],parent:NodeId,world:Affine,depth:number,output?:PointLayer[]):NodeId|undefined {
    let first:NodeId|undefined;
    const masks=masksBelow(document,children);
    const container = document.nodes[parent];
    const firstOnTop = isFrameLike(container) && container.layout?.reverseZ;
    for (let step = 0; step < children.length; step++) {
      const node = document.nodes[children[firstOnTop ? step : children.length - 1 - step]];
      if (!node || node.kind==="page" || node.parent!==parent || node.locked || node.visible===false) continue;
      try {
        const mask=masks?.get(node.id);
        if (mask) {
          let inside=coverage.get(mask.id);
          if (inside===undefined) {inside=covers(document,mask,world,point,0);coverage.set(mask.id,inside);}
          if (!inside) continue;
        }
        const hit=visit(node,world,depth,output);
        if (hit && !output) return hit;
        first??=hit;
      } catch { /* Singular transforms have no selectable area. */ }
    }
    return first;
  }
  function visit(node:LayerNode,parent:Affine,depth:number,output?:PointLayer[]):NodeId|undefined {
    if (depth>512) return;
    const world=worldFrom(parent,node);
    if (isFrameLike(node) && node.clip && !hitsLayer(node,world,point,0)) return;
    if (pathHit) {
      if (node.kind==="booleanOp") return;
      if (!isLeaf(node)) return visitChildren(node.children,node.id,world,depth+1);
      return !node.isMask && pathHit(node,world) ? node.id : undefined;
    }
    let leaf:NodeId|undefined;
    const at=output?.length??0;
    if (node.kind==="booleanOp") {
      const editing=enterBooleans || selection.some(id=>(!stack && id===node.id) || ancestors(document,id).includes(node.id));
      const result=editing ? undefined : booleanResult(document,node);
      if (result) {
        if (hitsLayer(result,world,point,tolerance)) leaf=node.id;
      } else leaf=visitChildren(node.children,node.id,world,depth+1);
    } else {
      if (!isLeaf(node)) leaf=visitChildren(node.children,node.id,world,depth+1,output);
      if (!leaf && hitsLayer(node,world,point,tolerance)) leaf=node.id;
    }
    if (leaf && output) output.splice(at,0,{id:inspectedId(node.id),name:node.name,type:nodeTypeName(node),depth});
    return leaf;
  }
  const page=pageOf(document);
  return visitChildren(page.children,page.id,identity,0,stack);
}

/** Visit visible leaf outlines in paint order, respecting masks, clipping, locked parents and booleans. */
export function hitPathLeaf(document:Document,point:Point,hit:(node:LeafNode,world:Affine)=>boolean) {
  return queryPoint(document,point,0,[],false,undefined,hit);
}

/** Hit frontmost visible layer; container selection follows native level_target. */
export function hitRectangle(document:Document,point:Point,deep=false,selection:readonly NodeId[]=[],tolerance=0,enterBooleans=deep) {
  const leaf=queryPoint(document,point,tolerance,selection,enterBooleans);
  return leaf && !deep ? targetForLeaf(document,leaf,selection) : leaf;
}

/** Select layer menu order: front-most siblings first, each parent before its descendants. */
export function layersAt(document:Document,point:Point,tolerance:number,selection:readonly NodeId[]) {
  const layers:PointLayer[]=[];
  queryPoint(document,point,tolerance,selection,false,layers);
  return {layers};
}

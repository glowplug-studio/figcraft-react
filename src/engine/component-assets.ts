import {libraryComponent} from "./library-store";
import { inverse, transformPoint } from "./affine";
import { dropParent } from "./canvas-selection";
import { defaultInstanceValues } from "./component-bindings";
import { withOverrideSet } from "./component-groups";
import { insertInstance } from "./component-instances";
import { componentOverrides } from "./component-properties";
import { assertCanInstantiate, wouldContainItself } from "./component-tree";
import { isFrameLike, isLeaf, nodeTypeName, type ComponentNode, type Document, type NodeId } from "./document";
import type { Point } from "./geometry";
import { ancestors, HierarchyDraft, worldTransform } from "./hierarchy";
import { autoLayoutSlot } from "./layout-navigation";
import { inspectedId } from "./parameters";
import { hitRectangle } from "./selection";

export function listComponents(doc: Document) {
  const nodes = Object.values(doc.nodes);
  const counts = new Map<NodeId,number>();
  for (const node of nodes) {
    if (node.kind === "instance") counts.set(node.component,(counts.get(node.component) ?? 0) + 1);
  }
  return nodes.filter(node=>node.kind === "component" || node.kind === "componentSet")
    .sort((a,b)=>a.id.length-b.id.length || (a.id<b.id ? -1 : a.id>b.id ? 1 : 0))
    .map(node=>{
      const chain = ancestors(doc,node.id).reverse();
      const parts = node.name.split("/").map(part=>part.trim()).filter(Boolean);
      const label = parts.pop() ?? node.name;
      const remote=doc.libraryStore?.root===chain[0] && chain.length ? libraryComponent(doc,node.id) : undefined;
      return {...(remote && {library:remote.library}),id:inspectedId(node.id),name:node.name,type:nodeTypeName(node),page:chain.length && chain[0]!==doc.libraryStore?.root ? inspectedId(chain[0]) : null,
        instances:counts.get(node.id) ?? 0, folder:[...chain.map(id=>doc.nodes[id].name.trim()),...parts], label};
    });
}

export function hideAssets(draft: HierarchyDraft, ids: readonly NodeId[], on?: boolean) {
  const roots = new Set<NodeId>();
  for (const id of ids) {
    const root = [...ancestors(draft.document,id).reverse(),id].find(parent=>{
      const node = draft.nodes[parent];
      return node?.kind === "component" || node?.kind === "componentSet";
    });
    if (!root) throw new Error(id+" isn't a component, a component set or a layer in one");
    roots.add(root);
  }
  const hidden = on ?? ![...roots].every(id=>/^[._]/.test(draft.nodes[id].name));
  for (const id of roots) {
    const node = draft.nodes[id];
    const name = /^[._]/.test(node.name) === hidden ? node.name : hidden ? "."+node.name : node.name.replace(/^[._]+/,"").trimStart() || "Component";
    draft.set({...node,name});
  }
  return {ids:[...roots],hidden};
}

export function assetDropSlot(doc: Document, point: Point) {
  const parent = dropParent(doc,point,[]) ?? doc.currentPage;
  const frame = doc.nodes[parent];
  return {parent,...(isFrameLike(frame) && frame.layout && autoLayoutSlot(doc,frame,point,new Set()))};
}

export function placeAsset(draft: HierarchyDraft, main: ComponentNode, point: Point, nextId: bigint) {
  const doc = draft.document;
  const slot = assetDropSlot(doc,point);
  const {parent,index} = wouldContainItself(doc,main,slot.parent) ? {parent:doc.currentPage,index:undefined} : slot;
  const local = transformPoint(inverse(worldTransform(doc,parent)),{x:point.x-main.width/2,y:point.y-main.height/2});
  return {...insertInstance(draft,main,parent,[1,0,0,1,local.x,local.y],nextId,index),parent};
}

function family(doc: Document, id: NodeId) {
  const node = doc.nodes[id];
  const parent = node?.parent && doc.nodes[node.parent];
  return parent && parent.kind === "componentSet" ? parent.name : undefined;
}

export function assetSwapTarget(doc: Document, point: Point, main: ComponentNode, source=doc) {
  const hit = hitRectangle(doc,point,true,[],0,false);
  if (!hit) return;
  const chain = [hit,...ancestors(doc,hit)];
  const excluded = source===doc ? chain.indexOf(main.id) : -1;
  const candidates = (excluded === -1 ? chain : chain.slice(excluded)).map(id=>doc.nodes[id]).filter(node=>node.kind === "instance");
  const targetFamily = family(source,main.id);
  return (targetFamily === undefined ? undefined : candidates.find(node=>family(doc,node.component) === targetFamily)) ?? candidates[0];
}

export function keepTextOverrides(draft: HierarchyDraft, root: NodeId) {
  const pending = [root];
  while (pending.length) {
    const id = pending.pop()!, node = draft.nodes[id];
    if (node.kind === "page") continue;
    const own = componentOverrides(node);
    if (!isLeaf(node) && !own.includes("slot")) for (const child of node.children) pending.push(child);
    if (!own.length || node.kind === "text") continue;
    const kept = own.filter(group=>group === "slot" || id === root && group === "size");
    if (kept.length !== own.length) draft.set(withOverrideSet(node,new Set(kept)));
  }
}

export function swapInstance(draft: HierarchyDraft, id: NodeId, main: ComponentNode) {
  const node = draft.nodes[id];
  if (node?.kind !== "instance") throw new Error(id+" is not an instance");
  assertCanInstantiate(draft.document,main,id);
  const defaults = defaultInstanceValues(main.props);
  const props = Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,Object.hasOwn(node.props,key) ? node.props[key] : value]));
  draft.set({...node,component:main.id,props:Object.freeze(props)});
}

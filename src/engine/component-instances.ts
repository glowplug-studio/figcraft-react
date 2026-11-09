import { defaultInstanceValues } from "./component-bindings";
import { rebuildInstance } from "./component-sync";
import { type Affine } from "./affine";
import { type ComponentNode, type Document, type InstanceNode, type NodeId, isLeaf, withLayerTransform } from "./document";
import { assertCanInstantiate, assertNoNewComponentCycle, defaultInstanceName, defaultMain, owningInstance, slotName } from "./component-tree";
import { ancestors, HierarchyDraft } from "./hierarchy";
import { parseNodeId, parseNumber } from "./parameters";
import { boundsOf } from "./viewport";

function rootInstance(document: Document, main: ComponentNode, id: NodeId, transform: Affine): InstanceNode {
  const {description, props, propOrder, overrides, propRefs, ...frame} = main;
  return withLayerTransform({...frame, kind:"instance", component:main.id, id, source:main.id,
    name:defaultInstanceName(document, main), props:defaultInstanceValues(props), children:Object.freeze([])}, transform);
}

/** Build the main's mirror in native pre-order. Direct descendants keep the exact main layer they mirror. */
export function insertInstance(draft: HierarchyDraft, main: ComponentNode, parent: NodeId, transform: Affine, nextId: bigint, index?: number) {
  const document = draft.document;
  assertCanInstantiate(document, main, parent);
  const allocated = draft.allocateId(nextId);
  const root = rootInstance(document,main,allocated.id,transform);
  draft.insert(root,parent,index);
  nextId = rebuildInstance(draft,root.id,allocated.nextId);
  assertNoNewComponentCycle(draft.originalDocument, draft.document, parent);
  return {id:root.id, nextId};
}

export function createInstance(document: Document, nextId: bigint, params: Record<string,unknown>) {
  const id = parseNodeId(params.component);
  if (id === undefined) throw new Error("component must be a node id");
  const main = defaultMain(document, id);
  if (!main) throw new Error("component must be a component or component set");
  const parent = params.parent == null ? document.currentPage : parseNodeId(params.parent);
  if (parent === undefined || !document.nodes[parent] || isLeaf(document.nodes[parent])) throw new Error("A container parent is required");
  const owner = owningInstance(document, parent);
  if (owner) {
    const chain = [parent,...ancestors(document,parent)];
    const slot = chain.slice(0,chain.indexOf(owner.id)).some(id => slotName(document,id) !== undefined);
    if (!slot) throw new Error(`Layers can't be added inside the instance "${owner.name}": edit its main component, or detach the instance first`);
  }
  let x: number, y: number;
  try { x = parseNumber(params.x); y = parseNumber(params.y); }
  catch {
    const bounds = boundsOf(document, [main.id])!;
    x = bounds.x + bounds.width + 40; y = bounds.y;
  }
  const draft = new HierarchyDraft(document);
  const instance = insertInstance(draft, main, parent, [1,0,0,1,x,y], nextId);
  draft.normaliseGroups();
  return {document:draft.finish(), selection:Object.freeze([instance.id]), nextId:instance.nextId, result:{id:instance.id}};
}

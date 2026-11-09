import { inverse, multiply, transformBounds, withTranslation } from "./affine";
import { fromRgba8 } from "./colour";
import { owningInstance } from "./component-tree";
import { variantOptions, variantProperties } from "./component-variants";
import { isLeaf, layerTransform, withLayerTransform, type ComponentSetNode, type Document, type NodeId } from "./document";
import { duplicateInto } from "./duplicate";
import { HierarchyDraft, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseString } from "./parameters";
import { solidPaint } from "./solid-paint";
import { defaultStroke } from "./stroke";
import { nextLayerName } from "./structure";
import { compareScalarKeys } from "./text-breaks";
import { boundsOf } from "./viewport";

export function canAddVariant(doc: Document, id: NodeId) {
  const node = doc.nodes[id];
  if (!node || owningInstance(doc,id,false)) return false;
  return node.kind === "component" || node.kind === "componentSet" && node.children.some(id=>doc.nodes[id].kind === "component");
}

export function combineRefusal(doc: Document, ids: readonly NodeId[]) {
  for (const id of ids) if (doc.nodes[id]?.kind !== "component") return "Select components only";
  for (const id of ids) if (doc.nodes[doc.nodes[id].parent!].kind === "componentSet") return "Components that are variants already can't be combined again";
  if (ids.some(id=>owningInstance(doc,id,false))) return "Components inside an instance can't become variants";
  if (rootIds(doc,ids).length !== ids.length) return "A component can't be combined with one inside it";
}

export function wrapVariantSet(draft: HierarchyDraft, ids: readonly NodeId[], nextId: bigint) {
  const doc = draft.document, top = doc.nodes[ids[ids.length-1]], first = doc.nodes[ids[0]];
  if (!top?.parent) throw new Error("Select a component");
  const parent = doc.nodes[top.parent];
  if (isLeaf(parent) || owningInstance(doc,top.id,false) || owningInstance(doc,parent.id)) throw new Error("Components inside an instance can't become variants");
  const bounds = boundsOf(doc,ids)!;
  const toLocal = multiply(inverse(worldTransform(doc,parent.id)),[1,0,0,1,bounds.x-20,bounds.y-20]);
  const local = transformBounds(toLocal,bounds.width+40,bounds.height+40);
  const slash = first.name.lastIndexOf("/");
  const base = (slash === -1 ? first.name : first.name.slice(0,slash)).trim();
  const name = base && !base.includes("=") ? base : nextLayerName(doc,"Component");
  const allocation = draft.allocateId(nextId);
  const set: ComponentSetNode = {kind:"componentSet",id:allocation.id,parent:parent.id,name,description:"",
    children:[],clip:true,...local,fill:"transparent",blend:"passThrough",corners:{radii:[5,5,5,5],smoothing:0},
    strokes:[solidPaint(fromRgba8(151,71,255))],stroke:{...defaultStroke,dashes:[10,5]}};
  draft.insert(set,parent.id,parent.children.indexOf(top.id)+1);
  for (const id of ids) draft.reparent(id,set.id);
  return allocation;
}

function createSet(draft: HierarchyDraft, ids: readonly NodeId[], nextId: bigint) {
  const result = wrapVariantSet(draft,ids,nextId);
  ids.forEach((id,i)=>{
    const node = draft.nodes[id];
    if (!node.name.includes("=")) draft.set({...node,name:i ? "Property 1=Variant"+(i+1) : "Property 1=Default"});
  });
  return result;
}

export function combineVariants(draft: HierarchyDraft, ids: readonly NodeId[], nextId: bigint) {
  const unique = [...new Set(ids)], refusal = combineRefusal(draft.document,unique);
  if (refusal) throw new Error(refusal);
  return createSet(draft,zSorted(draft.document,unique),nextId);
}

export function fitVariantSet(draft: HierarchyDraft, id: NodeId) {
  const set = draft.nodes[id];
  if (set.kind !== "componentSet") return;
  let width = set.width, height = set.height;
  for (const child of set.children) {
    const node = draft.nodes[child];
    if (node.kind === "page") continue;
    const box = transformBounds(layerTransform(node),node.width,node.height);
    width = Math.max(width,box.x+box.width+20);
    height = Math.max(height,box.y+box.height+20);
  }
  if (width !== set.width || height !== set.height) draft.set({...set,width,height});
}

export function addVariant(draft: HierarchyDraft, id: NodeId, nextId: bigint, params: Record<string,unknown>) {
  const target = draft.nodes[id];
  let baseId = id, setId: NodeId;
  if (target?.kind === "componentSet") {
    setId = id;
    const last = target.children.at(-1);
    if (!last) throw new Error("The component set is empty");
    baseId = last;
  } else if (target?.kind === "component") {
    if (draft.nodes[target.parent].kind === "componentSet") setId = target.parent;
    else {
      const created = createSet(draft,[id],nextId);
      setId = created.id;
      nextId = created.nextId;
    }
  } else throw new Error("Select a component set or component");
  const set = draft.nodes[setId] as ComponentSetNode;
  const base = draft.nodes[baseId];
  const options = variantOptions(draft.document,set), pairs = variantProperties(base.name);
  const key = (values: ReadonlyMap<string,string>)=>JSON.stringify([...values].sort(([a],[b])=>compareScalarKeys(a,b)));
  const existing = new Set(set.children.map(id=>key(variantProperties(draft.nodes[id].name))));
  const property = parseString(params.property)?.trim(), value = parseString(params.value)?.trim();
  if (property !== undefined) {
    if (value === undefined) throw new Error("A value is required with property");
    if (!options.has(property)) throw new Error("Unknown variant property "+property);
    if (!value || /[,=]/.test(value)) throw new Error("Value must be non-empty without ',' or '='");
    pairs.set(property,value);
    if (existing.has(key(pairs))) throw new Error("That variant already exists");
  } else {
    const name = options.keys().next().value ?? "Property 1";
    let n = existing.size+1;
    do { pairs.set(name,"Variant"+n++); } while (n<=10001 && existing.has(key(pairs)));
  }
  let bottom = 0;
  for (const child of set.children) {
    const n = draft.nodes[child];
    if (n.kind === "page") continue;
    const box = transformBounds(layerTransform(n),n.width,n.height);
    bottom = Math.max(bottom,box.y+box.height);
  }
  const copy = duplicateInto(draft,baseId,setId,nextId);
  const node = draft.nodes[copy.id];
  if (node.kind === "page") throw new Error("A page cannot be a variant");
  const ordered = [...new Set([...options.keys(),...[...pairs.keys()].sort(compareScalarKeys)])];
  const name = ordered.filter(k=>pairs.has(k)).map(k=>k+"="+pairs.get(k)).join(", ");
  draft.set(withLayerTransform({...node,name},withTranslation(layerTransform(node),{x:node.x,y:bottom+20})));
  fitVariantSet(draft,setId);
  return copy;
}

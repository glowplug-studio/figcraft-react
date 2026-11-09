import { type Affine } from "./affine";
import { type ComponentNode, type Document, type InstanceNode, type LayerNode, type NodeId, isLeaf, withLayerTransform } from "./document";
import { componentOverrides, type ComponentProperties, type InstanceValue } from "./component-properties";
import { assertCanInstantiate, assertNoNewComponentCycle, defaultInstanceName, defaultMain, owningInstance, propertyNodeId, slotName } from "./component-tree";
import { ancestors, HierarchyDraft } from "./hierarchy";
import { wireId } from "./native-values";
import { parseNodeId, parseNumber } from "./parameters";
import { normaliseTextLines } from "./text-data";
import { autoSizeText } from "./text-node-layout";
import { replaceTextRange, scalarCount } from "./text-ranges";
import { boundsOf } from "./viewport";

type Values = InstanceNode["props"];

export function defaultInstanceValues(definitions: ComponentProperties): Values {
  const entries: [string, InstanceValue][] = [];
  for (const [key, prop] of Object.entries(definitions)) {
    if (prop.type !== "slot") entries.push([key, prop.type === "instanceSwap" ? wireId(prop.default) : prop.default]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function applyBinding(document: Document, layer: LayerNode, field: string, value: InstanceValue): LayerNode {
  if (field === "visible" && typeof value === "boolean") {
    const {visible, ...rest} = layer;
    return value ? rest : {...rest, visible:false};
  }
  if (field === "characters" && layer.kind === "text" && typeof value === "string") {
    const normal = normaliseTextLines(value);
    if (layer.text.characters === normal) return layer;
    return autoSizeText({...layer, text:replaceTextRange(layer.text, 0, scalarCount(layer.text.characters), normal)});
  }
  if (field === "mainComponent" && layer.kind === "instance") {
    const component = propertyNodeId(value);
    if (component && document.nodes[component]?.kind === "component") return {...layer, component};
  }
  return layer;
}

function boundCopy(document: Document, original: LayerNode, id: NodeId, values: readonly Values[]): LayerNode {
  const {overrides, propRefs, ...rest} = original;
  let copy: LayerNode = {...rest, id, source:original.id};
  if (copy.kind === "text" && copy.charactersOverridden) {
    const {charactersOverridden, ...text} = copy;
    copy = text;
  }
  if (!isLeaf(copy)) copy = {...copy, children:Object.freeze([])};
  const chain = [original];
  let source = original.source;
  while (chain.length < values.length && source) {
    const layer = document.nodes[source];
    if (!layer || layer.kind === "page") break;
    chain.push(layer);
    source = layer.source;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [field, key] of Object.entries(chain[i].propRefs ?? {})) {
      const group = field === "mainComponent" ? "component" : field;
      if (i > 0 && componentOverrides(original).includes(group)) continue;
      if (Object.hasOwn(values[i], key)) copy = applyBinding(document, copy, field, values[i][key]);
    }
  }
  return copy;
}

function rootInstance(document: Document, main: ComponentNode, id: NodeId, transform: Affine): InstanceNode {
  const {description, props, propOrder, overrides, propRefs, ...frame} = main;
  return withLayerTransform({...frame, kind:"instance", component:main.id, id, source:main.id,
    name:defaultInstanceName(document, main), props:defaultInstanceValues(props), children:Object.freeze([])}, transform);
}

/** Build the main's mirror in native pre-order. Direct descendants keep the exact main layer they mirror. */
export function insertInstance(draft: HierarchyDraft, main: ComponentNode, parent: NodeId, transform: Affine, nextId: bigint, index?: number) {
  const document = draft.document;
  assertCanInstantiate(document, main, parent);
  const allocate = () => {
    const allocation = draft.allocateId(nextId);
    nextId = allocation.nextId;
    return allocation.id;
  };
  const root = rootInstance(document, main, allocate(), transform);
  draft.insert(root, parent, index);
  type Pending = {source:NodeId; parent:NodeId; values:readonly Values[]; mains:ReadonlySet<NodeId>};
  const pending: Pending[] = [];
  const enqueue = (children: readonly NodeId[], parent: NodeId, values: readonly Values[], mains: ReadonlySet<NodeId>) => {
    for (let i=children.length-1; i>=0; i--) pending.push({source:children[i], parent, values, mains});
  };
  const hosts = [main.id, ...ancestors(document,parent).filter(id=>document.nodes[id].kind === "component")];
  enqueue(main.children, root.id, [root.props], new Set(hosts));
  while (pending.length) {
    const item = pending.pop()!, original = document.nodes[item.source];
    if (original.kind === "page") throw new Error("A component cannot mirror a page");
    let copy = boundCopy(document, original, allocate(), item.values);
    let children = isLeaf(original) ? [] : original.children, values = item.values, mains = item.mains;
    if (copy.kind === "instance" && original.kind === "instance") {
      const main = document.nodes[copy.component];
      if (main?.kind === "component" && copy.component !== original.component) {
        // A swap binding changes the nested main while preserving its place in the outer instance.
        const swapped = rootInstance(document, main, copy.id, copy.transform ?? [1,0,0,1,copy.x,copy.y]);
        copy = {...swapped, source:original.id, props:copy.props, name:copy.name};
        children = main.children;
      }
      if (mains.has(copy.component)) children = [];
      mains = new Set([...mains, copy.component]);
      values = [...values, copy.props];
    }
    draft.insert(copy, item.parent);
    enqueue(children, copy.id, values, mains);
  }
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

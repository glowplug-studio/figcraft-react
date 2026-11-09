import { isLosslessNumber } from "lossless-json";
import { isLeaf, type ComponentNode, type ComponentSetNode, type Document, type InstanceNode, type NodeId } from "./document";
import { ancestors, HierarchyDraft, subtreeIds } from "./hierarchy";
import { parseNodeId } from "./parameters";
import type { InstanceValue } from "./component-properties";

export function owningInstance(document: Document, id: NodeId, includeSelf = true): InstanceNode | undefined {
  const self = document.nodes[id];
  if (!self) return;
  if (includeSelf && self.kind === "instance") return self;
  for (const parent of ancestors(document, id)) {
    const node = document.nodes[parent];
    if (node.overrides?.includes("slot")) break;
    if (node.kind === "instance") return node;
  }
}

export function outermostInstance(document: Document, id: NodeId): InstanceNode | undefined {
  let owner = owningInstance(document,id);
  while (owner) {
    const outer = owningInstance(document,owner.id,false);
    if (!outer) return owner;
    owner = outer;
  }
}

export function localComponentChoices(document: Document) {
  return document.pages.map(page=>({
    page, options:subtreeIds(document,page).filter(id=>{
      const node = document.nodes[id];
      return (node.kind === "componentSet" || node.kind === "component" && document.nodes[node.parent].kind !== "componentSet") &&
        !owningInstance(document,id,false);
    }),
  })).filter(group=>group.options.length);
}

export function owningMainComponent(document: Document, id: NodeId) {
  const node = document.nodes[id];
  if (!node) return undefined;
  if (node.kind === "component") return node;
  for (const parent of ancestors(document,id)) {
    const main = document.nodes[parent];
    if (main.kind === "component") return main;
  }
}

export function propertyOwner(document: Document, id: NodeId) {
  const node = document.nodes[id];
  if (node?.kind === "componentSet") return node;
  const main = owningMainComponent(document,id);
  if (!main) return undefined;
  const parent = document.nodes[main.parent];
  return parent.kind === "componentSet" ? parent : main;
}

export function propertyMains(document: Document, owner: ComponentNode | ComponentSetNode) {
  return owner.kind === "component" ? [owner] : owner.children.map(id=>document.nodes[id]).filter(n=>n.kind === "component");
}

export function setBooleanDefault(draft: HierarchyDraft, mains: readonly ComponentNode[], name: string, value: boolean) {
  for (const {id} of mains) {
    const main = draft.nodes[id];
    if (main.kind !== "component" || !Object.hasOwn(main.props,name)) continue;
    const def = main.props[name];
    if (def.type !== "boolean") continue;
    if (def.default !== value) draft.set({...main,props:{...main.props,[name]:{type:"boolean",default:value}}});
    for (const child of subtreeIds(draft.document,id).slice(1)) {
      const node = draft.nodes[child];
      if (node.kind === "page" || node.propRefs?.visible !== name || (node.visible !== false) === value || owningInstance(draft.document,child,false)) continue;
      draft.set({...node,visible:value ? undefined : false});
    }
  }
}

export function slotDefinition(document: Document, id: NodeId) {
  let layer = document.nodes[id];
  for (let depth = 0; depth <= 16 && layer?.kind === "frame"; depth++) {
    const name = layer.propRefs?.slot;
    if (name !== undefined) {
      const main = ancestors(document, layer.id).map(parent => document.nodes[parent]).find(node => node.kind === "component");
      if (main && Object.hasOwn(main.props,name)) {
        const def = main.props[name];
        if (def.type === "slot") return {name,preferred:def.preferred};
      }
      return;
    }
    if (layer.source === undefined) return;
    layer = document.nodes[layer.source];
  }
}

export function slotName(document: Document, id: NodeId) {
  return slotDefinition(document,id)?.name;
}

export function canExposeInstance(document: Document, id: NodeId) {
  return document.nodes[id]?.kind === "instance" && !owningInstance(document,id,false) &&
    ancestors(document,id).some(parent=>document.nodes[parent].kind === "component");
}

export function exposedCopies(document: Document, root: NodeId) {
  const node = document.nodes[root];
  const pending = !node || isLeaf(node) ? [] : [...node.children].reverse();
  const exposed: InstanceNode[] = [];
  for (let visited=0; pending.length && visited<100_000; visited++) {
    const layer = document.nodes[pending.pop()!];
    if (isLeaf(layer)) continue;
    if (layer.kind === "instance") {
      if (layer.visible === false || !layer.source || !document.nodes[layer.source]?.exposed) continue;
      exposed.push(layer);
    }
    for (let i=layer.children.length-1; i>=0; i--) pending.push(layer.children[i]);
  }
  return exposed;
}

export function componentSlots(document: Document, root: NodeId) {
  const node = document.nodes[root];
  const pending = !node || isLeaf(node) ? [] : [...node.children].reverse();
  const slots: {id:NodeId; name:string}[] = [];
  for (let visited=0; pending.length && visited<1_000_000; visited++) {
    const id = pending.pop()!, layer = document.nodes[id];
    const name = slotName(document,id);
    if (name !== undefined) slots.push({id,name});
    if (!isLeaf(layer) && layer.kind !== "instance" && !layer.overrides?.includes("slot")) {
      for (let i=layer.children.length-1; i>=0; i--) pending.push(layer.children[i]);
    }
  }
  return slots;
}

export function defaultMain(document: Document, id: NodeId): ComponentNode | undefined {
  const node = document.nodes[id];
  if (node?.kind === "component") return node;
  if (node?.kind !== "componentSet") return;
  let first: ComponentNode | undefined;
  for (const child of node.children) {
    const next = document.nodes[child];
    if (next.kind !== "component") continue;
    if (!first || next.x + next.y < first.x + first.y ||
        next.x + next.y === first.x + first.y && (next.y < first.y || next.y === first.y && next.x < first.x)) first = next;
  }
  return first;
}

export function propertyNodeId(value: InstanceValue | undefined): NodeId | undefined {
  return parseNodeId(isLosslessNumber(value) ? value.value : value);
}

function componentAncestors(document: Document, id: NodeId) {
  return [id, ...ancestors(document, id)].filter(ancestor => document.nodes[ancestor].kind === "component");
}

function componentDependencies(document: Document) {
  const graph = new Map<NodeId, Set<NodeId>>();
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== "instance") continue;
    const definition = document.nodes[node.component];
    if (definition?.kind !== "component") continue;
    const shown = [node.component];
    for (const [key, property] of Object.entries(definition.props)) {
      if (property.type !== "instanceSwap" || !Object.hasOwn(node.props, key)) continue;
      const swap = propertyNodeId(node.props[key]);
      if (swap && document.nodes[swap]?.kind === "component") shown.push(swap);
    }
    for (const host of componentAncestors(document, node.id)) {
      const dependencies = graph.get(host) ?? new Set<NodeId>();
      for (const target of shown) dependencies.add(target);
      graph.set(host, dependencies);
    }
  }
  return graph;
}

export function wouldContainItself(document: Document, main: ComponentNode, parent: NodeId): boolean {
  const hosts = new Set(componentAncestors(document, parent));
  if (!hosts.size) return false;
  const graph = componentDependencies(document);
  const pending = [main.id], seen = new Set<NodeId>();
  while (pending.length) {
    const next = pending.pop()!;
    if (hosts.has(next)) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of graph.get(next) ?? []) pending.push(child);
  }
  return false;
}

export function assertCanInstantiate(document: Document, main: ComponentNode, parent: NodeId) {
  if (wouldContainItself(document,main,parent)) throw new Error(`An instance of "${main.name}" can't go inside "${main.name}" or a component it contains: a component can't contain itself`);
}

function componentCycle(document: Document): NodeId[] | undefined {
  const graph = componentDependencies(document);
  const visited = new Set<NodeId>();
  const active = new Map<NodeId, number>();
  const byId = (a: NodeId, b: NodeId) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  const frame = (id: NodeId) => ({id, children:[...graph.get(id) ?? []].sort(byId), index:0});
  for (const root of [...graph.keys()].sort(byId)) {
    if (visited.has(root)) continue;
    const path = [frame(root)];
    active.set(root, 0);
    while (path.length) {
      const current = path[path.length - 1];
      if (current.index === current.children.length) {
        active.delete(current.id);
        visited.add(current.id);
        path.pop();
        continue;
      }
      const id = current.children[current.index++];
      const ancestor = active.get(id);
      if (ancestor !== undefined) return [...path.slice(ancestor).map(entry => entry.id), id];
      if (visited.has(id)) continue;
      active.set(id, path.length);
      path.push(frame(id));
    }
  }
}

/** Newly instantiated swap properties can close a loop even when the selected main did not. */
export function assertNoNewComponentCycle(before: Document, after: Document, parent: NodeId) {
  if (!componentAncestors(after, parent).length) return;
  const cycle = componentCycle(after);
  if (cycle && !componentCycle(before)) {
    const names = cycle.map(id => `"${after.nodes[id].name}"`).join(" → ");
    throw new Error(`a component can't contain an instance of itself, directly or through other components: ${names}`);
  }
}

export function defaultInstanceName(document: Document, main: ComponentNode): string {
  const parent = document.nodes[main.parent];
  return parent.kind === "componentSet" ? parent.name : main.name;
}

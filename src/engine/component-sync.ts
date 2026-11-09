import { type ComponentNode, type Document, type InstanceNode, isLeaf, type LayerNode, layerTransform, type NodeId, withLayerTransform } from "./document";
import { ancestors, HierarchyDraft, subtreeIds } from "./hierarchy";
import { componentOverrides } from "./component-properties";
import { copyComponentGroup, differentComponentGroups, isComponentGroup, withOverrideSet } from "./component-groups";
import { boundCopy, defaultInstanceValues } from "./component-bindings";
import { defaultInstanceName, owningInstance, slotName } from "./component-tree";
import { resizeChildren } from "./constraints";
import { layerSizing, sizeLimitKeys } from "./auto-layout";
import { autoSizeText } from "./text-node-layout";

function namePaths(doc: Document, root: NodeId, mirrored: boolean) {
  const paths = new Map<NodeId,string>();
  const stack = [{id:root, path:""}];
  while (stack.length) {
    const {id,path} = stack.pop()!, parent = doc.nodes[id];
    if (isLeaf(parent)) continue;
    const names = new Map<string,number>();
    for (const id of parent.children) {
      const child = doc.nodes[id];
      const source = mirrored && child.source && !(child.kind === "instance" && child.component === child.source) ? doc.nodes[child.source] : undefined;
      const name = source?.name ?? child.name, ordinal = names.get(name) ?? 0;
      names.set(name,ordinal+1);
      const segment = ordinal ? name+"#"+ordinal : name;
      const full = path ? path+"/"+segment : segment;
      paths.set(id,full);
      if (!(mirrored && child.overrides?.includes("slot"))) stack.push({id,path:full});
    }
  }
  return paths;
}

function siblingVariants(doc: Document, first: NodeId, second: NodeId) {
  const a = doc.nodes[first], b = doc.nodes[second];
  return first !== second && a?.kind === "component" && b?.kind === "component" && a.parent === b.parent && doc.nodes[a.parent]?.kind === "componentSet";
}

function owningMain(doc: Document, id: NodeId) {
  return [id,...ancestors(doc,id)].find(key=>doc.nodes[key].kind === "component");
}

function variantOverrides(doc: Document, previous: LayerNode, next: LayerNode) {
  if (previous.kind === "text" || !previous.source || previous.source === next.id || !componentOverrides(previous).length) return previous;
  const source = doc.nodes[previous.source];
  if (!source || source.kind === "page") return previous;
  const a = owningMain(doc,source.id), b = owningMain(doc,next.id);
  if (!a || !b || !siblingVariants(doc,a,b)) return previous;
  const differs = new Set<string>(differentComponentGroups(source,next));
  return withOverrideSet(previous,new Set(componentOverrides(previous).filter(group=>!differs.has(group))));
}

function refreshRoot(doc: Document, main: ComponentNode, placed: InstanceNode): InstanceNode {
  const {description, propOrder, ...template} = main;
  const nested = owningInstance(doc,placed.id,false);
  const source = placed.source ? doc.nodes[placed.source] : undefined;
  const sourceMain = source?.kind === "instance" ? doc.nodes[source.component] : undefined;
  const named = nested && source?.kind === "instance" && sourceMain?.kind === "component" && source.name !== defaultInstanceName(doc,sourceMain);
  let own = placed.overrides, childLayout = placed.childLayout, sizing = placed.sizing;
  if (source?.kind === "component" && siblingVariants(doc,source.id,main.id)) {
    const changed = new Set<string>(differentComponentGroups(source,main));
    own = own?.filter(group=>group === "name" || !changed.has(group));
    const was = layerSizing(source), next = layerSizing(main), current = layerSizing(placed);
    const horizontal = current.horizontal === was.horizontal ? next.horizontal : current.horizontal;
    const vertical = current.vertical === was.vertical ? next.vertical : current.vertical;
    sizing = horizontal === "fixed" && vertical === "fixed" ? undefined : {horizontal,vertical};
    const limits = {...childLayout};
    for (const key of sizeLimitKeys) {
      if (limits[key] !== source.childLayout?.[key]) continue;
      if (main.childLayout?.[key] === undefined) delete limits[key];
      else limits[key] = main.childLayout[key];
    }
    childLayout = Object.keys(limits).length ? limits : undefined;
  }
  const actual = withLayerTransform({...template, kind:"instance" as const, id:placed.id, parent:placed.parent,
    name:named ? placed.name : defaultInstanceName(doc, main), component:main.id, props:placed.props, source:nested ? placed.source : main.id,
    childLayout, sizing, constraints:placed.constraints, propRefs:placed.propRefs,
    visible:placed.visible, locked:placed.locked, isMask:placed.isMask, exposed:placed.exposed,
    constrainProportions:placed.constrainProportions, boolOp:placed.boolOp,
    overrides:own}, layerTransform(placed));
  let node: LayerNode = actual;
  for (const group of own ?? []) {
    if (isComponentGroup(group) && group !== "position") node = copyComponentGroup(placed,node,group);
  }
  return node as InstanceNode;
}

export function rebuildInstance(draft: HierarchyDraft, id: NodeId, nextId: bigint, depth = 0, spare: ReadonlyMap<NodeId,LayerNode> = new Map()): bigint {
  const doc = draft.document, placed = doc.nodes[id];
  if (placed?.kind !== "instance" || depth > 16) return nextId;
  const main = doc.nodes[placed.component];
  if (main?.kind !== "component" || ancestors(doc,main.id).includes(id) || ancestors(doc,id).includes(main.id)) return nextId;
  const old = new Map<NodeId,LayerNode>(), byPair = new Map<string,NodeId>(), bySource = new Map<NodeId, NodeId | null>();
  const previous = new Set([...subtreeIds(doc,id).slice(1),...spare.keys()]);
  for (const child of [...previous].sort((a,b)=>a.length-b.length || (a<b?-1:a>b?1:0))) {
    const node = doc.nodes[child] ?? spare.get(child)!;
    if (node.kind === "page") continue;
    old.set(child,node);
    if (!node.source) continue;
    const pair = node.parent+"/"+node.source;
    if (!byPair.has(pair)) byPair.set(pair,child);
    bySource.set(node.source,bySource.has(node.source) ? null : child);
  }
  const map = new Map<NodeId,NodeId>([[main.id,id]]), used = new Set<NodeId>(), edited = new Set<NodeId>();
  const blocked = new Set([main.id,...ancestors(doc,id).filter(parent=>doc.nodes[parent].kind === "component")]);
  const sourceIds: NodeId[] = [], pending = [...main.children].reverse();
  while (pending.length) {
    const next = pending.pop()!, node = doc.nodes[next];
    sourceIds.push(next);
    if (sourceIds.length>5_000_000) break;
    if (isLeaf(node) || node.kind === "instance" && blocked.has(node.component)) continue;
    for (let i=node.children.length-1; i>=0; i--) pending.push(node.children[i]);
  }
  let oldPaths: Map<string,NodeId> | undefined, mainPaths: Map<NodeId,string> | undefined;
  for (const source of sourceIds) {
    const layer = doc.nodes[source];
    const parent = layer.parent && map.get(layer.parent);
    if (!parent || edited.has(parent)) continue;
    let copy = byPair.get(parent+"/"+source) ?? bySource.get(source);
    if (!copy && old.size) {
      oldPaths ??= new Map([...namePaths(doc,id,true)].map(([key,path])=>[path,key]));
      mainPaths ??= namePaths(doc,main.id,false);
      copy = oldPaths.get(mainPaths.get(source)!);
    }
    if (!copy || used.has(copy)) {
      const allocation = draft.allocateId(nextId);
      copy = allocation.id;
      if (used.has(copy)) throw new Error("Document identifiers are exhausted");
      nextId = allocation.nextId;
    }
    const prior = old.get(copy);
    if (prior) old.set(copy,variantOverrides(doc,prior,layer));
    used.add(copy);
    map.set(source,copy);
    if (old.get(copy)?.overrides?.includes("slot") && slotName(doc,source) !== undefined) edited.add(copy);
  }
  const children = (ids: readonly NodeId[]) => Object.freeze(ids.flatMap(id => map.get(id) ?? []));
  const root = {...refreshRoot(doc,main,placed), children:children(main.children)};
  const defaults = defaultInstanceValues(main.props);
  const effective = Object.fromEntries(Object.entries(defaults).map(([k,v]) => [k,Object.hasOwn(placed.props,k) ? placed.props[k] : v]));
  const scopes = new Map<NodeId, readonly InstanceNode["props"][]>([[id,[effective]]]);
  const nodes: LayerNode[] = [], nested: NodeId[] = [], remeasure: NodeId[] = [];
  for (const source of sourceIds) {
    const copyId = map.get(source), original = doc.nodes[source];
    if (!copyId || original.kind === "page") continue;
    const parent = map.get(original.parent)!, values = scopes.get(parent)!, prev = old.get(copyId);
    let copy: LayerNode = {...boundCopy(doc,original,copyId,values), parent};
    if (prev) {
      const own = new Set(componentOverrides(prev));
      if (!edited.has(copyId)) own.delete("slot");
      for (const group of own) {
        if (isComponentGroup(group) && group !== "position" && group !== "size") copy = copyComponentGroup(prev,copy,group);
      }
      copy = withOverrideSet(copy,own);
    }
    if (!isLeaf(copy) && !isLeaf(original)) {
      copy = {...copy, children:children(original.children)};
      if (edited.has(copyId) && prev && !isLeaf(prev)) {
        copy = {...copy, children:prev.children};
        for (const kept of subtreeIds(doc,prev.id).slice(1)) nodes.push(old.get(kept)!);
      }
    }
    if (copy.kind === "instance") {
      scopes.set(copyId,[...values,copy.props]);
      if (original.kind === "instance" && copy.component !== original.component) nested.push(copyId);
    } else scopes.set(copyId,values);
    if (copy.kind === "text" && original.kind === "text" && copy.text !== original.text) remeasure.push(copyId);
    nodes.push(copy);
  }
  draft.replaceSubtree(root,nodes);
  if (Math.abs(root.width-main.width)>1e-9 || Math.abs(root.height-main.height)>1e-9) resizeChildren(draft,id,main.width,main.height);
  for (const copyId of map.values()) {
    const prev = old.get(copyId), copy = draft.nodes[copyId];
    if (!prev || copy.kind === "page") continue;
    for (const group of ["size","position"] as const) {
      if (!componentOverrides(prev).includes(group)) continue;
      const current = draft.nodes[copyId] as LayerNode;
      draft.set(copyComponentGroup(prev,current,group));
      if (group === "size" && !isLeaf(current)) resizeChildren(draft,copyId,current.width,current.height);
    }
  }
  for (const id of remeasure) { const text = draft.nodes[id]; if (text.kind === "text") draft.set(autoSizeText(text)); }
  for (const child of nested) {
    const unused = new Map<NodeId,LayerNode>();
    for (const [id,layer] of old) {
      if (used.has(id) || draft.nodes[id]) continue;
      let parent: NodeId | undefined = layer.parent;
      for (let d=0; parent && d<=64; d++) {
        if (parent === child) { unused.set(id,layer); break; }
        if (used.has(parent) || draft.nodes[parent]) break;
        parent = old.get(parent)?.parent;
      }
    }
    takePlacingOverrides(draft,child,old,unused);
    nextId = rebuildInstance(draft,child,nextId,depth+1,unused);
  }
  return nextId;
}

function takePlacingOverrides(draft: HierarchyDraft, id: NodeId, before: ReadonlyMap<NodeId,LayerNode>, spare: Map<NodeId,LayerNode>) {
  const doc = draft.document, placing = new Set<NodeId>();
  let link = doc.nodes[id].source;
  for (let depth=0; link && depth<=16; depth++) {
    const layer = doc.nodes[link];
    if (!layer || layer.kind === "component") break;
    const main = owningMain(doc,link);
    if (main) placing.add(main);
    link = layer.source;
  }
  function carry(current: LayerNode, prior: LayerNode) {
    const own = new Set(componentOverrides(current));
    let link = prior.source;
    for (let depth=0; link && depth<=16; depth++) {
      const layer = doc.nodes[link];
      if (!layer || layer.kind === "page" || !owningInstance(doc,link,false) || !placing.has(owningMain(doc,link) ?? "")) break;
      for (const group of componentOverrides(layer)) {
        if (own.has(group) || group === "size" || group === "position" || group === "slot") continue;
        own.add(group);
        if (isComponentGroup(group)) current = copyComponentGroup(layer,current,group);
      }
      link = layer.source;
    }
    return withOverrideSet(current,own);
  }
  for (const child of subtreeIds(doc,id).slice(1)) {
    const layer = doc.nodes[child], prior = before.get(child);
    if (layer.kind !== "page" && prior) draft.set(carry(layer,prior));
  }
  for (const [id,layer] of spare) spare.set(id,carry(layer,layer));
}

/** Propagate changes first to instances in dependent mains, then to the drawing's other instances. */
export function rebuildAffectedInstances(draft: HierarchyDraft, mains: ReadonlySet<NodeId>, nextId: bigint) {
  if (!mains.size) return nextId;
  const doc = draft.document, byMain = new Map<NodeId, Set<NodeId>>();
  for (const layer of Object.values(doc.nodes)) {
    if (layer.kind !== "instance") continue;
    let root = layer, owner = owningInstance(doc,root.id,false);
    while (owner) { root = owner; owner = owningInstance(doc,root.id,false); }
    const roots = byMain.get(layer.component) ?? new Set<NodeId>();
    roots.add(root.id);
    byMain.set(layer.component,roots);
  }
  const levels = new Map([...mains].map(id=>[id,0])), roots = new Map<NodeId,NodeId | undefined>();
  let wave = [...mains];
  for (let count = 0; wave.length && count < 64; count++) {
    const next = new Set<NodeId>();
    for (const main of wave) for (const root of byMain.get(main) ?? []) {
      const outer = ancestors(doc,root).find(id=>doc.nodes[id].kind === "component");
      roots.set(root,outer);
      const level = levels.get(main)!+1;
      if (outer && outer !== main && (levels.get(outer) ?? -1) < level) { levels.set(outer,level); next.add(outer); }
    }
    wave = [...next];
  }
  const level = (main?: NodeId) => main ? levels.get(main) ?? Infinity : Infinity;
  for (const [root] of [...roots].sort(([a,x],[b,y])=>level(x)-level(y) || a.length-b.length || (a<b ? -1 : a>b ? 1 : 0))) {
    nextId = rebuildInstance(draft,root,nextId);
  }
  return nextId;
}

/** Slot content becomes independent at its structural edit. Nested instances keep their own mains. */
export function adoptSlot(draft: HierarchyDraft, id: NodeId) {
  const slot = draft.nodes[id];
  if (slot.kind !== "frame" || slot.overrides?.includes("slot")) return;
  draft.set(withOverrideSet(slot, new Set([...componentOverrides(slot),"slot"])));
  const pending = [...slot.children];
  while (pending.length) {
    const node = draft.nodes[pending.pop()!];
    if (node.kind === "page") continue;
    if (node.kind === "instance") {
      const main = draft.nodes[node.component];
      if (main?.kind !== "component") continue;
      rebaseOwnedInstance(draft,node,main);
      continue;
    }
    const {source,propRefs,...plain} = node;
    draft.set(withOverrideSet(plain,new Set()));
    if (!isLeaf(node)) pending.push(...node.children);
  }
}

export function rebaseOwnedInstance(draft: HierarchyDraft, placed: InstanceNode, main: ComponentNode) {
  const doc = draft.document;
  const mainPaths = new Map([...namePaths(doc,main.id,false)].map(([id,path])=>[path,id]));
  const paths = namePaths(doc,placed.id,true);
  const members = new Set(mainPaths.values());
  for (const [id,path] of paths) {
    const child = draft.nodes[id];
    if (child.kind === "page") continue;
    let source = child.source;
    const seen = new Set<NodeId>([id]);
    while (source && !members.has(source) && !seen.has(source)) {
      seen.add(source);
      source = doc.nodes[source]?.source;
    }
    const target = source && members.has(source) ? source : mainPaths.get(path);
    const node = target ? doc.nodes[target] : undefined;
    const own = new Set(componentOverrides(child));
    own.delete("component"); own.delete("props");
    if (node && node.kind !== "page") {
      for (const group of differentComponentGroups(node,child)) {
        if (group !== "position" && group !== "size" && node.propRefs?.[group] === undefined) own.add(group);
      }
    } else own.clear();
    draft.set(withOverrideSet({...child,source:target},own));
  }
  const own = new Set(componentOverrides(placed));
  for (const group of ["component","props","position","resizing"]) own.delete(group);
  for (const group of differentComponentGroups(main,placed)) {
    if (!["component","props","name","resizing","position","size"].includes(group)) own.add(group);
  }
  if (placed.name !== defaultInstanceName(doc,main)) own.add("name");
  draft.set(withOverrideSet({...placed,source:main.id,propRefs:undefined},own));
}

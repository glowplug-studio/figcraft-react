import { reconcileNodeStyles } from "./style-application";
import { adoptSlot, rebuildAffectedInstances, rebuildInstance, rebaseOwnedInstance } from "./component-sync";
import { componentOverrides } from "./component-properties";
import { autoSizeText } from "./text-node-layout";
import { defaultConstraints, isFrameLike, isLeaf, layerTransform, type Document, type LayerNode, type NodeId } from "./document";
import { ancestors, HierarchyDraft, subtreeIds } from "./hierarchy";
import { boundCopy } from "./component-bindings";
import { assertNoNewComponentCycle, outermostInstance, owningInstance, propertyMains, propertyOwner, setBooleanDefault, slotName } from "./component-tree";

import { type ComponentGroup, copyComponentGroup, withOverrideSet, differentComponentGroups, sameComponentValue } from "./component-groups";

/** Legacy documents can predate the explicit mode override group on instance descendants. */
export function markLoadedModeOverrides(document:Document):Document {
  let draft:HierarchyDraft|undefined;
  for (const node of Object.values(document.nodes)) {
    if (!node.source || node.kind==="page" || node.overrides?.includes("modes")) continue;
    const source=document.nodes[node.source];
    if (!source || sameComponentValue(source.variableModes,node.variableModes) || !owningInstance(document,node.id,false)) continue;
    const own=new Set(componentOverrides(node));
    own.add("modes");
    (draft??=new HierarchyDraft(document)).set(withOverrideSet(node,own));
  }
  return draft?.finish() ?? document;
}

function sizeChanged(a: LayerNode, b: LayerNode) {
  return Math.abs(a.width - b.width) > 1e-6 || Math.abs(a.height - b.height) > 1e-6;
}

export function derivedGeometry(before: Document, after: Document, layer: LayerNode, group: "size" | "position") {
  for (const id of ancestors(after, layer.id)) {
    const a = before.nodes[id], b = after.nodes[id];
    if (a && b && a.kind !== "page" && b.kind !== "page" && sizeChanged(a,b)) return true;
  }
  const parent = after.nodes[layer.parent];
  if (group === "position") return isFrameLike(parent) && !!parent.layout && !layer.childLayout?.absolute;
  const old = before.nodes[layer.id];
  return layer.kind === "text" && (layer.text.autoResize === "widthAndHeight" ||
    layer.text.autoResize === "height" && old && old.kind !== "page" && Math.abs(old.width - layer.width) <= 1e-6);
}

export function instanceSlot(document: Document, id: NodeId) {
  for (const next of [id, ...ancestors(document, id)]) {
    if (document.nodes[next].kind === "instance") return;
    if (slotName(document, next) !== undefined) return next;
  }
}

function fixedLayout(layer: LayerNode) {
  if (!isFrameLike(layer) || !layer.layout) return;
  const {padding, gap, crossGap, mainAlign, crossAlign, contentAlign, ...settings} = layer.layout;
  return settings;
}

function placing(layer: LayerNode) {
  const {minWidth, minHeight, maxWidth, maxHeight, ...settings} = layer.childLayout ?? {};
  return settings;
}

function forbiddenOverride(before: Document, after: Document, a: LayerNode, b: LayerNode): string | undefined {
  if (!b.source || a.source !== b.source || !owningInstance(before,a.id) || !owningInstance(after,b.id)) return;
  const mainBefore = before.nodes[b.source], mainAfter = after.nodes[b.source];
  if (!mainBefore || !mainAfter || mainBefore.kind === "page" || mainAfter.kind === "page") return;
  const diverged = (read: (node: LayerNode) => unknown) =>
    !sameComponentValue(read(a), read(b)) && sameComponentValue(read(mainBefore), read(mainAfter));
  if (diverged(node => isFrameLike(node) ? node.layout?.mode : undefined)) return "The auto layout direction";
  if (diverged(fixedLayout)) return "This auto layout setting";
  if (!owningInstance(before,a.id,false) || !owningInstance(after,b.id,false)) return;
  if (diverged(layerTransform) && !derivedGeometry(before,after,b,"position")) return "A layer's position";
  if (diverged(node => node.constraints ?? defaultConstraints)) return "A layer's constraints";
  if (diverged(placing)) return "A layer's place in auto layout";
}

function relinkNewCopies(doc: Document, ids: readonly NodeId[]) {
  let draft: HierarchyDraft | undefined;
  for (const id of ids) {
    const current = draft?.document ?? doc, node = current.nodes[id];
    if (!node || node.kind === "page" || owningInstance(current,id,false)) continue;
    if (node.kind === "instance") {
      const main = current.nodes[node.component];
      if (main?.kind !== "component") continue;
      if (node.source !== main.id || !matchesInstanceStructure(current,node.id,main.id)) {
        rebaseOwnedInstance(draft ??= new HierarchyDraft(doc),node,main);
      }
    } else if (node.source || componentOverrides(node).length) {
      const {source,...layer} = node;
      (draft ??= new HierarchyDraft(doc)).set(withOverrideSet(layer,new Set()));
    }
  }
  return draft?.finish() ?? doc;
}

function matchesInstanceStructure(doc: Document, root: NodeId, main: NodeId) {
  const pairs: [NodeId,NodeId,number][] = [[root,main,0]];
  while (pairs.length) {
    const [copyId,sourceId,depth] = pairs.pop()!;
    const copy = doc.nodes[copyId], source = doc.nodes[sourceId];
    if (!copy || !source || depth>16 || copy.overrides?.includes("slot")) continue;
    const children = isLeaf(copy) ? [] : copy.children, originals = isLeaf(source) ? [] : source.children;
    if (children.length !== originals.length) return false;
    for (let i=0; i<children.length; i++) {
      const child = doc.nodes[children[i]], placed = doc.nodes[originals[i]];
      if (child.source !== placed.id) return false;
      const swapped = child.kind === "instance" && placed.kind === "instance" && child.component !== placed.component;
      pairs.push([child.id,swapped ? child.component : placed.id,depth+1]);
    }
  }
  return true;
}

/** Validate the whole edit before the session records history, consumes ids or publishes a selection. */
export function finishComponentEdit(before: Document, after: Document, nextId: bigint) {
  if (before.nodes === after.nodes) return {document:after,nextId};
  let styled: HierarchyDraft | undefined;
  const resolve = (id:string) => after.styles?.find(style => style.id === id || style.name === id);
  let hasInstance = false;
  const copies: NodeId[] = [], visibility: NodeId[] = [];
  for (const id in after.nodes) {
    const node = after.nodes[id];
    if (node.kind === "instance") hasInstance = true;
    const prior = before.nodes[id];
    if (node !== prior && (node.styles || node.kind === "text" && (node.text.style.styleId !== undefined || node.text.runs.length))) {
      const checked = reconcileNodeStyles(prior, node, resolve);
      if (checked !== node) (styled ??= new HierarchyDraft(after)).set(checked);
    }
    if (prior && prior !== node && prior.kind !== "page" && node.kind !== "page" && node.propRefs?.visible !== undefined &&
        (prior.visible !== false) !== (node.visible !== false)) visibility.push(id);
    if (!before.nodes[id] && node.kind !== "page" && (node.kind === "instance" || node.source || componentOverrides(node).length)) copies.push(id);
  }
  if (styled) after = styled.finish();
  if (visibility.length) {
    const defaults = new HierarchyDraft(after);
    for (const id of visibility) {
      const node = defaults.nodes[id], old = before.nodes[id];
      if (node.kind === "page" || old.kind === "page" || (node.visible !== false) === (old.visible !== false) || owningInstance(defaults.document,id,false)) continue;
      const owner = propertyOwner(defaults.document,id), key = node.propRefs?.visible;
      if (owner && key !== undefined && node.kind !== "component") setBooleanDefault(defaults,propertyMains(defaults.document,owner),key,node.visible !== false);
    }
    after = defaults.finish();
  }
  if (!hasInstance) return {document:relinkNewCopies(after,copies),nextId};
  const changed: LayerNode[] = [];
  const slots = new Set<NodeId>();
  const rebuild = new Set<NodeId>();
  const structures = new Map<NodeId,NodeId>();
  const covered = new Set<NodeId>();
  let cycleHost: NodeId | undefined;
  for (const id in after.nodes) {
    const a = before.nodes[id], b = after.nodes[id];
    if (a === b) continue;
    if (a && !isLeaf(a) && !isLeaf(b) && !sameComponentValue(a.children, b.children)) {
      const owner = owningInstance(after,id);
      const slot = owner && instanceSlot(after,id);
      if (slot) slots.add(slot);
      if (owner && owningInstance(before,id) && !instanceSlot(before,id) && !slot) {
        throw new Error(`Layers can't be added, removed or reordered inside the instance "${owner.name}": edit its main component, or detach the instance first`);
      }
    }
    if (a && a.kind !== "page" && b.kind !== "page") {
      changed.push(b);
      const refused = forbiddenOverride(before,after,a,b);
      if (refused) throw new Error(`${refused} comes from the main component in an instance: edit the main component, or detach the instance`);
    }
    if (b.kind !== "page") {
      const structural = !a || a.kind !== b.kind || a.parent !== b.parent ||
        !isLeaf(a) && !isLeaf(b) && !sameComponentValue(a.children,b.children);
      if (structural) {
        const main = [id,...ancestors(after,id)].find(key => after.nodes[key].kind === "component");
        if (!a && b.kind === "component") rebuild.add(b.id);
        if (main && a && !isLeaf(a) && !isLeaf(b) && !owningInstance(after,id) &&
            sameComponentValue({...b,children:a.children,overrides:a.overrides}, {...a,overrides:a.overrides})) {
          const gained = b.children.filter(child => !a.children.includes(child)).flatMap(child=>subtreeIds(after,child));
          const plain = gained.every(id => {
            const layer = after.nodes[id];
            return !before.nodes[id] && !["component","componentSet","instance"].includes(layer.kind) && !layer.source && !layer.propRefs;
          });
          if (plain && a.children.every(child => b.children.includes(child) || !after.nodes[child])) {
            structures.set(id,main);
            for (const child of gained) covered.add(child);
          } else rebuild.add(main);
        } else if (main && a) rebuild.add(main);
        if (a?.parent && a.parent !== b.parent) {
          const oldMain = ancestors(before,id).find(key => before.nodes[key].kind === "component");
          if (oldMain) rebuild.add(oldMain);
        }
      }
    }
    if (!cycleHost && (!a || a.parent !== b.parent || a.kind !== b.kind ||
        a.kind === "instance" && b.kind === "instance" && (a.component !== b.component || a.props !== b.props))) {
      cycleHost = [id, ...ancestors(after,id)].find(key => after.nodes[key].kind === "component");
    }
  }
  for (const id in after.nodes) {
    if (before.nodes[id] || covered.has(id)) continue;
    const parent = after.nodes[id].parent;
    if (!parent) continue;
    const main = [parent,...ancestors(after,parent)].find(key => after.nodes[key].kind === "component");
    if (main) rebuild.add(main);
  }
  if (cycleHost) assertNoNewComponentCycle(before,after,cycleHost);
  if (slots.size) {
    const adoption = new HierarchyDraft(after);
    for (const slot of slots) adoptSlot(adoption,slot);
    after = adoption.finish();
  }
  return followComponentValues(before, relinkNewCopies(after,copies), changed, rebuild, structures, nextId);
}

function recordOverrides(before: Document, after: Document, node: LayerNode, changed: readonly ComponentGroup[]) {
  const owner = owningInstance(after, node.id);
  if (!owner) return node;
  const source = node.source && after.nodes[node.source];
  const top = owner === node && !owningInstance(after, node.id, false);
  const differs = source && source.kind !== "page" ? new Set(differentComponentGroups(source,node)) : undefined;
  if (differs && source && owner.id === node.id) {
    const parent = source.parent && after.nodes[source.parent];
    const name = parent && parent.kind === "componentSet" ? parent.name : source.name;
    if (node.name === name) differs.delete("name");
    else differs.add("name");
  }
  const overrides = new Set(componentOverrides(node));
  for (const group of changed) {
    if (top && (group === "modes" || group === "component" || group === "props" || group === "resizing" || group === "position")) continue;
    if ((group === "size" || group === "position") && derivedGeometry(before, after, node, group)) continue;
    if (!differs || differs.has(group)) overrides.add(group);
    else if (group !== "size" && group !== "position") overrides.delete(group);
  }
  return withOverrideSet(node, overrides);
}

function followsMainGeometry(document: Document, id: NodeId) {
  let below = document.nodes[id];
  for (const parentId of ancestors(document,id)) {
    const parent = document.nodes[parentId];
    if (parent.kind === "page" || parent.overrides?.includes("slot") || below.kind === "page") break;
    if (!(isFrameLike(parent) && parent.layout) || below.childLayout?.absolute) {
      if (parent.overrides?.some(group => group === "size" || group === "resizing")) return false;
      if (parent.kind === "instance") {
        const main = document.nodes[parent.component];
        if (!main || main.kind === "page" || Math.abs(main.width-parent.width)>1e-9 || Math.abs(main.height-parent.height)>1e-9) return false;
      }
    }
    below = parent;
  }
  return true;
}

function followComponentValues(before: Document, after: Document, changed: readonly LayerNode[], rebuild: Set<NodeId>, structures: ReadonlyMap<NodeId,NodeId>, nextId: bigint) {
  const pending: {id: NodeId; groups: readonly ComponentGroup[]}[] = [];
  const resync = new Set<NodeId>();
  let draft: HierarchyDraft | undefined;
  for (const candidate of changed) {
    const node = after.nodes[candidate.id];
    if (!node || node.kind === "page") continue;
    const old = before.nodes[node.id];
    if (old.kind === "page") continue;
    const groups = differentComponentGroups(old, node);
    const lost = componentOverrides(old).some(group=>!componentOverrides(node).includes(group));
    if (lost || node.kind === "instance" && (groups.includes("props") || groups.includes("component"))) {
      const root = outermostInstance(after,node.id);
      if (root) resync.add(root.id);
    }
    const main = node.kind === "component" ? node.id : ancestors(after,node.id).find(id => after.nodes[id].kind === "component");
    if (main && !structures.has(node.id)) {
      const nonPatchable = (!groups.length && !sameComponentValue(old,node)) ||
        groups.includes("resizing") || groups.includes("props") || groups.includes("component") ||
        node.kind === "component" && groups.includes("name") ||
        node.locked !== old.locked || node.isMask !== old.isMask || node.maskType !== old.maskType ||
        node.constrainProportions !== old.constrainProportions || !sameComponentValue(node.constraints,old.constraints) ||
        isFrameLike(node) && isFrameLike(old) && (node.clip !== old.clip || !sameComponentValue(fixedLayout(node),fixedLayout(old)));
      if (nonPatchable) rebuild.add(main);
    }
    if (!groups.length) continue;
    const recorded = recordOverrides(before,after,node,groups);
    if (recorded !== node) (draft ??= new HierarchyDraft(after)).set(recorded);
    if (main) pending.push({id:node.id,groups});
  }
  if (!pending.length && !rebuild.size && !structures.size && !resync.size) return {document:draft?.finish() ?? after,nextId};
  const copies = new Map<NodeId, NodeId[]>();
  for (const node of Object.values(after.nodes)) {
    if (!node.source) continue;
    const list = copies.get(node.source) ?? [];
    list.push(node.id);
    copies.set(node.source,list);
  }
  const targets = draft ??= new HierarchyDraft(after);
  for (const root of [...resync].sort((a,b)=>a.length-b.length || (a<b?-1:a>b?1:0))) {
    nextId = rebuildInstance(targets,root,nextId);
    const main = ancestors(targets.document,root).find(id=>targets.nodes[id].kind === "component");
    if (main) rebuild.add(main);
  }
  // A malformed imported source chain can loop. Each source/group only propagates once per edit.
  const propagated = new Map<NodeId,Set<ComponentGroup>>();
  for (let index = 0; index < pending.length; index++) {
    const {id,groups} = pending[index], source = targets.nodes[id];
    if (!source || source.kind === "page") continue;
    const seen = propagated.get(id) ?? new Set<ComponentGroup>();
    const fresh = groups.filter(group => !seen.has(group));
    if (!fresh.length) continue;
    for (const group of fresh) seen.add(group);
    propagated.set(id,seen);
    for (const copyId of copies.get(id) ?? []) {
      const copy = targets.nodes[copyId];
      if (!copy || copy.kind === "page" || !owningInstance(targets.document,copyId)) continue;
      if (source.kind === "instance" && copy.kind === "instance" && source.component !== copy.component) continue;
      const own = componentOverrides(copy);
      const applied: ComponentGroup[] = [];
      let next = copy;
      for (const group of fresh) {
        if (source.kind === "component" && group === "size" && own.includes("size")) rebuild.add(source.id);
        if (own.includes(group)) continue;
        if ((group === "position" || group === "size") && !followsMainGeometry(targets.document,copyId)) {
          const main = [id,...ancestors(targets.document,id)].find(key=>targets.nodes[key].kind === "component");
          if (main) rebuild.add(main);
        }
        if (source.kind === "component" && (group === "modes" || group === "position" || group === "visible" || group === "resizing")) continue;
        if (source.kind === "component" && group === "name") {
          const parent = targets.nodes[source.parent];
          next = {...next, name:parent.kind === "componentSet" ? parent.name : source.name};
        } else {
          const bound = source.propRefs?.[group], owner = bound !== undefined ? owningInstance(targets.document,copyId,false) : undefined;
          if (bound !== undefined && owner && Object.hasOwn(owner.props,bound)) continue;
          next = copyComponentGroup(source,next,group);
        }
        applied.push(group);
      }
      if (!applied.length) continue;
      if (next.kind === "text" && copy.kind === "text" && applied.some(g => g === "textStyle" || g === "characters" || g === "size")) {
        if (own.includes("textStyle") || own.includes("characters")) next = {...next,text:{...next.text,runs:copy.text.runs}};
        next = autoSizeText(next);
      }
      targets.set(next);
      pending.push({id:copyId,groups:applied});
    }
  }
  if (structures.size) {
    if (!rebuild.size) {
      const result = patchStructure(targets,before,[...structures.keys()],copies,nextId);
      nextId = result.nextId;
      if (!result.complete) for (const main of structures.values()) rebuild.add(main);
    } else for (const main of structures.values()) rebuild.add(main);
  }
  nextId = rebuildAffectedInstances(targets,rebuild,nextId);
  return {document:targets.finish(), nextId};
}

function patchStructure(draft: HierarchyDraft, before: Document, work: NodeId[], copies: ReadonlyMap<NodeId,NodeId[]>, nextId: bigint) {
  const visited = new Set<NodeId>();
  while (work.length) {
    const id = work.pop()!, source = draft.nodes[id];
    if (!source || isLeaf(source) || visited.has(id)) continue;
    visited.add(id);
    for (const copyId of copies.get(id) ?? []) {
      const copy = draft.nodes[copyId];
      if (!copy || isLeaf(copy) || copy.overrides?.includes("slot")) continue;
      if (source.kind === "instance" && copy.kind === "instance" && source.component !== copy.component) continue;
      const mirrors = new Map<NodeId,NodeId>(), order: NodeId[] = [];
      for (const child of copy.children) {
        const key = draft.nodes[child].source;
        if (!key || mirrors.has(key)) return {complete:false,nextId};
        mirrors.set(key,child);
      }
      for (const child of source.children) {
        const existing = mirrors.get(child);
        if (existing) { order.push(existing); mirrors.delete(child); continue; }
        const node = draft.nodes[child];
        if (before.nodes[child] || node.kind === "page" || copy.kind === "page" || !followsMainGeometry(draft.document,copyId)) return {complete:false,nextId};
        const constrains = !isFrameLike(copy) || !copy.layout || node.childLayout?.absolute;
        const main = copy.kind === "instance" ? draft.nodes[copy.component] : undefined;
        if (constrains && (copy.overrides?.some(g=>g === "size" || g === "resizing") || main && main.kind !== "page" && sizeChanged(main,copy))) return {complete:false,nextId};
        const mapped = new Map<NodeId,NodeId>();
        for (const old of subtreeIds(draft.document,child)) {
          const original = draft.nodes[old];
          if (original.kind === "page") throw new Error("Unexpected page inside a component");
          const allocation = draft.allocateId(nextId);
          nextId = allocation.nextId;
          mapped.set(old,allocation.id);
          draft.insert(boundCopy(draft.document,original,allocation.id,[]), old === child ? copyId : mapped.get(original.parent)!);
        }
        order.push(mapped.get(child)!);
      }
      for (const [lost,child] of mirrors) {
        if (draft.nodes[lost]) return {complete:false,nextId};
        draft.remove(child);
      }
      draft.set({...copy,children:Object.freeze(order)});
      work.push(copyId);
    }
  }
  return {complete:true,nextId};
}

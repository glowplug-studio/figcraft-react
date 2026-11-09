import { remapBindings } from "./list-variable-bindings";
import { definitionCommands, editDefinition } from "./property-authoring";
import { addVariant, combineVariants } from "./variant-authoring";
import { describeComponentProperties, withInstanceProperties } from "./component-variants";
import { assetSwapTarget, hideAssets, keepTextOverrides, placeAsset, swapInstance } from "./component-assets";
import { canExposeInstance, componentSlots, defaultMain, exposedCopies, outermostInstance, owningInstance, propertyNodeId, slotName } from "./component-tree";
import { componentOverrides, newComponentKind, type ComponentProperty } from "./component-properties";
import { copyComponentGroup, isComponentGroup, isOverrideGroup, sameComponentValue, withOverrideSet } from "./component-groups";
import { defaultInstanceValues } from "./component-bindings";
import { insertInstance } from "./component-instances";
import { rebaseOwnedInstance } from "./component-sync";
import { isLeaf, type Document, type InstanceNode, type LayerNode, type NodeId } from "./document";
import { ancestors, HierarchyDraft, pageForNode, subtreeIds } from "./hierarchy";
import { inspectedId, parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { remapPatternSources } from "./pattern-sources";

export const instanceCommandSpecs = {
  ...definitionCommands,
  "component.hideWhenPublishing": {label:"Hide when publishing",undo:true},
  "instance.place": {label:"Place instance",undo:true},
  "instance.swapAt": {label:"Swap instance at point",undo:true},
  "component.combineVariants": {label:"Combine as variants",undo:true},
  "component.addVariant": {label:"Add variant",undo:true},
  "component.goToMain": {label:"Go to main component",undo:false},
  "component.detach": {label:"Detach instance",undo:true},
  "component.resetInstance": {label:"Reset all changes",undo:true},
  "component.resetOverride": {label:"Reset override",undo:true},
  "component.pushChanges": {label:"Push changes to main component",undo:true},
  "component.restoreMain": {label:"Restore main component",undo:true},
  "component.exposeInstance": {label:"Expose nested instance",undo:true},
  "instance.exposed": {label:"Exposed nested instances",undo:false},
  "component.properties": {label:"Component properties",undo:false},
  "instance.setProperties": {label:"Set instance properties",undo:true},
  "instance.swap": {label:"Swap instance",undo:true},
  "instance.slotInsert": {label:"Insert into slot",undo:true},
  "instance.resetSlot": {label:"Reset slot",undo:true},
} as const;

function requestedIds(selection: readonly NodeId[], params: Record<string,unknown>, strict: boolean) {
  if (Array.isArray(params.ids)) {
    const ids = params.ids.map(parseNodeId);
    if (strict && ids.some(id=>id === undefined)) throw new Error("Every target must be a node id");
    return ids.filter((id): id is string => id !== undefined);
  }
  if (strict && params.ids != null) throw new Error("ids must be an array");
  const id = parseNodeId(params.id);
  if (strict && params.id != null && id === undefined) throw new Error("id must be a node id");
  return id === undefined ? selection : [id];
}

function resetDefaults(draft: HierarchyDraft, id: NodeId): boolean {
  const node = draft.nodes[id];
  if (node?.kind !== "instance") return false;
  const main = draft.nodes[node.component];
  if (main?.kind !== "component") return false;
  const props = defaultInstanceValues(main.props);
  if (sameComponentValue(props,node.props)) return false;
  draft.set({...node,props});
  return true;
}

function detach(draft: HierarchyDraft, root: InstanceNode) {
  const doc = draft.document;
  if (owningInstance(doc,root.id,false)) throw new Error("A nested instance can't be detached on its own: detach the outer instance first");
  const own = subtreeIds(doc,root.id).slice(1).filter(id=>owningInstance(doc,id,false)?.id === root.id);
  const nested: NodeId[] = [];
  for (const id of own) {
    const node = draft.nodes[id];
    if (node.kind === "page") continue;
    const {propRefs,...layer} = node;
    if (layer.kind === "instance") {
      draft.set(layer);
      nested.push(id);
    } else {
      const {source,...plain} = layer;
      draft.set(withOverrideSet(plain,new Set()));
    }
  }
  const {source,overrides,component,props,propRefs,...frame} = remapBindings(root,key=>key.startsWith("componentProperties/") ? undefined : key);
  const refs = Object.fromEntries(Object.entries(propRefs ?? {}).filter(([key])=>key !== "mainComponent"));
  const modes={...doc.nodes[root.component]?.variableModes,...root.variableModes};
  draft.set({...frame,...(Object.keys(modes).length>0 && {variableModes:Object.freeze(modes)}),kind:"frame",...(Object.keys(refs).length && {propRefs:Object.freeze(refs)})});
  for (const id of nested) {
    const node = draft.nodes[id];
    if (node.kind !== "instance") continue;
    const main = draft.nodes[node.component];
    if (main?.kind === "component") rebaseOwnedInstance(draft,node,main);
  }
}

function restoreMain(draft: HierarchyDraft, instance: InstanceNode, nextId: bigint) {
  const doc = draft.document, main = instance.component, parent = doc.nodes[instance.parent];
  if (doc.nodes[main]) throw new Error("The main component still exists");
  if (owningInstance(doc,instance.id,false)) throw new Error("Select the outer instance");
  if (isLeaf(parent)) throw new Error("An instance requires a parent container");
  const index = parent.children.indexOf(instance.id);
  const definitions: [string,ComponentProperty][] = [];
  for (const [key,value] of Object.entries(instance.props)) {
    if (typeof value === "boolean") definitions.push([key,{type:"boolean",default:value}]);
    else if (typeof value === "string") definitions.push([key,{type:"text",default:value}]);
    else {
      const id = propertyNodeId(value);
      if (id && doc.nodes[id]) definitions.push([key,{type:"instanceSwap",default:id,preferred:[]}]);
    }
  }
  const subtree = subtreeIds(doc,instance.id), ids = new Map([[instance.id,main]]), used = new Set([main]);
  const layers: LayerNode[] = [], nested: NodeId[] = [];
  for (const id of subtree) {
    const node = doc.nodes[id];
    if (node.kind === "page") throw new Error("Unexpected page inside an instance");
    if (id === instance.id) {
      const {component,props,source,propRefs,overrides,...layer} = instance;
      layers.push({...layer,...newComponentKind,props:Object.freeze(Object.fromEntries(definitions))});
      continue;
    }
    let replacement = node.source;
    if (!replacement || doc.nodes[replacement] || used.has(replacement)) {
      let allocation = draft.allocateId(nextId);
      while (used.has(allocation.id)) {
        if (allocation.nextId === BigInt(allocation.id)) throw new Error("Document identifiers are exhausted");
        allocation = draft.allocateId(allocation.nextId);
      }
      nextId = allocation.nextId;
      replacement = allocation.id;
    }
    ids.set(id,replacement); used.add(replacement);
    if (owningInstance(doc,node.parent)?.id !== instance.id) layers.push(node);
    else if (node.kind === "instance") { nested.push(replacement); layers.push(node); }
    else {
      const {source,...layer} = node;
      layers.push(withOverrideSet(layer,new Set()));
    }
  }
  draft.remove(instance.id);
  for (const layer of layers) {
    const restored = remapPatternSources(layer,source=>ids.get(source));
    const id = ids.get(layer.id)!;
    const root = id === main;
    draft.insert({...restored,id,...(!isLeaf(restored) && {children:Object.freeze([])})},root ? parent.id : ids.get(layer.parent)!,root ? index : undefined);
  }
  for (const id of nested) {
    const node = draft.nodes[id];
    if (node.kind !== "instance") continue;
    const target = draft.nodes[node.component];
    if (target?.kind === "component") rebaseOwnedInstance(draft,node,target);
  }
  return nextId;
}

function resolveSlot(doc: Document, id: NodeId, name?: string): NodeId {
  let slot = id;
  if (name !== undefined) {
    const found = componentSlots(doc,id).find(slot=>slot.name === name);
    if (!found) throw new Error(`No slot named ${name}`);
    slot = found.id;
  }
  if (slotName(doc,slot) === undefined || !owningInstance(doc,slot)) throw new Error("Not a slot of an instance");
  return slot;
}

export function executeInstanceCommand(command: keyof typeof instanceCommandSpecs, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string,unknown>) {
  const multiple = command === "component.hideWhenPublishing" || command === "component.combineVariants" || command === "component.detach" || command === "component.resetInstance" || command === "instance.swap" || command === "instance.setProperties";
  const bindingLayer = command === "component.bindProperty" ? parseNodeId(params.layer) : undefined;
  const ids = bindingLayer !== undefined ? [bindingLayer] : requestedIds(selection,params,multiple);
  const byPoint = command === "instance.place" || command === "instance.swapAt";
  if (!ids.length && !byPoint) throw new Error(command === "component.properties" ? "Select a component or instance" : "Select an instance");
  if (multiple) for (const id of ids) if (!document.nodes[id]) throw new Error("No node "+id);
  const first = ids[0], draft = new HierarchyDraft(document);
  let selected = selection, result: Record<string,unknown> = {};
  if (Object.hasOwn(definitionCommands,command)) {
    const edit = editDefinition(command as keyof typeof definitionCommands,draft,first,params,nextId);
    return {document:draft.finish(),selection:edit.selection ?? selection,nextId:edit.nextId,result:edit.result};
  }
  switch (command) {
    case "component.hideWhenPublishing":
      result = hideAssets(draft,ids,parseBoolean(params.on));
      break;
    case "component.combineVariants":
    case "component.addVariant": {
      const added = command === "component.combineVariants" ? combineVariants(draft,ids,nextId) : addVariant(draft,first,nextId,params);
      nextId = added.nextId;
      selected = Object.freeze([added.id]);
      result = {id:added.id};
      break;
    }
    case "instance.exposed":
      result = {instances:exposedCopies(document,first).map(node=>({id:inspectedId(node.id),name:node.name}))};
      break;
    case "component.exposeInstance": {
      const node = draft.nodes[first];
      if (!canExposeInstance(document,first) || node.kind !== "instance") throw new Error("Only instances nested inside a main component can be exposed");
      const exposed = parseBoolean(params.exposed) ?? true;
      if (!!node.exposed !== exposed) {
        const {exposed:previous,...rest} = node;
        draft.set(exposed ? {...rest,exposed:true} : rest);
      }
      result = {id:inspectedId(first),exposed};
      break;
    }
    case "component.properties":
      return {document,selection,nextId,result:describeComponentProperties(document,first)};
    case "instance.setProperties": {
      const properties = params.properties;
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("`properties` object required");
      for (const id of ids) {
        const node = draft.nodes[id];
        if (node.kind !== "instance") throw new Error(id+" is not an instance");
        const updated = withInstanceProperties(draft.document,node,properties as Record<string,unknown>);
        if (updated !== node) draft.set(updated);
      }
      result = {ok:true};
      break;
    }
    case "component.goToMain": {
      const instance = owningInstance(document,first);
      if (!instance) throw new Error("Not an instance");
      const main = instance.component, page = pageForNode(document,main);
      if (!page) throw new Error("The main component was deleted (use component.restoreMain)");
      const shown = document.currentPage === page ? document : Object.freeze({...document,currentPage:page});
      return {document:shown, selection:Object.freeze([main]), nextId, result:{id:main}};
    }
    case "component.detach": {
      const detached: NodeId[] = [];
      for (const id of ids) {
        const node = draft.nodes[id];
        if (!node) throw new Error("No node "+id);
        if (node.kind === "instance") { detach(draft,node); detached.push(id); }
      }
      if (!detached.length) throw new Error("Select an instance");
      selected = Object.freeze(detached);
      result = {ids:detached};
      break;
    }
    case "component.restoreMain": {
      const node = draft.nodes[first];
      if (node?.kind !== "instance") throw new Error("Select an instance");
      nextId = restoreMain(draft,node,nextId);
      selected = Object.freeze([node.component]);
      result = {id:node.component};
      break;
    }
    case "component.resetInstance": {
      const done: NodeId[] = [];
      for (const id of ids) {
        const inst = owningInstance(draft.document,id);
        if (!inst) continue;
        const top = !owningInstance(draft.document,inst.id,false);
        for (const child of subtreeIds(draft.document,inst.id)) {
          const layer = draft.nodes[child];
          if (layer.kind === "page") continue;
          const keep = top && child === inst.id && componentOverrides(layer).includes("size") ? ["size"] : [];
          draft.set(withOverrideSet(layer,new Set(keep)));
        }
        if (top) {
          draft.set(remapBindings(draft.nodes[inst.id],key=>key.startsWith("componentProperties/") ? undefined : key));
          resetDefaults(draft,inst.id);
        }
        done.push(inst.id);
      }
      if (!done.length) throw new Error("Select an instance");
      result = {ids:done};
      break;
    }
    case "component.resetOverride": {
      const node = draft.nodes[first], group = parseString(params.group);
      if (group !== undefined && !isOverrideGroup(group)) throw new Error(`Unknown group ${group}`);
      if (!node?.source || node.kind === "page" || !owningInstance(document,first)) throw new Error("Not a layer of an instance");
      const own = new Set(componentOverrides(node));
      if (group !== undefined) own.delete(group); else own.clear();
      const next = withOverrideSet(node,own);
      draft.set(next);
      const defaults = (group === undefined || group === "props") && !owningInstance(document,first,false) && resetDefaults(draft,first);
      result = {changed:next !== node || defaults};
      break;
    }
    case "component.pushChanges": {
      const inst = outermostInstance(document,first);
      if (!inst) throw new Error("Not an instance");
      if (!draft.nodes[inst.component]) throw new Error("The main component was deleted");
      let count = 0;
      for (const id of subtreeIds(document,inst.id)) {
        const layer = draft.nodes[id], source = id === inst.id ? inst.component : layer.source;
        if (!source || layer.kind === "page") continue;
        let target = draft.nodes[source];
        if (!target || target.kind === "page" || !(source === inst.component || ancestors(document,source).includes(inst.component))) continue;
        const own = new Set(componentOverrides(layer));
        const push = [...own].filter(g=>!["size","resizing","position","component","props","slot"].includes(g) && !(id === inst.id && g === "name"));
        if (!push.length) continue;
        for (const group of push) { if (isComponentGroup(group)) target = copyComponentGroup(layer,target,group); own.delete(group); }
        draft.set(target); draft.set(withOverrideSet(layer,own)); count++;
      }
      result = {layers:count};
      break;
    }
    case "instance.slotInsert":
    case "instance.resetSlot": {
      const slot = resolveSlot(document,first,parseString(params.slot));
      const node = draft.nodes[slot];
      if (node.kind !== "frame") throw new Error("A slot must be a frame");
      if (command === "instance.resetSlot") {
        const own = new Set(componentOverrides(node)), changed = own.delete("slot");
        if (changed) draft.set(withOverrideSet(node,own));
        result = {id:slot,changed}; break;
      }
      const requested = parseNodeId(params.component), main = requested && defaultMain(document,requested);
      if (!main) throw new Error("component must be a component or component set");
      if (params.index != null && !(typeof params.index === "number" && Number.isSafeInteger(params.index) && params.index >= 0)) throw new Error("index must be a child index");
      if (parseBoolean(params.replace)) for (const child of node.children) draft.remove(child);
      const placed = insertInstance(draft,main,slot,[1,0,0,1,0,0],nextId,typeof params.index === "number" ? params.index : undefined);
      nextId = placed.nextId; selected = Object.freeze([placed.id]); result = {id:placed.id,slot};
      break;
    }
    case "instance.place":
    case "instance.swapAt":
    case "instance.swap": {
      const requested = parseNodeId(params.component), main = requested && defaultMain(document,requested);
      if (!main) throw new Error("component must be a component or component set");
      if (command === "instance.swap") {
        for (const id of ids) swapInstance(draft,id,main);
        result = {ok:true};
        break;
      }
      const point = {x:parseNumber(params.x,"x"),y:parseNumber(params.y,"y")};
      if (command === "instance.place") {
        const placed = placeAsset(draft,main,point,nextId);
        nextId = placed.nextId;
        selected = Object.freeze([placed.id]);
        result = {id:placed.id,parent:placed.parent};
      } else {
        const target = assetSwapTarget(document,point,main);
        if (!target) throw new Error("There is no instance at that point to swap");
        keepTextOverrides(draft,target.id);
        swapInstance(draft,target.id,main);
        selected = Object.freeze([target.id]);
        result = {id:target.id,component:main.id};
      }
      break;
    }
  }
  return {document:draft.finish(),selection:selected,nextId,result};
}

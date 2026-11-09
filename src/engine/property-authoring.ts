import { withTranslation } from "./affine";
import { orderedComponentPropertyNames, type ComponentProperty } from "./component-properties";
import { defaultMain, owningInstance, owningMainComponent, propertyMains, propertyNodeId, propertyOwner, setBooleanDefault, slotName } from "./component-tree";
import { coerceComponentValue, variantOptions, variantProperties } from "./component-variants";
import { layerTransform, withLayerTransform, type ComponentNode, type ComponentSetNode, type Document, type NodeId } from "./document";
import { HierarchyDraft, subtreeIds } from "./hierarchy";
import { wireId } from "./native-values";
import { parseBoolean, parseNodeId, parseString } from "./parameters";
import { compareScalarKeys } from "./text-breaks";
import { fitVariantSet, wrapVariantSet } from "./variant-authoring";

type Params = Record<string,unknown>;
const fields = {boolean:"visible",text:"characters",instanceSwap:"mainComponent",slot:"slot"} as const;
function required(p: Params, key: string) {
  const value = parseString(p[key]);
  if (value === undefined) throw new Error(key+" must be a string");
  return value;
}
function validName(raw: string) {
  const name = raw.trim();
  if (!name || /[,=]/.test(name) || [...name].length>200) throw new Error("Property names must be non-empty, without ',' or '=' and at most 200 characters");
  return name;
}

function preferredComponents(doc: Document, input: unknown) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("Preferred must be an array of component ids");
  const ids = new Set<NodeId>();
  for (const raw of input.slice(0,500)) {
    const id = parseNodeId(raw), node = id ? doc.nodes[id] : undefined;
    if (node?.kind !== "component" && node?.kind !== "componentSet") throw new Error("Preferred entries must be components or component sets");
    ids.add(node.id);
  }
  return [...ids];
}

function boundProperty(draft: HierarchyDraft, layer: NodeId, name?: string, field?: string) {
  const node = draft.nodes[layer], main = owningMainComponent(draft.document,layer);
  if (!node || node.kind === "page" || !main) throw new Error("The layer must belong to a main component");
  if (owningInstance(draft.document,layer,false)) throw new Error("Layers inside an instance cannot be bound");
  const refs = new Map(Object.entries(node.propRefs ?? {}));
  if (!name) {
    if (field) refs.delete(field); else refs.clear();
    draft.set({...node,propRefs:refs.size ? Object.fromEntries(refs) : undefined});
    return;
  }
  const def = Object.hasOwn(main.props,name) ? main.props[name] : undefined;
  if (!def) throw new Error("The component has no property named "+name);
  if (def.type === "variant") throw new Error("Variant properties select variants and cannot bind to a layer");
  const expected = fields[def.type];
  if (field !== undefined && field !== expected) throw new Error(name+" can only control "+expected);
  if (expected === "characters" && node.kind !== "text") throw new Error("Text properties bind to text layers");
  if (expected === "mainComponent" && node.kind !== "instance") throw new Error("Swap properties bind to instances");
  if (expected === "visible" && node.id === main.id) throw new Error("A main cannot be hidden by its own property");
  if (expected === "slot") {
    if (node.kind !== "frame") throw new Error("Slots bind to frames");
    if (subtreeIds(draft.document,main.id).some(id=>id !== layer && draft.nodes[id].propRefs?.slot === name)) throw new Error("Another frame already uses this slot");
  }
  refs.set(expected,name);
  draft.set({...node,propRefs:Object.fromEntries(refs),...(def.type === "boolean" && {visible:def.default ? undefined : false})});
}

function setDefinition(draft: HierarchyDraft, main: ComponentNode, name: string, key?: string, definition?: ComponentProperty) {
  const props = new Map(Object.entries(main.props));
  props.delete(name);
  if (key !== undefined && definition) props.set(key,definition);
  const order = orderedComponentPropertyNames(main.props,main.propOrder).map(k=>k === name ? key : k)
    .filter((k): k is string => k !== undefined && props.has(k));
  for (const k of [...props.keys()].sort(compareScalarKeys)) if (!order.includes(k)) order.push(k);
  draft.set({...main,props:Object.fromEntries(props),propOrder:order});
}

function renameReferences(draft: HierarchyDraft, main: NodeId, old: string, key?: string) {
  for (const id of subtreeIds(draft.document,main)) {
    const node = draft.nodes[id];
    if (node.kind === "page" || !node.propRefs || !Object.values(node.propRefs).includes(old)) continue;
    const refs = Object.entries(node.propRefs).flatMap(([field,name])=>name !== old ? [[field,name]] : key === undefined ? [] : [[field,key]]);
    draft.set({...node,propRefs:refs.length ? Object.fromEntries(refs) : undefined});
  }
  for (const node of Object.values(draft.nodes)) {
    if (node.kind !== "instance" || node.component !== main || !Object.hasOwn(node.props,old)) continue;
    const {[old]:value,...rest} = node.props;
    draft.set({...node,props:key === undefined ? rest : {...rest,[key]:value}});
  }
}

function editVariantFields(draft: HierarchyDraft, set: ComponentSetNode, mains: readonly ComponentNode[], name: string, newName: string, p: Params, remove: boolean) {
  const options = variantOptions(draft.document,set);
  const key = newName, order = [...options.keys()].map(k=>k === name ? key : k);
  const old = parseString(p.value), replacement = parseString(p.newValue)?.trim();
  if (!remove && old !== undefined && replacement !== undefined && (!options.get(name)?.includes(old) || !replacement || /[,=]/.test(replacement))) throw new Error("Invalid variant value rename");
  if (!remove && p.index != null) {
    if (typeof p.index !== "number" || !Number.isSafeInteger(p.index) || p.index<0) throw new Error("Index must be a property place");
    order.splice(order.indexOf(key),1);
    order.splice(Math.min(p.index,order.length),0,key);
  }
  for (const main of mains) {
    const pairs = variantProperties(main.name), value = pairs.get(name);
    pairs.delete(name);
    if (!remove && value !== undefined) pairs.set(key,value === old && replacement !== undefined ? replacement : value);
    const label = order.filter(k=>pairs.has(k)).map(k=>k+"="+pairs.get(k)).join(", ");
    draft.set({...main,name:remove && !pairs.size ? "Default" : label});
  }
  const selected = parseString(p.default), current = defaultMain(draft.document,set.id);
  if (remove || selected === undefined || !current) return;
  const wanted = variantProperties(current.name);
  wanted.set(key,selected);
  const candidates = mains.map(({id})=>draft.nodes[id]).filter(n=>n.kind === "component");
  const chosen = candidates.find(n=>{
    const pairs = variantProperties(n.name);
    return pairs.size === wanted.size && [...wanted].every(([k,v])=>pairs.get(k) === v);
  }) ?? candidates.find(n=>variantProperties(n.name).get(key) === selected);
  if (!chosen) throw new Error("No variant has "+key+"="+selected);
  if (current.id === chosen.id) return;
  draft.set(withLayerTransform(current,withTranslation(layerTransform(current),chosen)));
  draft.set(withLayerTransform(chosen,withTranslation(layerTransform(chosen),current)));
  fitVariantSet(draft,set.id);
}

export const definitionCommands = {
  "component.addProperty":{label:"Add component property",undo:true},
  "component.editProperty":{label:"Edit component property",undo:true},
  "component.deleteProperty":{label:"Delete component property",undo:true},
  "component.bindProperty":{label:"Bind layer to property",undo:true},
  "component.makeSlot":{label:"Make slot",undo:true},
  "component.removeSlot":{label:"Remove slot",undo:true},
} as const;

export function editDefinition(command: keyof typeof definitionCommands, draft: HierarchyDraft, target: NodeId, p: Params, nextId: bigint):
  {result:Record<string,unknown>; nextId:bigint; selection?:readonly NodeId[]} {
  const doc = draft.document;
  const ok = {result:{ok:true},nextId};
  if (command === "component.bindProperty") {
    const field = parseString(p.field);
    if (field !== undefined && !Object.values(fields).some(v=>v === field)) throw new Error("Unknown property field");
    boundProperty(draft,target,parseString(p.property),field);
    return ok;
  }
  if (command === "component.removeSlot") {
    const name = slotName(doc,target);
    if (owningInstance(doc,target) || name === undefined) throw new Error("Select a slot frame on a main component");
    editDefinition("component.deleteProperty",draft,target,{name},nextId);
    return {nextId,result:{id:target,name}};
  }
  const owner = propertyOwner(doc,target);
  if (!owner) throw new Error("Select a component, component set or layer of a component");
  const mains = propertyMains(doc,owner);
  const variants = owner.kind === "componentSet" ? variantOptions(doc,owner) : new Map<string,string[]>();
  const taken = (name: string) => variants.has(name) || mains.some(m=>Object.hasOwn(m.props,name));
  const node = doc.nodes[target];
  if (command === "component.makeSlot") {
    if (node.kind !== "frame" || owningInstance(doc,target)) throw new Error("Only a frame inside a main component can become a slot");
    if (slotName(doc,target) !== undefined) throw new Error(node.name+" is already a slot");
    const base = [...node.name.replace(/[,=]/g,"")].slice(0,100).join("").trim() || "Slot";
    let name = parseString(p.name);
    if (name === undefined) {
      name = base;
      for (let i=2; taken(name) && i<10000; i++) name=base+" "+i;
    }
    return editDefinition("component.addProperty",draft,target,{...p,layer:target,name,type:"slot"},nextId);
  }
  const raw = required(p,"name");
  if (command === "component.addProperty") {
    if (owningInstance(doc,target,false)) throw new Error("Select a main component or one of its layers");
    const name = validName(raw), type = required(p,"type").toLowerCase();
    if (taken(name)) throw new Error("A property named "+name+" already exists");
    const layerId = parseNodeId(p.layer) ?? (target !== owner.id && node.kind !== "component" ? target : undefined);
    const layer = layerId ? doc.nodes[layerId] : undefined;
    if (type === "variant") {
      const def = parseString(p.default)?.trim(), value = def && !/[,=]/.test(def) ? def : "Default";
      const allocation = owner.kind === "componentSet" ? {id:owner.id,nextId} : wrapVariantSet(draft,[owner.id],nextId);
      for (const {id} of mains) {
        const main = draft.nodes[id];
        draft.set({...main,name:(main.name.includes("=") ? main.name+", " : "")+name+"="+value});
      }
      return {result:{id:allocation.id},nextId:allocation.nextId,selection:[allocation.id]};
    }
    let def:ComponentProperty;
    switch (type) {
      case "boolean": case "bool":
        def = {type:"boolean",default:parseBoolean(p.default) ?? (layer?.kind === "page" || layer?.visible !== false)};
        break;
      case "text": def = {type:"text",default:parseString(p.default) ?? (layer?.kind === "text" ? layer.text.characters : name)}; break;
      case "instanceswap": case "instance_swap": case "instance": {
        const id = parseNodeId(p.default) ?? (layer?.kind === "instance" ? layer.component : undefined);
        const main = id && defaultMain(doc,id);
        if (!main) throw new Error("Default must be a component id");
        def = {type:"instanceSwap",default:main.id,preferred:preferredComponents(doc,p.preferred)};
        break;
      }
      case "slot":
        if (layer?.kind !== "frame") throw new Error("Select a frame for the slot");
        def = {type:"slot",preferred:preferredComponents(doc,p.preferred)}; break;
      default: throw new Error("Unknown property type "+type);
    }
    for (const main of mains) setDefinition(draft,main,name,name,def);
    if (def.type !== "slot") {
      const ids = new Set(mains.map(main=>main.id)), value = def.type === "instanceSwap" ? wireId(def.default) : def.default;
      for (const node of Object.values(draft.nodes)) {
        if (node.kind === "instance" && ids.has(node.component) && !Object.hasOwn(node.props,name)) draft.set({...node,props:{...node.props,[name]:value}});
      }
    }
    if (layerId !== undefined) boundProperty(draft,layerId,name);
    return {result:{id:owner.id,name},nextId};
  }
  const remove = command === "component.deleteProperty", rename = !remove ? parseString(p.newName) : undefined;
  const key = rename === undefined ? raw : validName(rename);
  if (key !== raw && taken(key)) throw new Error("A property named "+key+" already exists");
  if (owner.kind === "componentSet" && variants.has(raw)) {
    editVariantFields(draft,owner,mains,raw,key,p,remove);
    return ok;
  }
  const matching = mains.filter(m=>Object.hasOwn(m.props,raw));
  if (!matching.length) throw new Error("No property named "+raw);
  let def = matching[0].props[raw];
  if (!remove && Object.hasOwn(p,"default")) {
    const value = coerceComponentValue(doc,raw,def,p.default);
    if (def.type === "boolean" && typeof value === "boolean") def = {...def,default:value};
    if (def.type === "text" && typeof value === "string") def = {...def,default:value};
    if (def.type === "instanceSwap") def = {...def,default:propertyNodeId(value)!};
  }
  if (!remove && Object.hasOwn(p,"preferred")) {
    if (def.type !== "instanceSwap" && def.type !== "slot") throw new Error("Preferred is for swap and slot properties");
    def = {...def,preferred:preferredComponents(doc,p.preferred)};
  }
  for (const main of matching) {
    setDefinition(draft,main,raw,remove ? undefined : key,def);
    if (remove || key !== raw) renameReferences(draft,main.id,raw,remove ? undefined : key);
  }
  if (!remove && def.type === "boolean") setBooleanDefault(draft,mains,key,def.default);
  return ok;
}

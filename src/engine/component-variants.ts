import type { ComponentSetNode, Document, InstanceNode, NodeId } from "./document";
import { defaultInstanceValues } from "./component-bindings";
import { type ComponentProperty, type InstanceValue, inspectedPropertyValues, orderedComponentPropertyNames } from "./component-properties";
import { defaultMain, componentSlots } from "./component-tree";
import { ancestors } from "./hierarchy";
import { wireId } from "./native-values";
import { inspectedId, parseNodeId } from "./parameters";
import { compareScalarKeys, nativeFloat } from "./text-breaks";
import { sameComponentValue } from "./component-groups";

export function variantPairs(name: string): [string,string][] {
  const pairs: [string,string][] = [];
  for (const part of name.split(",")) {
    const equals = part.indexOf("=");
    if (equals >= 0) pairs.push([part.slice(0,equals).trim(),part.slice(equals+1).trim()]);
  }
  return pairs;
}

export function variantProperties(name: string) {
  return new Map(variantPairs(name));
}

export function variantOptions(doc: Document, set: ComponentSetNode) {
  const result = new Map<string, string[]>();
  for (const child of set.children) {
    for (const [key,value] of variantPairs(doc.nodes[child].name)) {
      const options = result.get(key);
      if (!options) result.set(key,[value]);
      else if (!options.includes(value)) options.push(value);
    }
  }
  return result;
}

export function matchingVariant(doc: Document, set: ComponentSetNode, wanted: ReadonlyMap<string,string>) {
  let best: NodeId | undefined, bestScore = -1;
  for (const id of set.children) {
    const values = variantProperties(doc.nodes[id].name);
    let score = 0;
    for (const [k,v] of wanted) if (values.get(k) === v) score++;
    if (score === wanted.size) return id;
    // Rust max_by_key keeps the last child on a partial tie.
    if (score >= bestScore) { best = id; bestScore = score; }
  }
  return best;
}

function jsonText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? String(value) : nativeFloat(value);
  }
  if (Array.isArray(value)) return "[" + value.map(jsonText).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a],[b])=>compareScalarKeys(a,b));
    return "{" + entries.map(([k,v])=>JSON.stringify(k) + ":" + jsonText(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function coerceComponentValue(doc: Document, name: string, def: ComponentProperty, value: unknown): InstanceValue {
  switch (def.type) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      throw new Error(`\`${name}\` is a boolean property`);
    case "text":
      if (typeof value === "string") return value;
      if (typeof value === "number" && Number.isFinite(value)) return jsonText(value);
      throw new Error(`\`${name}\` is a text property`);
    case "instanceSwap": {
      const id = parseNodeId(value), main = id && defaultMain(doc,id);
      if (!main) throw new Error(`\`${name}\` takes a component id`);
      return wireId(main.id);
    }
    case "variant": {
      const text = typeof value === "string" ? value : jsonText(value);
      if (!def.options.length || def.options.includes(text)) return text;
      throw new Error(`\`${name}\` must be one of ${JSON.stringify(def.options)}`);
    }
    case "slot":
      throw new Error(`\`${name}\` is a slot: fill it with instance.slotInsert or by adding layers to it`);
  }
}

export function withInstanceProperties(doc: Document, instance: InstanceNode, properties: Record<string,unknown>): InstanceNode {
  const original = doc.nodes[instance.component];
  const set = original?.parent ? doc.nodes[original.parent] : undefined;
  const variants = set?.kind === "componentSet" ? variantOptions(doc,set) : new Map<string,string[]>();
  const wanted = variantProperties(original?.name ?? "");
  const rest: [string,unknown][] = [];
  let changed = false;
  for (const name of Object.keys(properties).sort(compareScalarKeys)) {
    const raw = properties[name], options = variants.get(name);
    if (!options) { rest.push([name,raw]); continue; }
    const value = typeof raw === "string" ? raw : jsonText(raw);
    if (!options.includes(value)) throw new Error(`\`${name}\` must be one of ${JSON.stringify(options)}`);
    if (wanted.get(name) !== value) { wanted.set(name,value); changed = true; }
  }
  const component = changed && set?.kind === "componentSet" ? matchingVariant(doc,set,wanted) ?? instance.component : instance.component;
  const target = doc.nodes[component], defs = target?.kind === "component" ? target.props : {};
  const values = new Map(Object.entries({...defaultInstanceValues(defs),...instance.props}));
  for (const [name,value] of rest) {
    if (!Object.hasOwn(defs,name)) {
      const known = [...Object.keys(defs).sort(compareScalarKeys),...variants.keys()];
      throw new Error(`unknown property \`${name}\` (known: ${known.join(", ")})`);
    }
    values.set(name,coerceComponentValue(doc,name,defs[name],value));
  }
  const props = Object.freeze(Object.fromEntries(values));
  return component === instance.component && sameComponentValue(instance.props,props) ? instance : {...instance,component,props};
}

function conflictGroups(doc: Document, set: ComponentSetNode) {
  const groups = new Map<string,{pairs:[string,string][]; ids:(string|number)[]}>();
  for (const id of set.children) {
    const node = doc.nodes[id];
    if (node.kind !== "component") continue;
    const pairs = [...variantProperties(node.name)].sort(([a],[b])=>compareScalarKeys(a,b));
    const key = JSON.stringify(pairs);
    const group = groups.get(key);
    if (group) group.ids.push(inspectedId(id));
    else groups.set(key,{pairs,ids:[inspectedId(id)]});
  }
  return [...groups.values()].filter(group=>group.ids.length>1).sort((a,b)=>{
    for (let i=0; i<Math.min(a.pairs.length,b.pairs.length); i++) {
      const difference = compareScalarKeys(a.pairs[i][0],b.pairs[i][0]) || compareScalarKeys(a.pairs[i][1],b.pairs[i][1]);
      if (difference) return difference;
    }
    return a.pairs.length-b.pairs.length;
  }).map(group=>group.ids);
}

export function describeComponentProperties(doc: Document, id: NodeId) {
  const node = doc.nodes[id];
  if (!node) return null;
  const instance = node.kind === "instance" ? node : undefined;
  const component = instance?.component ?? defaultMain(doc,id)?.id ?? ancestors(doc,id).find(id=>doc.nodes[id].kind === "component");
  if (!component) return {properties:[]};
  const main = doc.nodes[component];
  const parent = main?.parent ? doc.nodes[main.parent] : undefined;
  const set = parent?.kind === "componentSet" ? parent : undefined;
  const properties: Record<string,unknown>[] = [];
  if (set) {
    const defaults = variantProperties(defaultMain(doc,set.id)?.name ?? "");
    const current = variantProperties(main.name);
    for (const [name,options] of variantOptions(doc,set)) {
      properties.push({name,type:"variant",options,default:defaults.get(name) ?? options[0],...(instance && {value:current.get(name) ?? null})});
    }
  }
  if (main?.kind === "component") {
    const names = orderedComponentPropertyNames(main.props,main.propOrder);
    const slots = names.some(k=>main.props[k].type === "slot") ? componentSlots(doc,instance?.id ?? set?.id ?? main.id) : [];
    for (const name of names) {
      const def = main.props[name], prop: Record<string,unknown> = {name,...def};
      if (def.type === "instanceSwap" || def.type === "slot") prop.preferred = def.preferred.map(inspectedId);
      if (def.type === "instanceSwap") prop.default = inspectedId(def.default);
      if (def.type === "slot") {
        const ids = slots.filter(slot=>slot.name === name).map(slot=>slot.id);
        const first = ids.length ? doc.nodes[ids[0]] : undefined;
        if (instance) prop.value = first?.kind === "frame" ? {layer:inspectedId(first.id),edited:first.overrides?.includes("slot") ?? false,layers:first.children.length} : null;
        else prop.layers = ids.map(inspectedId);
      } else if (instance) {
        prop.value = Object.hasOwn(instance.props,name) ? inspectedPropertyValues(instance.props[name]) : prop.default;
      }
      properties.push(prop);
    }
  }
  return {component:inspectedId(component),set:set ? inspectedId(set.id) : null,properties,conflicts:set ? conflictGroups(doc,set) : []};
}

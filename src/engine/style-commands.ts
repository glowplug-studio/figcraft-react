import { compareScalarKeys } from "./text-breaks";
import { bindingItem, canonicalBinding, rebindPaintAlpha, resolveStyle, styleForLayer } from "./style-variables";
import type { Paint } from "./solid-paint";
import { HierarchyDraft } from "./hierarchy";
import { sameComponentValue } from "./component-groups";
import { applyStyleToNode, propagateStyle, type ActiveStyleRange } from "./style-application";
import { explicitDefinition, nodeDefinition, styleBindingType, styleSlot } from "./style-definitions";
import type { Document } from "./document";
import { parseNodeId, parseString } from "./parameters";
import type { SharedStyle } from "./shared-styles";

export const styleOrderSpecs = {
  "style.duplicate": {label:"Duplicate style",undo:true},
  "style.move": {label:"Move styles",undo:true},
  "style.renameFolder": {label:"Rename style folder",undo:true},
} as const;

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = parseString(params[key]);
  if (value === undefined) throw new Error(key + " must be a string");
  return value;
}

function normalisePath(name: string): string {
  return name.split("/").map(part => part.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")).filter(Boolean).join("/");
}

function cleanName(name: string): string {
  const joined = normalisePath(name);
  if (!joined) throw new Error("name can't be empty");
  return Array.from(joined).slice(0, 500).join("");
}

function styleIndex(styles: readonly SharedStyle[], key: string): number {
  const index = styles.findIndex(style => style.id === key || style.name === key);
  if (index < 0) throw new Error("no style `" + key + "`");
  return index;
}

// The native single-user document starts at the catalogue length + 1 and skips IDs or names in use.
function newStyleId(styles: readonly SharedStyle[]) {
  const used = new Set(styles.flatMap(style => [style.id, style.name]));
  let n = styles.length + 1;
  while (used.has("S:" + n)) n++;
  return "S:" + n;
}

function copyName(styles: readonly SharedStyle[], name: string) {
  const names = new Set(styles.map(style => style.name));
  const base = name + " copy";
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : base + " " + i;
    if (!names.has(candidate)) return candidate;
  }
  return base;
}

function moveStyles(styles: readonly SharedStyle[], p: Record<string, unknown>) {
  if (!Array.isArray(p.styles)) throw new Error("styles must be a list of style ids");
  const picked = new Set(p.styles.filter((key): key is string => typeof key === "string").map(key => styleIndex(styles, key)));
  if (!picked.size) throw new Error("no styles to move");
  const folder = parseString(p.folder), before = parseString(p.before);
  const destination = folder === undefined ? undefined : Array.from(normalisePath(folder)).slice(0, 500).join("");
  const beforeId = before === undefined ? undefined : styles[styleIndex(styles, before)].id;
  const rest: SharedStyle[] = [], moved: SharedStyle[] = [];
  for (const [index, style] of styles.entries()) {
    if (!picked.has(index)) {
      rest.push(style);
      continue;
    }
    const leaf = style.name.slice(style.name.lastIndexOf("/") + 1);
    const name = destination === undefined ? style.name : destination ? destination + "/" + leaf : leaf;
    moved.push(name === style.name ? style : Object.freeze({...style, name}));
  }
  const at = rest.findIndex(style => style.id === beforeId);
  const split = at < 0 ? rest.length : at;
  return [...rest.slice(0, split), ...moved, ...rest.slice(split)];
}

function renameFolder(styles: readonly SharedStyle[], p: Record<string, unknown>) {
  const folder = cleanName(requiredString(p, "folder")), destination = cleanName(requiredString(p, "name"));
  const prefix = folder + "/";
  if (!styles.some(style => style.name.startsWith(prefix))) throw new Error("no styles in folder `" + folder + "`");
  return styles.map(style => {
    if (folder === destination || !style.name.startsWith(prefix)) return style;
    return Object.freeze({...style, name: destination + "/" + style.name.slice(prefix.length)});
  });
}

export function orderStyles(document: Document, command: string, params: Record<string, unknown>) {
  const styles = document.styles ?? [];
  let result: Record<string, unknown> = {ok:true};
  let next: SharedStyle[];
  switch (command) {
    case "style.duplicate": {
      const index = styleIndex(styles, requiredString(params, "style"));
      const original = styles[index], id = newStyleId(styles);
      const copy = Object.freeze({...original, id, name:copyName(styles, original.name)});
      next = [...styles.slice(0, index + 1), copy, ...styles.slice(index + 1)];
      result = {id};
      break;
    }
    case "style.move": next = moveStyles(styles, params); break;
    case "style.renameFolder": next = renameFolder(styles, params); break;
    default: throw new Error("Unknown style command " + command);
  }
  if (next.length === styles.length && next.every((style, index) => style === styles[index])) return { document, result };
  return {document:Object.freeze({...document, styles:Object.freeze(next)}), result};
}

export const styleEditSpecs = {
  "style.bind": {label:"Bind variable in style",undo:true},
  "style.create": {label:"Create style",undo:true},
  "style.update": {label:"Edit style",undo:true},
  "style.delete": {label:"Delete style",undo:true},
} as const;

export function editStyleDefinition(document: Document, selection: readonly string[], command: string,
  p: Record<string, unknown>, live?: ActiveStyleRange) {
  const styles = document.styles ?? [];
  let next = [...styles], source = parseNodeId(p.from);
  let definition: SharedStyle | undefined, id: string;
  let result: Record<string, unknown> = {ok:true};
  let linkSource: ((draft: HierarchyDraft) => void) | undefined;
  if (command === "style.create") {
    const slot = styleSlot(requiredString(p, "type")), name = cleanName(requiredString(p, "name"));
    source ??= selection[0];
    const range = slot === "text" && live && live.start < live.end && (!source || source === live.node.id) && !Object.hasOwn(p, "value") ? live : undefined;
    if (range) source = range.node.id;
    const node = source === undefined ? undefined : document.nodes[source];
    const explicit = Object.hasOwn(p, "value");
    const value = explicit ? explicitDefinition(slot, p.value) : node && nodeDefinition(slot, node, range);
    if (!value) throw new Error("Pass a style value or select a layer with the requested property");
    id = newStyleId(styles);
    let created:SharedStyle=Object.freeze({id,name,description:parseString(p.description) ?? "",...value});
    if (!explicit && !range && node?.boundVariables) {
      const bound:Record<string,string>=Object.create(null);
      for (const field of Object.keys(node.boundVariables).sort(compareScalarKeys)) {
        const item=bindingItem(field);
        if ((slot==="fill" || slot==="stroke") && item?.list!==(slot==="fill" ? "fills" : "strokes")) continue;
        const key=item && (slot==="fill" || slot==="stroke") ? "fills/"+item.index+"/"+item.field : field;
        if (styleBindingType(created,key)) bound[key]=node.boundVariables[field];
      }
      if (Object.keys(bound).length) created=Object.freeze({...created,bound:Object.freeze(bound)});
    }
    definition = created;
    next.push(created);
    result = {id};
    if (!explicit && node) {
      linkSource = draft => draft.set(applyStyleToNode(node, slot, created, range && [range.start,range.end]));
    }
  } else {
    const index = styleIndex(styles, requiredString(p,"style")), original = styles[index];
    id = original.id;
    if (command === "style.delete") next = next.filter(style => style.id !== id);
    else if (command === "style.bind") {
      for (const key of Object.keys(p)) if (!["style","field","variable"].includes(key)) throw new Error("Unknown style.bind parameter "+key);
      const field=requiredString(p,"field");
      const type=styleBindingType(original,field);
      if (!type) throw new Error("The style has no field "+field+" to bind");
      const key=canonicalBinding(field), ref=parseString(p.variable);
      const variable=ref===undefined ? undefined : document.variables?.variables.find(v=>v.id===ref || v.name===ref);
      if (ref!==undefined && !variable) throw new Error("No such variable");
      if (variable && variable.resolvedType!==type) throw new Error(field+" takes a "+type+" variable");
      const {bound:previous,...base}=original;
      const bound={...previous};
      const was=Object.hasOwn(bound,key) ? bound[key] : undefined;
      if (variable) bound[key]=variable.id;
      else delete bound[key];
      let changed:SharedStyle={...base,...(Object.keys(bound).length>0 && {bound:Object.freeze(bound)})};
      const item=bindingItem(key);
      if (was!==variable?.id && changed.type==="paint" && item?.field==="color")
        changed={...changed,paints:rebindPaintAlpha(changed.paints,item.index,!!variable)};
      definition=resolveStyle(changed,document.variables);
      next[index]=definition;
    } else if (command === "style.update") {
      const slot = styleSlot(original.type), node = source === undefined ? undefined : document.nodes[source];
      const value = Object.hasOwn(p, "value") ? explicitDefinition(slot, p.value) : node && nodeDefinition(slot, node);
      const suppliedName = parseString(p.name);
      const name = suppliedName === undefined ? original.name : cleanName(suppliedName), description = parseString(p.description) ?? original.description;
      let updated: SharedStyle = value ? {...value, id, name, description} : {...original, name, description};
      if (value && original.bound) {
        const entries = Object.entries(original.bound).filter(([key]) => styleBindingType(updated, key) !== undefined);
        if (entries.length) updated = {...updated, bound:Object.freeze(Object.fromEntries(entries))};
      }
      updated=resolveStyle(updated,document.variables);
      definition = sameComponentValue(original, updated) ? original : Object.freeze(updated);
      next[index] = definition;
    } else throw new Error("Unknown style command " + command);
  }
  const {styles:previous, ...content} = document;
  const catalogue = next.length === styles.length && next.every((style, i) => style === styles[i]) ? document :
    Object.freeze({...content, ...(next.length && {styles:Object.freeze(next)})});
  const draft = new HierarchyDraft(catalogue);
  linkSource?.(draft);
  for (const node of Object.values(draft.nodes)) {
    if (!node.styles && (node.kind!=="text" || !node.text.style.styleId && !node.text.runs.some(r=>r.style.styleId))) continue;
    draft.set(propagateStyle(node,id,styleForLayer(catalogue,definition,node.id)));
  }
  return {document:draft.finish(), result};
}


/** The colour picker replaces one paint in the definition and propagates the complete stack. */
export function editStylePaint(document: Document, id: string, index: number, update: (paint: Paint) => Paint) {
  const style = document.styles?.find(s=>s.id === id);
  if (style?.type !== "paint" || !style.paints[index]) throw new Error("The style paint is no longer available");
  const value = style.paints.map((paint,i)=>i === index ? update(paint) : paint);
  return editStyleDefinition(document, [], "style.update", {style:id,value}).document;
}

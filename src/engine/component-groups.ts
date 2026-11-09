import { bindingItem } from "./variable-binding-key";
import { withStyleRef } from "./shared-styles";
import { componentOverrides } from "./component-properties";
import { compareScalarKeys } from "./text-breaks";
import { type LayerNode, isFrameLike, layerBlend, layerTransform, rectanglePaints, withLayerTransform } from "./document";
import { layerSizing, sizeLimitKeys } from "./auto-layout";
import { zeroCorners } from "./corners";
import { defaultStroke } from "./stroke";
import type { TextData } from "./text-data";

/** Equality of native property records is independent of object key insertion order. */
export function sameComponentValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.hasOwn(right, key) && sameComponentValue(left[key], right[key]));
}

const groups = ["fills", "strokes", "effects", "opacity", "visible", "name", "corners", "size", "resizing", "position",
  "characters", "textStyle", "padding", "gap", "alignment", "grids", "modes", "component", "props"] as const;
export type ComponentGroup = typeof groups[number];
export const isComponentGroup = (name: string): name is ComponentGroup => groups.some(group => group === name);

export const isOverrideGroup = (name: string) => isComponentGroup(name) || ["exports","interactions","slot"].includes(name);

function textStyle(text: TextData) {
  const {characters, path, savedBreaks, leadingTrim, ...style} = text;
  return style;
}

function groupValue(node: LayerNode, group: ComponentGroup): unknown {
  switch (group) {
    case "modes": return node.variableModes;
    case "grids": return [node.grids, node.styles?.grid ?? null];
    case "fills": return rectanglePaints(node);
    case "strokes": return [node.strokes ?? [], node.stroke ?? defaultStroke];
    case "effects": return node.effects ?? [];
    case "opacity": return [node.opacity ?? 1, layerBlend(node)];
    case "visible": return node.visible ?? true;
    case "name": return node.name;
    case "corners": return node.corners ?? zeroCorners;
    case "size": return [node.width, node.height];
    case "resizing": return [layerSizing(node), ...sizeLimitKeys.map(key => node.childLayout?.[key])];
    case "position": return layerTransform(node);
    case "characters": return node.kind === "text" ? node.text.characters : undefined;
    case "textStyle": return node.kind === "text" ? textStyle(node.text) : undefined;
    case "padding": return isFrameLike(node) ? node.layout?.padding : undefined;
    case "gap": return isFrameLike(node) && node.layout ? [node.layout.gap, node.layout.crossGap] : undefined;
    case "alignment": return isFrameLike(node) && node.layout ? [node.layout.mainAlign,node.layout.crossAlign,node.layout.contentAlign] : undefined;
    case "component": return node.kind === "instance" ? node.component : undefined;
    case "props": return node.kind === "instance" ? node.props : undefined;
  }
}

export function differentComponentGroups(a: LayerNode, b: LayerNode): ComponentGroup[] {
  return groups.filter(group => {
    if (group === "size") return Math.abs(a.width - b.width) > 1e-6 || Math.abs(a.height - b.height) > 1e-6;
    if ((group === "characters" || group === "textStyle") && (a.kind !== "text" || b.kind !== "text" || a.text === b.text)) return false;
    if ((group === "props" || group === "component") && (a.kind !== "instance" || b.kind !== "instance")) return false;
    if ((group === "gap" || group === "padding" || group === "alignment") &&
        (!isFrameLike(a) || !isFrameLike(b) || !a.layout || !b.layout || a.layout === b.layout)) return false;
    return !sameComponentValue(groupValue(a,group), groupValue(b,group));
  });
}

export function copyComponentGroup(from: LayerNode, to: LayerNode, group: ComponentGroup): LayerNode {
  to=copyGroupBindings(from,to,group);
  switch (group) {
    case "modes": return {...to,variableModes:from.variableModes};
    case "grids": return {...withStyleRef(to, "grid", from.styles?.grid ?? null), grids:from.grids};
    case "fills": return {...withStyleRef(to, "fill", from.styles?.fill ?? null), fill:from.fill, fills:from.fills};
    case "strokes": return {...withStyleRef(to, "stroke", from.styles?.stroke ?? null), strokes:from.strokes, stroke:from.stroke};
    case "effects": return {...withStyleRef(to, "effect", from.styles?.effect ?? null), effects:from.effects};
    case "opacity": return {...to, opacity:from.opacity, blend:from.blend};
    case "visible": return {...to, visible:from.visible};
    case "name": return {...to, name:from.name};
    case "corners": return {...to, corners:from.corners};
    case "size": {
      const result = {...to, width:from.width, height:from.height};
      return from.kind === "text" && result.kind === "text" ? {...result,text:{...result.text,autoResize:from.text.autoResize}} : result;
    }
    case "resizing": {
      const childLayout = {...to.childLayout};
      for (const key of sizeLimitKeys) {
        const value = from.childLayout?.[key];
        if (value === undefined) delete childLayout[key];
        else childLayout[key] = value;
      }
      const sizing = from.kind === "text" ? from.textSizing : from.sizing;
      return {...to, childLayout:Object.keys(childLayout).length ? Object.freeze(childLayout) : undefined,
        ...(to.kind === "text" ? {textSizing:sizing} : {sizing})};
    }
    case "position": return withLayerTransform(to, layerTransform(from));
    case "characters":
    case "textStyle": {
      if (group === "textStyle") to = withStyleRef(to, "text", from.styles?.text ?? null);
      if (from.kind !== "text" || to.kind !== "text") return to;
      const fields = group === "characters"
        ? {characters:from.text.characters, runs:from.text.runs, paragraphs:from.text.paragraphs} : textStyle(from.text);
      return {...to, text:Object.freeze({...to.text, ...fields})};
    }
    case "padding":
    case "gap":
    case "alignment": {
      if (!isFrameLike(from) || !isFrameLike(to) || !from.layout || !to.layout) return to;
      const {padding, gap, crossGap, mainAlign, crossAlign, contentAlign} = from.layout;
      const fields = group === "padding" ? {padding} : group === "gap" ? {gap,crossGap} : {mainAlign,crossAlign,contentAlign};
      return {...to, layout:Object.freeze({...to.layout,...fields})};
    }
    case "component": return from.kind === "instance" && to.kind === "instance" ? {...to,component:from.component} : to;
    case "props": return from.kind === "instance" && to.kind === "instance" ? {...to,props:from.props} : to;
  }
}

export function withOverrideSet(node: LayerNode, groups: ReadonlySet<string>): LayerNode {
  const ordered = [...groups].sort(compareScalarKeys);
  if (sameComponentValue(componentOverrides(node), ordered)) return node;
  const {overrides, ...rest} = node;
  if (rest.kind === "text") {
    const {charactersOverridden, ...text} = rest;
    const others = ordered.filter(group => group !== "characters");
    return {...text, ...(groups.has("characters") && {charactersOverridden:true}), ...(others.length && {overrides:Object.freeze(others)})};
  }
  return ordered.length ? {...rest, overrides:Object.freeze(ordered)} : rest;
}


// Groups marked by node.set, including a user explicitly setting the current value.
const propertyKeys: Partial<Record<ComponentGroup, string>> = {
  grids:"grids layoutGrids gridStyle",
  fills:"fills fill fillStyle",
  strokes:"strokeStyle strokes stroke strokeWeight strokeAlign dashes dashCap strokeCap startCap endCap strokeJoin strokeSides strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight miterLimit miterAngle widthProfile brush strokeBrush",
  effects:"effects effectStyle", opacity:"opacity blend blendMode", visible:"visible", name:"name", characters:"characters text",
  textStyle:"features fontFeatures openTypeFeatures listStyle indentation listSpacing maxLines variationSettings hangingPunctuation hangingList wrapStyle textWrap textDirection direction",
  corners:"cornerRadius cornerSmoothing topLeftRadius topRightRadius bottomRightRadius bottomLeftRadius",
  size:"width height w h", resizing:"sizingH sizingV layoutSizingHorizontal layoutSizingVertical minWidth maxWidth minHeight maxHeight",
  gap:"gap itemSpacing columnGap crossGap counterAxisSpacing rowGap",
  padding:"padding paddingTop paddingRight paddingBottom paddingLeft paddingHorizontal paddingVertical",
  alignment:"mainAlign primaryAxisAlignItems crossAlign counterAxisAlignItems contentAlign counterAxisAlignContent",
};
const propertyGroups = new Map<string,ComponentGroup>(groups.flatMap(group => (propertyKeys[group]?.split(" ") ?? []).map(key=>[key,group] as const)));

export function bindingGroup(key:string):ComponentGroup|undefined {
  const item=bindingItem(key);
  if (item) return item.list==="fills" || item.list==="strokes" || item.list==="effects" ? item.list : undefined;
  if (key.startsWith("componentProperties/") || ["fillStyle","strokeStyle","effectStyle"].includes(key)) return;
  return propertyGroups.get(key) ?? (/^(font|text|letter|line|paragraph)/.test(key) ? "textStyle" : undefined);
}

export function changedBindingGroups(a:LayerNode,b:LayerNode) {
  const result=new Set<ComponentGroup>();
  if (a.boundVariables!==b.boundVariables) for (const key of new Set([...Object.keys(a.boundVariables ?? {}),...Object.keys(b.boundVariables ?? {})])) {
    const group=bindingGroup(key);
    if (group && a.boundVariables?.[key]!==b.boundVariables?.[key]) result.add(group);
  }
  return result;
}

export function copyGroupBindings<T extends LayerNode>(from:LayerNode,to:T,group:ComponentGroup):T {
  if (from.boundVariables===to.boundVariables) return to;
  const belongs=(k:string)=>group==="props" ? k.startsWith("componentProperties/") : bindingGroup(k)===group;
  const remove=Object.keys(to.boundVariables ?? {}).filter(belongs);
  const add=Object.entries(from.boundVariables ?? {}).filter(([k])=>belongs(k));
  if (!remove.length && !add.length) return to;
  const {boundVariables,...rest}=to;
  const next:Record<string,string>=Object.assign(Object.create(null),boundVariables);
  for (const k of remove) delete next[k];
  for (const [k,v] of add) next[k]=v;
  return {...rest,...(Object.keys(next).length>0 && {boundVariables:Object.freeze(next)})} as T;
}

export function explicitOverrides(node: LayerNode, keys: readonly string[], ownRoot: boolean): LayerNode {
  const groups = new Set(componentOverrides(node));
  for (const key of keys) {
    const group = propertyGroups.get(key) ?? (/^(font|text|letter|line|paragraph)/.test(key) ? "textStyle" : undefined);
    if (group && !(ownRoot && group === "resizing")) groups.add(group);
  }
  return withOverrideSet(node, groups);
}

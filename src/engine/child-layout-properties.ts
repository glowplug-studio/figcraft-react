import { layerSizing, sizeLimitKeys, type ChildLayout, type LayerSizing, type Sizing } from "./auto-layout";
import { isLeaf, layerTransform, type DocumentNode, type LayerNode, type TextNode } from "./document";
import type { HierarchyDraft } from "./hierarchy";
import { frameInsets } from "./layout-geometry";
import { commandSizing } from "./layout-properties";
import { parseBoolean, parseNumber, propertyEnum } from "./parameters";

export const childLayoutKeys = new Set([...sizeLimitKeys, "sizingH", "sizingV", "layoutSizingHorizontal", "layoutSizingVertical",
  "absolute", "ignoreAutoLayout", "gridColumn", "gridColumnAnchorIndex", "gridRow", "gridRowAnchorIndex",
  "gridColumnSpan", "gridRowSpan", "gridAlignH", "gridChildHorizontalAlign", "gridAlignV", "gridChildVerticalAlign"]);
type Axis = keyof LayerSizing;

export function withSizing(node: LayerNode, horizontal: Sizing, vertical: Sizing): LayerNode {
  const old = layerSizing(node);
  if (old.horizontal === horizontal && old.vertical === vertical) return node;
  const key = node.kind === "text" ? "textSizing" : "sizing";
  if (horizontal === "fixed" && vertical === "fixed") {
    if (node.kind === "text") {
      const {textSizing, ...rest} = node;
      return rest;
    }
    const {sizing, ...rest} = node;
    return rest;
  }
  return {...node,[key]:Object.freeze({horizontal,vertical})};
}

function childField<T extends LayerNode, K extends keyof ChildLayout>(node: T, key: K, value: ChildLayout[K]): T {
  if (node.childLayout?.[key] === value) return node;
  const child = {...node.childLayout};
  if (value === undefined) delete child[key];
  else child[key] = value;
  if (Object.keys(child).length) return {...node,childLayout:Object.freeze(child)};
  const {childLayout: prior, ...rest} = node;
  return rest as T;
}

export function clearTextHeightLimit(node: TextNode) {
  return childField(node,"maxHeight",undefined);
}

function coherent(node: LayerNode, parent: DocumentNode | undefined) {
  if (node.kind !== "text" && !node.sizing) return node;
  const layoutParent = parent?.kind === "frame" && parent.layout && !node.childLayout?.absolute ? layerSizing(parent) : undefined;
  const sizing = layerSizing(node), text = node.kind === "text" ? node.text : undefined;
  const canHug = !!text || node.kind === "frame" && !!node.layout;
  const fix = (axis: Axis) => {
    let mode = sizing[axis];
    if (mode === "fill" && (!layoutParent || layoutParent[axis] === "hug") || mode === "hug" && !canHug) mode = "fixed";
    if (text && mode === "fixed" && (text.autoResize === "widthAndHeight" || axis === "vertical" && text.autoResize === "height")) return "hug";
    if (text && mode === "hug" && (text.autoResize === "none" || text.autoResize === "truncate")) return "fixed";
    return mode;
  };
  return withSizing(node,fix("horizontal"),fix("vertical"));
}

export function cohereEdits(draft: HierarchyDraft) {
  for (const id of [...draft.changedIds]) {
    const node = draft.nodes[id];
    if (!node) continue;
    const before = draft.originalDocument.nodes[id];
    if (before && node.kind !== "page" && before.kind === node.kind &&
      (before.x !== node.x || before.y !== node.y || before.transform !== node.transform) &&
      Object.keys({...before,...node}).every(k => k === "x" || k === "y" || k === "transform" || Reflect.get(before,k) === Reflect.get(node,k))) continue;
    const corrected = node.kind === "page" ? node : coherent(node,draft.nodes[node.parent]);
    if (corrected !== node) draft.set(corrected);
    if (!isLeaf(corrected)) for (const id of corrected.children) {
      const child = draft.nodes[id];
      if (child.kind !== "page") {
        const next = coherent(child,corrected);
        if (next !== child) draft.set(next);
      }
    }
  }
}

function changeSizing(draft: HierarchyDraft, node: LayerNode, mode: Sizing, axis: Axis) {
  const parent = draft.nodes[node.parent];
  if (mode === "fill") {
    if (parent.kind !== "frame" || !parent.layout) throw new Error("Fill needs an auto layout parent");
    const s = layerSizing(parent);
    if (s[axis] === "hug") draft.set(withSizing(parent,axis === "horizontal" ? "fixed" : s.horizontal,axis === "vertical" ? "fixed" : s.vertical));
  }
  if (mode === "hug" && node.kind !== "text" && !(node.kind === "frame" && node.layout)) throw new Error("Hug needs auto layout or text");
  const s = layerSizing(coherent(node,draft.nodes[node.parent]));
  const h = axis === "horizontal" ? mode : s.horizontal, v = axis === "vertical" ? mode : s.vertical;
  const changed = withSizing(node,h,v);
  if (changed.kind !== "text") return changed;
  const text = changed.text, truncates = text.autoResize === "truncate" || text.autoResize !== "none" && text.maxLines > 0;
  const autoResize = h === "hug" ? "widthAndHeight" : v === "hug" ? "height" : truncates ? "truncate" : "none";
  return autoResize === text.autoResize ? changed : {...changed,text:Object.freeze({...text,autoResize})};
}

/** Native fix_axis as used by explicit dimension edits. Evaluate before any rotation in the same command. */
export function explicitAxis(draft: HierarchyDraft, node: LayerNode, axis: Axis, length: number) {
  const parent = draft.nodes[node.parent], horizontal = axis === "horizontal", sizing = layerSizing(node);
  let mode: Sizing = "fixed";
  if (parent.kind === "frame" && parent.layout && !node.childLayout?.absolute && !parent.layout.wrap &&
      parent.layout.mode !== "grid" && layerSizing(parent)[axis] !== "hug") {
    const [,b,c] = layerTransform(node);
    const mainAxis = (parent.layout.mode === "horizontal") === horizontal;
    if (Math.abs(b) <= 1e-9 && Math.abs(c) <= 1e-9 && (!mainAxis || !parent.children.some(id => {
      const kid = draft.nodes[id];
      return id !== node.id && kid.kind !== "page" && kid.visible !== false && !kid.childLayout?.absolute;
    }))) {
      const [t,r,bottom,l] = frameInsets(parent);
      const available = horizontal ? parent.width-l-r : parent.height-t-bottom;
      if (available > 0 && Math.abs(length-available) < .01) mode = "fill";
    }
  }
  return withSizing(node, horizontal ? mode : sizing.horizontal, horizontal ? sizing.vertical : mode);
}

export function setChildProperty(draft: HierarchyDraft, node: LayerNode, key: string, value: unknown): LayerNode {
  const isAuto = value === null || typeof value === "string" && value.toLowerCase() === "auto";
  const integer = (min: number,max: number) => Math.trunc(Math.max(min,Math.min(max,parseNumber(value,key))));
  switch (key) {
    case "sizingH": case "layoutSizingHorizontal": return changeSizing(draft,node,commandSizing(value),"horizontal");
    case "sizingV": case "layoutSizingVertical": return changeSizing(draft,node,commandSizing(value),"vertical");
    case "absolute": case "ignoreAutoLayout": {
      const absolute = parseBoolean(value);
      if (absolute === undefined) throw new Error("absolute must be a boolean");
      const s = layerSizing(node);
      return childField(absolute ? withSizing(node,s.horizontal === "fill" ? "fixed" : s.horizontal,s.vertical === "fill" ? "fixed" : s.vertical) : node,
        "absolute",absolute || undefined);
    }
    case "gridColumn": case "gridColumnAnchorIndex": case "gridRow": case "gridRowAnchorIndex":
      return childField(node,key.startsWith("gridColumn") ? "gridColumn" : "gridRow",isAuto ? undefined : integer(0,999));
    case "gridAlignH": case "gridChildHorizontalAlign": case "gridAlignV": case "gridChildVerticalAlign":
      return childField(node,key.includes("H") ? "gridAlignH" : "gridAlignV",isAuto ? undefined : propertyEnum(value,["min","center","max"] as const));
    case "gridColumnSpan": case "gridRowSpan": return childField(node,key,integer(1,1000));
    case "minWidth": case "maxWidth": case "minHeight": case "maxHeight": {
      const limit = value === null ? undefined : Math.min(1e7,Math.max(0,parseNumber(value,key)));
      let next = childField(node,key,limit);
      const opposite = ({minWidth:"maxWidth",maxWidth:"minWidth",minHeight:"maxHeight",maxHeight:"minHeight"} as const)[key];
      const other = next.childLayout?.[opposite];
      if (limit !== undefined && other !== undefined && (key.startsWith("min") ? other < limit : other > limit)) next = childField(next,opposite,limit);
      if (key === "maxHeight" && limit !== undefined && next.kind === "text" && next.text.maxLines)
        return {...next,text:Object.freeze({...next.text,maxLines:0})};
      return next;
    }
    default: throw new Error("Unknown child layout property "+key);
  }
}

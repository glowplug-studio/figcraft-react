import { requiredTargets } from "./arrange";
import { sameComponentValue } from "./component-groups";
import { rectanglePaints, withRectanglePaints, type Document, type DocumentNode, type TextNode } from "./document";
import { HierarchyDraft } from "./hierarchy";
import { parseNumber, parseString } from "./parameters";
import { withStyleRef, type SharedStyle, type StyleSlot } from "./shared-styles";
import { samePaints } from "./solid-paint";
import type { TextData } from "./text-data";
import { fitEditedText } from "./text-node-layout";
import { commonParagraphList, editParagraphLists, normaliseRuns, paragraphSpan, restyleRange, sameTextData, scalarCount, textSpans } from "./text-ranges";
import type { TextStyle } from "./text-style";

type TextDefinition = Extract<SharedStyle, {type:"text"}>;
type Range = readonly [number, number];
export type ActiveStyleRange = {node: TextNode; start: number; end: number};
const noFeatures: Readonly<Record<string, boolean>> = Object.freeze({});
const noPaints = Object.freeze([]);

export function nodeFills(node: DocumentNode) {
  return node.kind === "page" ? node.fills ?? noPaints : rectanglePaints(node);
}

function unlink(style: TextStyle): TextStyle {
  if (style.styleId === undefined) return style;
  const {styleId, ...rest} = style;
  return Object.freeze(rest);
}

function takeStyle(style: TextStyle, definition: TextDefinition): TextStyle {
  const {fills, link, ...typography} = definition.style;
  return Object.freeze({...typography, ...(style.fills && {fills:style.fills}), ...(style.link !== undefined && {link:style.link}), styleId:definition.id});
}

function showsTypography(style: TextStyle, def: TextStyle) {
  return style.fontFamily === def.fontFamily && style.fontStyle === def.fontStyle && style.fontSize === def.fontSize &&
    style.decoration === def.decoration && style.case === def.case && sameComponentValue(style.lineHeight, def.lineHeight) &&
    sameComponentValue(style.letterSpacing, def.letterSpacing) && sameComponentValue(style.decorationLook, def.decorationLook) &&
    sameComponentValue(style.variations, def.variations);
}

function showsParagraph(text: TextData, definition: TextDefinition, start: number, end: number) {
  const p = definition.paragraph;
  return text.paragraphSpacing === (p?.paragraph_spacing ?? 0) && text.paragraphIndent === (p?.paragraph_indent ?? 0) &&
    sameComponentValue(text.features, p?.features ?? noFeatures) && commonParagraphList(text, start, end)?.list === (p?.list ?? "none");
}

function applyParagraph(text: TextData, definition: TextDefinition, range?: Range) {
  const p = definition.paragraph;
  const span: Range = range ? paragraphSpan(text, ...range) : [0, text.characters.split("\n").length - 1];
  return Object.freeze({...editParagraphLists(text, span, value => ({...value, list:p?.list ?? "none"})),
    paragraphSpacing:p?.paragraph_spacing ?? 0, paragraphIndent:p?.paragraph_indent ?? 0, features:p?.features ?? noFeatures});
}

function styleText(node: TextNode, definition: TextDefinition | undefined, range?: Range): TextNode {
  const n = scalarCount(node.text.characters), [start, end] = range ?? [0, n];
  const apply = definition ? (s: TextStyle) => takeStyle(s, definition) : unlink;
  let text = restyleRange(node.text, start === end ? 0 : start, start === end ? n : end, apply);
  if (definition) text = applyParagraph(text, definition, range);
  return sameTextData(text, node.text) ? node : fitEditedText({...node, text}, node);
}

export function applyStyleToNode<T extends DocumentNode>(node: T, slot: StyleSlot, style?: SharedStyle, range?: Range): T;
export function applyStyleToNode(node: DocumentNode, slot: StyleSlot, style?: SharedStyle, range?: Range): DocumentNode {
  let result = node;
  if (slot === "text" && (!style || style.type === "text")) {
    if (node.kind === "text") result = styleText(node, style, range);
    if (range) return result;
  } else if (style) {
    if (slot === "fill" && style.type === "paint") {
      if (!samePaints(nodeFills(node), style.paints)) result = node.kind === "page"
        ? Object.freeze({...node, fills:style.paints.length ? style.paints : undefined}) : withRectanglePaints(node, style.paints);
    } else if (slot === "stroke" && style.type === "paint") {
      if (!samePaints(node.strokes ?? noPaints, style.paints)) result = Object.freeze({...node, strokes:style.paints.length ? style.paints : undefined});
    } else if (slot === "effect" && style.type === "effect") {
      if (!sameComponentValue(node.effects ?? [], style.effects)) result = Object.freeze({...node, effects:style.effects.length ? style.effects : undefined});
    } else if (slot === "grid" && style.type === "grid") {
      if (!sameComponentValue(node.grids ?? [], style.grids)) result = Object.freeze({...node, grids:style.grids.length ? style.grids : undefined});
    } else throw new Error("Style does not fit " + slot);
  }
  return withStyleRef(result, slot, style?.id ?? null);
}

/** Update only the runs which carry this ID. Deletion retains every visual value. */
export function propagateStyle(node: DocumentNode, id: string, definition?: SharedStyle): DocumentNode {
  let next = node;
  if (node.kind === "text" && (node.text.style.styleId === id || node.text.runs.some(r => r.style.styleId === id))) {
    const t = node.text;
    const change = (style: TextStyle) => style.styleId !== id ? style :
      definition?.type === "text" ? takeStyle(style, definition) : unlink(style);
    const style = change(t.style);
    const runs = normaliseRuns(t.runs.map(r => Object.freeze({...r, style:change(r.style)})), style, scalarCount(t.characters));
    let text: TextData = Object.freeze({...t, style, runs});
    if (definition?.type === "text") {
      for (const span of textSpans(text)) {
        if (span.style.styleId === id) text = applyParagraph(text, definition, [span.start, span.end]);
      }
    }
    if (!sameTextData(t, text)) next = fitEditedText({...node, text}, node);
  }
  if (node.styles) {
    for (const slot of ["fill", "stroke", "effect", "grid", "text"] as const) {
      if (node.styles[slot] !== id) continue;
      if (!definition) next = withStyleRef(next, slot, null);
      else if (definition.type !== "text" && (slot === definition.type || definition.type === "paint" && (slot === "fill" || slot === "stroke"))) {
        next = applyStyleToNode(next, slot, definition);
      }
    }
  }
  return next;
}

function reconcileText(node: TextNode, resolve: (id: string) => SharedStyle | undefined): TextNode {
  let text = node.text;
  if (node.styles?.text == null && text.style.styleId === undefined && !text.runs.some(r => r.style.styleId !== undefined)) return node;
  const n = scalarCount(text.characters), imported = node.styles?.text != null ? resolve(node.styles.text) : undefined;
  if (imported?.type === "text" && textSpans(text).every(span => span.style.styleId === undefined && showsTypography(span.style, imported.style)) &&
      showsParagraph(text, imported, 0, n)) {
    text = restyleRange(text, 0, n, s => Object.freeze({...s, styleId:imported.id}));
  }
  const check = (s: TextStyle) => {
    if (s.styleId === undefined) return s;
    const def = resolve(s.styleId);
    return def?.type === "text" && showsTypography(s, def.style) ? s : unlink(s);
  };
  const base = check(text.style);
  const runs = text.runs.map(r => Object.freeze({...r, style:check(r.style)}));
  text = Object.freeze({...text, style:base, runs:normaliseRuns(runs, base, n)});
  for (const span of textSpans(text)) {
    const def = span.style.styleId !== undefined ? resolve(span.style.styleId) : undefined;
    if (def?.type === "text" && def.paragraph && !showsParagraph(text, def, span.start, span.end)) {
      text = restyleRange(text, span.start, span.end, unlink);
    }
  }
  const spans = textSpans(text), first = spans[0].style.styleId;
  const id = spans.every(span => span.style.styleId === first) ? first ?? null : null;
  return withStyleRef(sameTextData(node.text,text) ? node : Object.freeze({...node,text}), "text", id);
}

export function reconcileNodeStyles(before: DocumentNode | undefined, node: DocumentNode, resolve: (id: string) => SharedStyle | undefined) {
  let next = node.kind === "text" ? reconcileText(node, resolve) : node;
  if (!before || !node.styles) return next;
  for (const slot of ["fill", "stroke", "effect", "grid"] as const) {
    const id = node.styles[slot];
    if (id === null) continue;
    const def = resolve(id);
    if (!def) continue;
    if (slot === "fill" || slot === "stroke") {
      const current = slot === "fill" ? nodeFills(node) : node.strokes ?? noPaints;
      const prior = slot === "fill" ? nodeFills(before) : before.strokes ?? noPaints;
      if (!samePaints(current, prior) && (def.type !== "paint" || !samePaints(current, def.paints))) next = withStyleRef(next, slot, null);
    } else {
      const key = slot === "effect" ? "effects" : "grids";
      const current = node[key] ?? [];
      if (!sameComponentValue(current, before[key] ?? []) && (def.type !== slot || !sameComponentValue(current, def.type === "effect" ? def.effects : def.grids))) {
        next = withStyleRef(next, slot, null);
      }
    }
  }
  return next;
}

function charIndex(value: unknown) {
  try { return Math.min(1e12, Math.max(0, Math.trunc(parseNumber(value)))); } catch { return undefined; }
}

export function editStyleLinks(doc: Document, selection: readonly string[], params: Record<string, unknown>, detach: boolean, live?: ActiveStyleRange) {
  const ids = requiredTargets(doc, selection, params);
  const key = parseString(params.style), style = detach ? undefined : doc.styles?.find(s => s.id === key || s.name === key);
  if (!detach && !style) throw new Error("No such style");
  const slot = detach ? parseString(params.which) : style?.type === "paint" ? (params.target === "stroke" ? "stroke" : "fill") : style?.type;
  if (slot !== "fill" && slot !== "stroke" && slot !== "effect" && slot !== "grid" && slot !== "text") throw new Error("Unknown style slot");
  const targets = style?.type === "text" ? ids.filter(id => doc.nodes[id].kind === "text") : ids;
  if (!targets.length) throw new Error("A text style goes on text layers");
  const start = charIndex(params.start), end = charIndex(params.end);
  const range: Range | undefined = start !== undefined || end !== undefined ? [start ?? 0, end ?? Number.MAX_SAFE_INTEGER] :
    live && live.start < live.end && ids.length === 1 && live.node.id === ids[0] ? [live.start, live.end] : undefined;
  const draft = new HierarchyDraft(doc);
  for (const id of targets) draft.set(applyStyleToNode(draft.nodes[id], slot, style, slot === "text" ? range : undefined));
  return draft.finish();
}

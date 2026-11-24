import { parseColour } from "./colour-css";
import { owningInstance } from "./component-tree";
import { isFrameLike, type Document, type DocumentNode, type NodeId } from "./document";
import { ancestors, pageForNode, subtreeIds } from "./hierarchy";
import { trimNumber } from "./inspect-text";
import { refreshLayerBindings } from "./layer-variable-bindings";
import { topFrames, topLevelFrame } from "./prototype-commands";
import type { PrototypeAction, PrototypeExpression, PrototypeInteraction } from "./prototype-data";
import { collectionById, collectionNamed, evaluateExpression, findMode, modeById, variableById } from "./prototype-expressions";
import { refreshBoundStyles } from "./style-application";
import { layerModes } from "./variable-modes";
import type { VariableType, VariableValue } from "./variables";
import { boundsOf } from "./viewport";

/** Source: upstream engine/src/proto_runtime (proto_run.rs): what the prototype player does to its own copy of the document. */
type Literal = Extract<VariableValue, { type: "number" | "string" | "boolean" | "color" }>;
export interface PageRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

const numberText = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Native `literal`: a JSON value as a value of a `kind` variable, or undefined when it does not fit. */
export function literal(kind: VariableType, v: unknown): Literal | undefined {
  switch (kind) {
    case "color": { const c = parseColour(v); return c ? { type: "color", value: c } : undefined; }
    case "number": {
      const n = typeof v === "number" ? v : typeof v === "string" && numberText.test(v.trim()) ? Number(v.trim()) : NaN;
      return Number.isFinite(n) ? { type: "number", value: n } : undefined;
    }
    case "boolean":
      if (typeof v === "boolean") return { type: "boolean", value: v };
      if (typeof v === "string") return { type: "boolean", value: v === "true" };
      if (typeof v === "number") return { type: "boolean", value: v !== 0 };
      return undefined;
    case "string":
      if (typeof v === "string") return { type: "string", value: v };
      if (typeof v === "boolean" || typeof v === "number") return { type: "string", value: JSON.stringify(v) };
      return undefined;
  }
}
/** Native `fit`: numbers and booleans become text for a text variable; other mismatches do not fit. */
function fit(kind: VariableType, v: Literal): Literal | undefined {
  if (kind === "string" && (v.type === "number" || v.type === "boolean")) return { type: "string", value: v.type === "number" ? trimNumber(v.value) : String(v.value) };
  return v.type === kind ? v : undefined;
}
/** Bound layers and styles follow the variables (native `apply_bindings` and `style_vars::refresh`). */
function rebind(doc: Document, before?: Document): Document {
  return refreshBoundStyles(refreshLayerBindings(doc, before), before);
}

/** Native `set_variable`: stored id `variable` set to `value`, or to `expr` evaluated where `node` is, in every mode. */
export function setVariable(doc: Document, node: NodeId, variable: string, value: unknown, expr?: PrototypeExpression): Document | undefined {
  const vars = doc.variables;
  const target = vars && variableById(vars, variable);
  if (!vars || !target) return undefined;
  let v: Literal | undefined;
  if (expr) {
    const result = evaluateExpression(expr, vars, layerModes(doc, node));
    v = result && fit(target.resolvedType, result);
  } else v = literal(target.resolvedType, value);
  if (!v) return undefined;
  const values = Object.freeze(Object.fromEntries(Object.keys(target.values).map(k => [k, v])));
  const variables = Object.freeze({ ...vars, variables: Object.freeze(vars.variables.map(x => x.id === target.id ? Object.freeze({ ...x, values }) : x)) });
  return rebind(Object.freeze({ ...doc, variables }), doc);
}

/** Native `set_mode`: a collection and mode by id or name. */
export function setMode(doc: Document, frame: NodeId, collection: string, mode: string): Document | undefined {
  const vars = doc.variables;
  const c = vars && collectionNamed(vars, collection), m = c && findMode(c, mode);
  return c && m ? setModeById(doc, frame, c.id, m.id) : undefined;
}
/** Native `set_mode_by_id`: the page `frame` is on, and its top-level layers that chose another mode of the collection, switch. */
export function setModeById(doc: Document, frame: NodeId, collection: string, mode: string): Document | undefined {
  const vars = doc.variables;
  const c = vars && collectionById(vars, collection), m = c && modeById(c, mode);
  const page = doc.nodes[frame] ? pageForNode(doc, frame) : undefined;
  if (!c || !m || page === undefined) return undefined;
  const pageNode = doc.nodes[page] as DocumentNode & { children: readonly NodeId[] };
  const targets = [...pageNode.children.filter(t => doc.nodes[t]?.variableModes && Object.hasOwn(doc.nodes[t].variableModes!, c.id)), page];
  const nodes: Record<NodeId, DocumentNode> = { ...doc.nodes };
  for (const id of targets) nodes[id] = Object.freeze({ ...nodes[id], variableModes: Object.freeze({ ...nodes[id].variableModes, [c.id]: m.id }) }) as DocumentNode;
  return rebind(Object.freeze({ ...doc, nodes: Object.freeze(nodes) }));
}

/** Native `branch`: the actions of the first block whose condition holds where `node` is (a block without one is the else). */
export function branch(doc: Document, node: NodeId, blocks: readonly { readonly condition?: PrototypeExpression; readonly actions: readonly PrototypeAction[] }[]): readonly PrototypeAction[] {
  const vars = doc.variables, modes = layerModes(doc, node);
  const chosen = blocks.find(b => {
    if (!b.condition) return true;
    const v = vars && evaluateExpression(b.condition, vars, modes);
    return v?.type === "boolean" && v.value === true;
  });
  return chosen?.actions ?? [];
}

/** Native `navigate_target`: the top-level frame holding `dest`; for a section, the frame shown there last, else its first frame. */
export function navigateTarget(doc: Document, dest: NodeId, visited: ReadonlyMap<NodeId, NodeId>): NodeId | undefined {
  const n = doc.nodes[dest];
  if (!n) return undefined;
  if (n.kind !== "section") return topLevelFrame(doc, dest) ?? dest;
  const last = visited.get(dest);
  if (last !== undefined && doc.nodes[last] && ancestors(doc, last).includes(dest)) return last;
  return topFrames(doc, dest)[0];
}
/** Native `remember_sections`: `frame` is the frame shown last in each section around it. */
export function rememberSections(doc: Document, frame: NodeId, visited: Map<NodeId, NodeId>) {
  for (const a of ancestors(doc, frame)) if (doc.nodes[a]?.kind === "section") visited.set(a, frame);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const variantSet = (doc: Document, component: NodeId): NodeId | undefined => {
  const parent = doc.nodes[component]?.parent;
  return parent != null && doc.nodes[parent]?.kind === "componentSet" ? parent : undefined;
};
/** Native `play_interactions`: every instance plays its main's interactions, but for the triggers it has its own for. */
export function playInteractions(doc: Document): Document {
  const changes: Record<NodeId, DocumentNode> = {};
  for (const n of Object.values(doc.nodes)) {
    if (n.kind !== "instance") continue;
    const main = doc.nodes[n.component];
    if (!main) continue;
    const set = variantSet(doc, n.component);
    const variants = set !== undefined ? (doc.nodes[set] as { children: readonly NodeId[] }).children : [n.component];
    const copied = (it: PrototypeInteraction) => variants.some(v => doc.nodes[v]?.interactions?.some(x => same(x, it)));
    const own = (n.interactions ?? []).filter(it => !copied(it));
    const plays = [...own, ...(main.interactions ?? []).filter(it => own.every(o => !same(o.trigger, it.trigger)))];
    if (!same(plays, n.interactions ?? [])) {
      const { interactions: _previous, ...rest } = n;
      changes[n.id] = Object.freeze({ ...rest, ...(plays.length && { interactions: Object.freeze(plays) }) }) as DocumentNode;
    }
  }
  return Object.keys(changes).length ? Object.freeze({ ...doc, nodes: Object.freeze({ ...doc.nodes, ...changes }) }) : doc;
}

/** Native `change_to_target`: the nearest of `node` and the instances around it showing a variant of `dest`'s set, else the innermost instance holding `node`. */
export function changeToTarget(doc: Document, node: NodeId, dest: NodeId): NodeId | undefined {
  const set = variantSet(doc, dest);
  const inSet = (id: NodeId) => { const n = doc.nodes[id]; return n?.kind === "instance" && set !== undefined && variantSet(doc, n.component) === set; };
  return [node, ...ancestors(doc, node)].find(inSet) ?? owningInstance(doc, node)?.id;
}

const intersect = (a: PageRect, b: PageRect): PageRect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
function worldRect(doc: Document, id: NodeId): PageRect | undefined {
  const b = boundsOf(doc, [id]);
  return b && { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}
/** Native `hotspots`: the visible layers with interactions under `root`, bottom-most first, clipped by the clipping frames around them. */
export function hotspots(doc: Document, root: NodeId): [NodeId, PageRect][] {
  const out: [NodeId, PageRect][] = [];
  const clips = new Map<NodeId, PageRect | undefined>();
  for (const id of subtreeIds(doc, root)) {
    const n = doc.nodes[id];
    let parentClip: PageRect | undefined;
    if (id !== root && n.parent != null) {
      if (!clips.has(n.parent)) continue; // the parent is hidden
      parentClip = clips.get(n.parent);
    }
    if ((n as { visible?: boolean }).visible === false) continue;
    const bounds = worldRect(doc, id);
    const clipping = n.kind !== "page" && isFrameLike(n) && (n as { clip?: boolean }).clip === true;
    clips.set(id, clipping && bounds ? (parentClip ? intersect(parentClip, bounds) : bounds) : parentClip);
    if (!n.interactions?.length || !bounds) continue;
    const r = parentClip ? intersect(parentClip, bounds) : bounds;
    if (r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0) out.push([id, r]);
  }
  return out;
}

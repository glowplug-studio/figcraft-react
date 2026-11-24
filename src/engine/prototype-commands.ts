import { LosslessNumber } from "lossless-json";
import { isFrameLike, type Document, type DocumentNode, type NodeId, type PageNode } from "./document";
import { inspectedId, parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { readPrototype, type PrototypeAction, type PrototypeExpression, type PrototypeFlow, type PrototypeInteraction } from "./prototype-data";
import { checkCondition, checkValue, collectionById, collectionNamed, displayExpression, evaluateExpression, expressionType, findMode, parseExpression, variableById, variableNamed } from "./prototype-expressions";
import { layerModes } from "./variable-modes";
import { boundsOf } from "./viewport";
import { parseColour } from "./colour-css";
import { defaultPrototypeBackground } from "./document";
import { customDevice, customSide, defaultPrototypeDevice, deviceModel, devices, knownDevice, parseRotation, settingsJson, type PrototypeDevice } from "./prototype-settings";
import { rustFloat } from "./prototype-expressions";
import { emptyVariables, resolveVariable, type Variable, type VariableValue, type Variables } from "./variables";

/** Source: upstream engine/cmd/proto.rs (interactions and flows). */
export const prototypeSpecs = Object.freeze({
  "proto.interaction.add": { label: "Add interaction", undo: true },
  "proto.interaction.clear": { label: "Remove all interactions", undo: true },
  "proto.interaction.remove": { label: "Remove interaction", undo: true },
  "proto.interaction.set": { label: "Edit interaction", undo: true },
  "proto.flow.add": { label: "Add flow starting point", undo: true },
  "proto.flow.rename": { label: "Rename flow", undo: true },
  "proto.flow.remove": { label: "Remove flow", undo: true },
  "proto.evaluate": { label: "Evaluate prototype expression", undo: false },
  "proto.settings": { label: "Prototype settings", undo: true },
  "proto.present": { label: "Present", undo: false },
  "proto.preview": { label: "Open prototype preview", undo: false },
  "proto.closePreview": { label: "Close prototype preview", undo: false },
  "proto.presentOptions": { label: "Presentation options", undo: false },
  "proto.linkNotice": { label: "Notice before leaving for a link", undo: false },
  "proto.action.add": { label: "Add prototype action", undo: true },
  "proto.action.set": { label: "Edit prototype action", undo: true },
  "proto.action.remove": { label: "Remove prototype action", undo: true },
  "proto.action.move": { label: "Reorder prototype action", undo: true },
  "proto.conditional.addBlock": { label: "Add else if / else", undo: true },
  "proto.conditional.setCondition": { label: "Edit condition", undo: true },
  "proto.conditional.removeBlock": { label: "Remove if / else if / else", undo: true },
});
export type PrototypeCommand = keyof typeof prototypeSpecs;
/** What a player command asks of the interface (native `request_ui` and preferences). */
export interface PlayerRequest {
  readonly player?: { readonly mode: "present" | "preview"; readonly start: NodeId } | null;
  readonly presentOptions?: Partial<PresentOptions>;
  readonly linkNoticeSkipped?: boolean;
}
/** Native `proto.presentOptions`: how the presenter shows a prototype, kept for later presentations. */
export interface PresentOptions { readonly scale: typeof presentScales[number]; readonly deviceFrame: boolean; readonly hotspotHints: boolean; readonly inspect: boolean; readonly hideUi: boolean }
export const presentScales = ["fit", "fitWidth", "fill", "actual"] as const;
export interface PrototypeExecution { readonly document: Document; readonly result: Record<string, unknown>; readonly request?: PlayerRequest }

/** Native `MAX_DELAY_MS`: the longest a mouse trigger waits. */
export const maxDelayMs = 600_000;
const actionTypes = ["navigate","back","scrollTo","openOverlay","swapOverlay","closeOverlay","openUrl","changeTo","setVariable","setVariableMode","conditional"] as const;
const triggerTypes = ["onClick","onHover","onPress","onDrag","mouseEnter","mouseLeave","mouseDown","mouseUp","afterDelay","keyPress"] as const;
const transitionTypes = ["instant","dissolve","smartAnimate","moveIn","moveOut","push","slideIn","slideOut"] as const;
const mouseTriggers = new Set(["mouseEnter","mouseLeave","mouseDown","mouseUp"]);

const bad = (command: string, message: string) => new Error("invalid parameters for `" + command + "`: " + message);
/** The parameters each command's native doc names (`id` and `ids` are always taken). */
const takes: Record<PrototypeCommand, readonly string[]> = {
  "proto.interaction.add": ["id","trigger","action","actions","dest","transition","durationMs","duration_ms","easing","delayMs","delay_ms"],
  "proto.interaction.clear": ["ids"],
  "proto.interaction.remove": ["id","index"],
  "proto.interaction.set": ["id","index","interaction","trigger","action","actions","transition","durationMs","duration_ms","easing","delayMs","delay_ms"],
  "proto.flow.add": ["start","name"],
  "proto.flow.rename": ["start","name","description"],
  "proto.flow.remove": ["start"],
  "proto.evaluate": ["expression","expr","id"],
  "proto.settings": ["device","background","rotation","color","width","height","responsive"],
  "proto.present": ["start"],
  "proto.preview": ["start"],
  "proto.closePreview": [],
  "proto.presentOptions": ["scale","deviceFrame","hotspotHints","inspect","hideUi"],
  "proto.linkNotice": ["show"],
  "proto.action.add": ["id","index","path","action"],
  "proto.action.set": ["id","index","path","action"],
  "proto.action.remove": ["id","index","path"],
  "proto.action.move": ["id","index","path","to"],
  "proto.conditional.addBlock": ["id","index","path","else","expression","condition"],
  "proto.conditional.setCondition": ["id","index","path","block","expression","condition"],
  "proto.conditional.removeBlock": ["id","index","path","block"],
};
/** Native `refuse_unknown_params`: a misspelt name is refused rather than ignored. */
function refuseUnknown(command: PrototypeCommand, p: Record<string, unknown>) {
  const names = takes[command];
  const unknown = Object.keys(p).filter(k => k !== "id" && k !== "ids" && !names.includes(k)).map(k => "`" + k + "`");
  if (unknown.length) throw bad(command, `unknown parameter${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} (it takes ${names.length ? names.join(", ") : "none"})`);
}
const shown = (value: unknown) => typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);

// Command values arrive as plain JSON; the document readers take node IDs as lossless numbers, as files hold them.
function lossless(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? new LosslessNumber(String(value)) : value;
  if (Array.isArray(value)) return value.map(lossless);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, lossless(v)]));
  return value;
}
function variantCheck(command: string, key: string, value: unknown, types: readonly string[]) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type = (value as Record<string, unknown>).type;
    if (typeof type === "string" && !types.includes(type))
      throw bad(command, "`" + key + "`: unknown variant `" + type + "`, expected one of " + types.map(t => "`" + t + "`").join(", "));
  }
}
/** Native `parse`: a present key is read whole or the command fails naming it. */
function parse<T>(command: string, p: Record<string, unknown>, key: string, read: (raw: unknown) => T): T | undefined {
  if (!Object.hasOwn(p, key) || p[key] === undefined) return undefined;
  const value = p[key];
  if (key === "action") variantCheck(command, key, value, actionTypes);
  if (key === "actions" && Array.isArray(value)) value.forEach(v => variantCheck(command, key, v, actionTypes));
  if (key === "trigger") variantCheck(command, key, value, triggerTypes);
  if (key === "transition") variantCheck(command, key, value, transitionTypes);
  try { return read(lossless(value)); }
  catch (error) { throw bad(command, "`" + key + "`: " + (error instanceof Error ? error.message : String(error))); }
}
function lenientNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  try { return parseNumber(value); } catch { return undefined; }
}
/** Native `duration`: durationMs or duration_ms, clamped to a minute and truncated. */
function duration(p: Record<string, unknown>) {
  const d = lenientNumber(p.durationMs) ?? lenientNumber(p.duration_ms);
  return d === undefined ? undefined : Math.trunc(Math.min(Math.max(d, 0), 60_000));
}
/** Native `delay`: milliseconds, 0 or more, capped and rounded. */
function delay(command: string, p: Record<string, unknown>) {
  const raw = p.delayMs ?? p.delay_ms;
  if (raw === undefined || raw === null) return undefined;
  const d = lenientNumber(raw);
  if (d === undefined || d < 0) throw bad(command, "delayMs: milliseconds, 0 or more");
  return Math.round(Math.min(d, maxDelayMs));
}
function walk(actions: readonly PrototypeAction[], visit: (a: PrototypeAction) => void, depth = 0) {
  for (const a of actions) {
    visit(a);
    if (a.type === "conditional" && depth < 16) for (const b of a.blocks) walk(b.actions, visit, depth + 1);
  }
}
function mapActions(actions: readonly PrototypeAction[], f: (a: PrototypeAction) => PrototypeAction, depth = 0): PrototypeAction[] {
  return actions.map(a => {
    const next = f(a);
    return next.type === "conditional" && depth < 16 ? { ...next, blocks: next.blocks.map(b => ({ ...b, actions: mapActions(b.actions, f, depth + 1) })) } : next;
  });
}
/** Native `settle`: a delay only on mouse enter, leave, down and up; a manual overlay's offset only, finite and clamped. */
function settle(it: PrototypeInteraction): PrototypeInteraction {
  const { delay_ms, ...rest } = it;
  const wait = mouseTriggers.has(it.trigger.type) ? Math.min(delay_ms ?? 0, maxDelayMs) : 0;
  const actions = mapActions(it.actions, a => {
    if (a.type !== "openOverlay") return a;
    const { offset, ...plain } = a;
    const keep = offset && a.position === "manual" && offset.every(Number.isFinite);
    return keep ? { ...plain, offset: [Math.min(Math.max(offset[0], -1e5), 1e5), Math.min(Math.max(offset[1], -1e5), 1e5)] as const } : plain;
  });
  return Object.freeze({ ...rest, actions: Object.freeze(actions), ...(wait && { delay_ms: wait }) });
}
function checkDests(command: string, document: Document, actions: readonly PrototypeAction[]) {
  walk(actions, a => {
    if ("dest" in a && !Object.hasOwn(document.nodes, a.dest)) throw bad(command, "destination " + a.dest + " doesn't exist");
  });
}
/** Native `req_targets`: ids, else id, else the selection; every one must exist. */
function targets(command: string, document: Document, selection: readonly NodeId[], p: Record<string, unknown>): NodeId[] {
  let raw: unknown[];
  if (Array.isArray(p.ids)) {
    const wrong = p.ids.find(v => parseNodeId(v) === undefined);
    if (wrong !== undefined) throw bad(command, "`ids`: every entry must be a node id (got " + shown(wrong) + ")");
    raw = p.ids;
  } else if (p.ids === undefined || p.ids === null) {
    if (p.id !== undefined && p.id !== null && parseNodeId(p.id) === undefined) throw bad(command, "`id` must be a node id (got " + shown(p.id) + ")");
    raw = p.id !== undefined && p.id !== null ? [p.id] : [...selection];
  } else throw bad(command, "`ids` must be an array (got " + shown(p.ids) + ")");
  if (!raw.length) throw new Error("command `" + command + "` is not available right now: nothing is selected (pass `ids`)");
  const ids = raw.map(v => parseNodeId(v)!);
  for (const id of ids) if (!Object.hasOwn(document.nodes, id)) throw new Error("no such node " + id);
  return ids;
}
function index(command: string, p: Record<string, unknown>, key = "index") {
  if (p[key] === undefined || p[key] === null) throw bad(command, "`" + key + "` required");
  const k = lenientNumber(p[key]);
  if (k === undefined || !(k >= 0 && k < 1e9) || !Number.isInteger(k)) throw bad(command, "`" + key + "` must be a whole number in 0..1e9");
  return k;
}
function withInteractions(node: DocumentNode, list: readonly PrototypeInteraction[]): DocumentNode {
  const { interactions: _previous, ...rest } = node;
  return Object.freeze({ ...rest, ...(list.length && { interactions: Object.freeze([...list]) }) }) as DocumentNode;
}
/** Native `Document::top_level_frame`: the frame-like node right below the page, past any sections. */
export function topLevelFrame(document: Document, id: NodeId): NodeId | undefined {
  const chain: NodeId[] = [];
  for (let at: NodeId | null | undefined = id, guard = 0; at != null && guard < 10_000; guard++) {
    const node: DocumentNode | undefined = document.nodes[at];
    if (!node) return undefined;
    if (node.kind === "page") break;
    chain.push(at);
    at = node.parent;
  }
  const top = [...chain].reverse().find(c => document.nodes[c]?.kind !== "section");
  const node = top === undefined ? undefined : document.nodes[top];
  return node && node.kind !== "page" && isFrameLike(node) ? top : undefined;
}

/** Native `canonical_expr`: variables, collections and modes an expression names by name, stored by id. */
export function canonicalExpression(vars: Variables, e: PrototypeExpression, depth = 0): PrototypeExpression {
  if ("value" in e) {
    if (e.value.type !== "alias") return e;
    const v = variableNamed(vars, e.value.value);
    return v ? { value: { type: "alias", value: v.id } } : e;
  }
  if ("mode" in e) {
    const c = collectionNamed(vars, e.mode.collection);
    return c ? { mode: { collection: c.id } } : e;
  }
  if ("inMode" in e) {
    const v = variableNamed(vars, e.inMode.variable);
    if (!v) return e;
    const c = collectionById(vars, v.collection), m = c && findMode(c, e.inMode.mode);
    return { inMode: { variable: v.id, mode: m ? m.id : e.inMode.mode } };
  }
  return depth < 32 ? { op: { op: e.op.op, args: e.op.args.map(a => canonicalExpression(vars, a, depth + 1)) } } : e;
}
const maxActionDepth = 16;
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function canonicalInputs(command: string, vars: Variables, v: unknown, depth: number): unknown {
  if (depth > 4 * maxActionDepth) throw bad(command, "actions are nested too deeply");
  if (Array.isArray(v)) return v.map(x => canonicalInputs(command, vars, x, depth + 1));
  if (!isObject(v)) return v;
  const o: Json = { ...v };
  // Only command input accepts names: action targets settle before text expressions are read.
  if (o.type === "setVariable" && typeof o.variable === "string") {
    const found = variableNamed(vars, o.variable);
    if (found) o.variable = found.id;
  } else if (o.type === "setVariableMode" && typeof o.collection === "string") {
    const c = collectionNamed(vars, o.collection);
    if (c) {
      const m = typeof o.mode === "string" ? findMode(c, o.mode) : undefined;
      if (m) o.mode = m.id;
      o.collection = c.id;
    }
  }
  if (typeof o.expression !== "string") for (const key of ["expr", "condition"]) {
    if (o[key] === undefined || o[key] === null) continue;
    let e: PrototypeExpression;
    try { e = readPrototype.expression(lossless(o[key])); } catch (error) { throw bad(command, key + ": " + message(error)); }
    o[key] = canonicalExpression(vars, e);
  }
  for (const key of ["action", "actions", "interaction", "blocks"]) if (o[key] !== undefined) o[key] = canonicalInputs(command, vars, o[key], depth + 1);
  return o;
}
function resolveExpressions(command: string, vars: Variables, v: unknown, depth: number): unknown {
  if (depth > 4 * maxActionDepth) throw bad(command, "actions are nested too deeply");
  if (Array.isArray(v)) return v.map(x => resolveExpressions(command, vars, x, depth + 1));
  if (!isObject(v)) return v;
  let o: Json = { ...v };
  if (typeof o.expression === "string") {
    const text = o.expression;
    let e: PrototypeExpression;
    try { e = parseExpression(text, vars); } catch (error) { throw bad(command, "`" + text + "`: " + message(error)); }
    if (o.type === "setVariable") {
      const target = typeof o.variable === "string" ? variableById(vars, o.variable) : undefined;
      if (!target) throw bad(command, "setVariable: no such `variable`");
      try { checkValue(e, vars, target.resolvedType); } catch (error) { throw bad(command, message(error)); }
      o.expr = e;
      if (!Object.hasOwn(o, "value")) o.value = null;
    } else {
      try { checkCondition(e, vars); } catch (error) { throw bad(command, message(error)); }
      o.condition = e;
    }
    const { expression: _text, ...rest } = o;
    o = rest;
  }
  for (const [key, x] of Object.entries(o)) if (key !== "expr" && key !== "condition") o[key] = resolveExpressions(command, vars, x, depth + 1);
  return o;
}
/** Native `with_expressions`: names stored as ids, and every `expression` text read and checked. */
function withExpressions(command: string, vars: Variables, p: Record<string, unknown>): Record<string, unknown> {
  return resolveExpressions(command, vars, canonicalInputs(command, vars, p, 0), 0) as Record<string, unknown>;
}

/** Native `MAX_ACTIONS` and `MAX_BLOCKS`. */
export const maxActions = 200, maxBlocks = 50;
type Block = { readonly condition?: PrototypeExpression; readonly actions: readonly PrototypeAction[] };
const noList = (command: string) => bad(command, "no action there: `path` must lead through conditional actions and their blocks");
/** Native `path_param`: whole numbers, an odd count, no deeper than actions nest. */
function pathParam(command: string, p: Record<string, unknown>, key: string): number[] | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw bad(command, "`" + key + "` must be a list of indexes");
  if (v.length % 2 === 0 || v.length > 2 * maxActionDepth + 1) throw bad(command, "`" + key + "` must be [action] or [action, block, action, …]");
  return v.map(x => {
    const n = lenientNumber(x);
    if (n === undefined || !(n >= 0 && n < 1e6) || !Number.isInteger(n)) throw bad(command, "`" + key + "` holds whole numbers ≥ 0");
    return n;
  });
}
function requiredPath(command: string, p: Record<string, unknown>) {
  const path = pathParam(command, p, "path");
  if (!path) throw bad(command, "`path` required");
  return path;
}
/** The list `path` points into, rebuilt by `edit` (returning the new list), or undefined when the path leads nowhere. */
function editList(actions: readonly PrototypeAction[], path: readonly number[], edit: (list: PrototypeAction[], at: number) => PrototypeAction[]): PrototypeAction[] | undefined {
  if (path.length === 1) return edit([...actions], path[0]);
  const [a, b, ...rest] = path;
  const target = actions[a];
  if (target?.type !== "conditional") return undefined;
  const block = target.blocks[b];
  if (!block) return undefined;
  const inner = editList(block.actions, rest, edit);
  if (!inner) return undefined;
  const blocks = target.blocks.map((x, i) => i === b ? { ...x, actions: inner } : x);
  return actions.map((x, i) => i === a ? { ...target, blocks } : x);
}
/** Native `start_value` and `default_condition`: the first boolean variable (else the first) equal to its value. */
export function startValue(vars: Variables, v: Variable): VariableValue {
  const value = resolveVariable(vars, v.id);
  if (value && value.type === v.resolvedType) return value;
  switch (v.resolvedType) {
    case "number": return { type: "number", value: 0 };
    case "string": return { type: "string", value: "" };
    case "boolean": return { type: "boolean", value: true };
    case "color": return { type: "color", value: { r: 0, g: 0, b: 0, a: 1 } };
  }
}
export function defaultCondition(vars: Variables): PrototypeExpression {
  const v = vars.variables.find(x => x.resolvedType === "boolean") ?? vars.variables[0];
  return v ? { op: { op: "equals", args: [{ value: { type: "alias", value: v.id } }, { value: startValue(vars, v) }] } } : { value: { type: "boolean", value: true } };
}
/** Native `check_action`: a set variable names a variable its expression fits; conditions give true or false. */
function checkAction(command: string, vars: Variables, a: PrototypeAction) {
  walk([a], x => {
    if (x.type === "setVariable") {
      const v = variableById(vars, x.variable);
      if (!v) throw bad(command, "no variable `" + x.variable + "`");
      if (x.expr) try { checkValue(x.expr, vars, v.resolvedType); } catch (error) { throw bad(command, message(error)); }
    } else if (x.type === "conditional") {
      if (x.blocks.length > maxBlocks) throw bad(command, `at most ${maxBlocks} blocks`);
      for (const b of x.blocks) if (b.condition) try { checkCondition(b.condition, vars); } catch (error) { throw bad(command, message(error)); }
    }
  });
}
/** Native `condition_param`: `expression` text or `condition` JSON, checked. */
function conditionParam(command: string, vars: Variables, p: Record<string, unknown>): PrototypeExpression | undefined {
  let e: PrototypeExpression;
  if (typeof p.expression === "string") {
    const text = p.expression;
    try { e = parseExpression(text, vars); } catch (error) { throw bad(command, "`" + text + "`: " + message(error)); }
  } else if (p.condition !== undefined) {
    try { e = canonicalExpression(vars, readPrototype.expression(lossless(p.condition))); } catch (error) { throw bad(command, "`condition`: " + message(error)); }
  } else return undefined;
  try { checkCondition(e, vars); } catch (error) { throw bad(command, message(error)); }
  return e;
}

export function executePrototype(command: PrototypeCommand, document: Document, selection: readonly NodeId[], p: Record<string, unknown>): PrototypeExecution {
  const setNodes = (changes: Record<NodeId, DocumentNode>): Document =>
    Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, ...changes }) });
  refuseUnknown(command, p);
  const vars = document.variables ?? emptyVariables;
  if (command === "proto.present" || command === "proto.preview") {
    const start = playerStart(command, document, selection, p);
    return { document, result: { start: inspectedId(start) }, request: { player: { mode: command === "proto.present" ? "present" : "preview", start } } };
  }
  if (command === "proto.closePreview") return { document, result: { ok: true }, request: { player: null } };
  if (command === "proto.presentOptions") {
    const options: { -readonly [K in keyof PresentOptions]?: PresentOptions[K] } = {};
    if (p.scale !== undefined && p.scale !== null) {
      if (typeof p.scale !== "string" || !(presentScales as readonly string[]).includes(p.scale)) throw bad(command, "scale: fit|fitWidth|fill|actual");
      options.scale = p.scale as PresentOptions["scale"];
    }
    for (const key of ["deviceFrame", "hotspotHints", "inspect", "hideUi"] as const) {
      if (p[key] === undefined || p[key] === null) continue;
      if (typeof p[key] !== "boolean") throw bad(command, key + ": true|false");
      options[key] = p[key] as boolean;
    }
    if (!Object.keys(options).length) throw bad(command, "nothing to set: scale, deviceFrame, hotspotHints, inspect or hideUi");
    return { document, result: { ok: true }, request: { presentOptions: options } };
  }
  if (command === "proto.linkNotice") {
    const show = p.show === undefined ? true : parseBoolean(p.show) ?? true;
    return { document, result: { shown: show }, request: { linkNoticeSkipped: !show } };
  }
  if (command === "proto.evaluate") {
    let e: PrototypeExpression;
    if (typeof p.expression === "string") {
      const text = p.expression;
      try { e = parseExpression(text, vars); } catch (error) { throw bad(command, "`" + text + "`: " + message(error)); }
    } else if (p.expr !== undefined) {
      try { e = canonicalExpression(vars, readPrototype.expression(lossless(p.expr))); } catch (error) { throw bad(command, "`expr`: " + message(error)); }
    } else throw bad(command, "`expression` (text) or `expr` (expression JSON) required");
    let type;
    try { type = expressionType(e, vars); } catch (error) { throw bad(command, message(error)); }
    const at = parseNodeId(p.id);
    if (at !== undefined && !Object.hasOwn(document.nodes, at)) throw bad(command, "no layer " + at);
    const v = evaluateExpression(e, vars, at === undefined ? {} : layerModes(document, at));
    if (!v) throw bad(command, "it gives no value here (a division by zero, or a number too large)");
    return { document, result: { value: v, type, text: displayExpression(e, vars) } };
  }
  if (command === "proto.settings") return prototypeSettings(document, p);
  if (command.startsWith("proto.action.") || command.startsWith("proto.conditional.")) return editActions(command, document, selection, vars, p);
  if (command === "proto.interaction.add" || command === "proto.interaction.set") p = withExpressions(command, vars, p);
  if (command === "proto.interaction.add") {
    const destId = parseNodeId(p.dest);
    let it: PrototypeInteraction;
    if (destId !== undefined && p.action === undefined) {
      it = { trigger: parse(command, p, "trigger", readPrototype.trigger) ?? { type: "onClick" }, actions: [{ type: "navigate", dest: destId }],
        transition: parse(command, p, "transition", readPrototype.transition) ?? { type: "instant" }, duration_ms: duration(p) ?? 300,
        easing: parse(command, p, "easing", readPrototype.easing) ?? "easeOut" };
    } else {
      const trigger = parse(command, p, "trigger", readPrototype.trigger) ?? { type: "onClick" as const };
      const many = parse(command, p, "actions", readPrototype.actions);
      const actions = many?.length ? many : [parse(command, p, "action", readPrototype.action) ?? (() => { throw bad(command, "`action` required"); })()];
      const transition = parse(command, p, "transition", readPrototype.transition) ?? { type: "instant" as const };
      const easing = parse(command, p, "easing", readPrototype.easing) ?? "easeOut";
      it = { trigger, actions, transition, duration_ms: duration(p) ?? 300, easing };
    }
    it = settle({ ...it, delay_ms: delay(command, p) ?? 0 });
    checkDests(command, document, it.actions);
    let last = 0;
    const changes: Record<NodeId, DocumentNode> = {};
    for (const id of targets(command, document, selection, p)) {
      const node = changes[id] ?? document.nodes[id];
      const list = [...(node.interactions ?? []), it];
      changes[id] = withInteractions(node, list);
      last = list.length - 1;
    }
    return { document: setNodes(changes), result: { index: last } };
  }
  if (command === "proto.interaction.clear") {
    const changes: Record<NodeId, DocumentNode> = {};
    for (const id of targets(command, document, selection, p)) if (document.nodes[id].interactions?.length) changes[id] = withInteractions(document.nodes[id], []);
    return { document: Object.keys(changes).length ? setNodes(changes) : document, result: { ok: true } };
  }
  if (command === "proto.interaction.remove") {
    const k = index(command, p);
    const changes: Record<NodeId, DocumentNode> = {};
    for (const id of targets(command, document, selection, p)) {
      const node = changes[id] ?? document.nodes[id], list = node.interactions ?? [];
      if (k < list.length) changes[id] = withInteractions(node, list.filter((_, i) => i !== k));
    }
    if (!Object.keys(changes).length) throw bad(command, "no interaction " + k);
    return { document: setNodes(changes), result: { ok: true } };
  }
  if (command === "proto.interaction.set") {
    const k = index(command, p);
    const whole = parse(command, p, "interaction", readPrototype.interaction);
    const trigger = parse(command, p, "trigger", readPrototype.trigger);
    const action = parse(command, p, "action", readPrototype.action);
    const actions = parse(command, p, "actions", readPrototype.actions);
    const transition = parse(command, p, "transition", readPrototype.transition);
    const easing = parse(command, p, "easing", readPrototype.easing);
    const dur = duration(p), wait = delay(command, p);
    const changes: Record<NodeId, DocumentNode> = {};
    for (const id of targets(command, document, selection, p)) {
      const node = changes[id] ?? document.nodes[id], list = node.interactions ?? [];
      const current = list[k];
      if (!current) continue;
      let it: PrototypeInteraction = whole ?? current;
      if (trigger) it = { ...it, trigger };
      if (actions) it = { ...it, actions };
      if (action) it = { ...it, actions: it.actions.length ? [action, ...it.actions.slice(1)] : [action] };
      if (transition) it = { ...it, transition };
      if (easing) it = { ...it, easing };
      if (dur !== undefined) it = { ...it, duration_ms: dur };
      if (wait !== undefined) it = { ...it, delay_ms: wait };
      it = settle(it);
      if (!it.actions.length) throw bad(command, "an interaction needs an action");
      checkDests(command, document, it.actions);
      changes[id] = withInteractions(node, list.map((x, i) => i === k ? it : x));
    }
    if (!Object.keys(changes).length) throw bad(command, "no interaction " + k);
    return { document: setNodes(changes), result: { ok: true } };
  }
  // Flows belong to the current page.
  const page = document.nodes[document.currentPage] as PageNode;
  const flows = page.flows ?? [];
  const withFlows = (list: readonly PrototypeFlow[]) => {
    const { flows: _previous, ...rest } = page;
    return setNodes({ [page.id]: Object.freeze({ ...rest, ...(list.length && { flows: Object.freeze([...list]) }) }) as PageNode });
  };
  if (command === "proto.flow.add") {
    const start = parseNodeId(p.start) ?? selection[0];
    if (start === undefined) throw bad(command, "select a top-level frame");
    if (topLevelFrame(document, start) !== start) throw bad(command, "a flow starts at a top-level frame");
    const existing = flows.find(f => f.start === start);
    if (existing) return { document, result: { name: existing.name, start: inspectedId(start) } };
    let name = typeof p.name === "string" && p.name.trim() ? p.name : "";
    if (!name) {
      let k = flows.length + 1;
      while (flows.some(f => f.name === `Flow ${k}`)) k++;
      name = `Flow ${k}`;
    }
    return { document: withFlows([...flows, { name, start, description: "" }]), result: { name, start: inspectedId(start) } };
  }
  if (command === "proto.flow.rename") {
    const start = parseNodeId(p.start);
    if (start === undefined) throw bad(command, "`start` required");
    const name = typeof p.name === "string" ? p.name.trim() : undefined;
    if (name === "") throw bad(command, "`name` can't be empty");
    const description = typeof p.description === "string" ? p.description : undefined;
    const at = flows.findIndex(f => f.start === start);
    if (at < 0) throw bad(command, "no flow starts at that frame");
    const next = { ...flows[at], ...(name !== undefined && { name }), ...(description !== undefined && { description }) };
    return { document: withFlows(flows.map((f, i) => i === at ? next : f)), result: { ok: true } };
  }
  const start = parseNodeId(p.start);
  if (start === undefined) throw bad(command, "`start` required");
  const kept = flows.filter(f => f.start !== start);
  return { document: kept.length === flows.length ? document : withFlows(kept), result: { ok: true } };
}

/** Native cmd/proto_actions.rs: one action, or a conditional's blocks, edited by `path` in interaction `index` of each target. */
function editActions(command: PrototypeCommand, document: Document, selection: readonly NodeId[], vars: Variables, p: Record<string, unknown>): PrototypeExecution {
  const actionParam = () => {
    const q = withExpressions(command, vars, p);
    const a = parse(command, q, "action", readPrototype.action);
    if (!a) throw bad(command, "`action` required");
    checkAction(command, vars, a);
    checkDests(command, document, [a]);
    return a;
  };
  let edit: (actions: readonly PrototypeAction[]) => { actions: PrototypeAction[]; result: Record<string, unknown> };
  if (command === "proto.action.add") {
    const path = pathParam(command, p, "path"), action = actionParam();
    edit = actions => {
      const at = path ?? [actions.length];
      const next = editList(actions, at, (list, i) => {
        if (i > list.length) throw bad(command, `index ${i} is past the end (${list.length} actions)`);
        if (list.length >= maxActions) throw bad(command, `at most ${maxActions} actions in a list`);
        list.splice(i, 0, action);
        return list;
      });
      if (!next) throw noList(command);
      return { actions: next, result: { path: at } };
    };
  } else if (command === "proto.action.set") {
    const path = requiredPath(command, p), action = actionParam();
    edit = actions => {
      const next = editList(actions, path, (list, i) => { if (i >= list.length) throw noList(command); list[i] = action; return list; });
      if (!next) throw noList(command);
      return { actions: next, result: { path } };
    };
  } else if (command === "proto.action.remove") {
    const path = requiredPath(command, p);
    edit = actions => {
      const next = editList(actions, path, (list, i) => { if (i >= list.length) throw noList(command); list.splice(i, 1); return list; });
      if (!next) throw noList(command);
      return { actions: next, result: { ok: true } };
    };
  } else if (command === "proto.action.move") {
    const path = requiredPath(command, p), to = index(command, p, "to");
    edit = actions => {
      const next = editList(actions, path, (list, i) => {
        if (i >= list.length || to >= list.length) throw bad(command, `the list has ${list.length} actions`);
        const [a] = list.splice(i, 1);
        list.splice(to, 0, a);
        return list;
      });
      if (!next) throw noList(command);
      return { actions: next, result: { path: [...path.slice(0, -1), to] } };
    };
  } else {
    const path = requiredPath(command, p);
    const blocks = (actions: readonly PrototypeAction[], change: (blocks: Block[]) => Block[]) => editList(actions, path, (list, i) => {
      const target = list[i];
      if (!target) throw noList(command);
      if (target.type !== "conditional") throw bad(command, "that action isn't a conditional");
      list[i] = { ...target, blocks: change([...target.blocks]) };
      return list;
    });
    if (command === "proto.conditional.addBlock") {
      const cond = conditionParam(command, vars, p);
      let isElse = false;
      if (p.else !== undefined) {
        const b = parseBoolean(p.else);
        if (b === undefined) throw bad(command, "`else` must be true or false");
        isElse = b;
      }
      if (isElse && cond) throw bad(command, "an else block has no condition");
      const fallback = defaultCondition(vars);
      edit = actions => {
        let at = 0;
        const next = blocks(actions, list => {
          if (list.length >= maxBlocks) throw bad(command, `at most ${maxBlocks} blocks`);
          const hasElse = list.length > 0 && !list[list.length - 1].condition;
          if (isElse && hasElse) throw bad(command, "it already has an else");
          at = !isElse && hasElse ? list.length - 1 : list.length;
          list.splice(at, 0, isElse ? { actions: [] } : { condition: cond ?? fallback, actions: [] });
          return list;
        });
        if (!next) throw noList(command);
        return { actions: next, result: { block: at } };
      };
    } else if (command === "proto.conditional.setCondition") {
      const block = index(command, p, "block");
      const cond = conditionParam(command, vars, p);
      if (!cond) throw bad(command, "`expression` or `condition` required");
      edit = actions => {
        const next = blocks(actions, list => {
          if (!list[block]) throw bad(command, `no block ${block}`);
          list[block] = { ...list[block], condition: cond };
          return list;
        });
        if (!next) throw noList(command);
        return { actions: next, result: { ok: true } };
      };
    } else {
      const block = index(command, p, "block");
      edit = actions => {
        let gone = false;
        let next = blocks(actions, list => {
          if (block >= list.length) throw bad(command, `no block ${block}`);
          list.splice(block, 1);
          // Without an "if" first there's nothing to decide: the conditional goes.
          gone = !list[0]?.condition;
          return list;
        });
        if (!next) throw noList(command);
        if (gone) next = editList(next, path, (list, i) => { list.splice(i, 1); return list; }) ?? next;
        return { actions: next, result: { removedAction: gone } };
      };
    }
  }
  // Native `edit`: interaction `index` of each target; all or nothing.
  const k = index(command, p);
  let out: Record<string, unknown> | undefined;
  const changes: Record<NodeId, DocumentNode> = {};
  for (const id of targets(command, document, selection, p)) {
    const node = changes[id] ?? document.nodes[id], list = node.interactions ?? [];
    const it = list[k];
    if (!it) continue;
    const r = edit(it.actions);
    if (!r.actions.length) throw bad(command, "an interaction needs an action: remove the interaction instead");
    changes[id] = withInteractions(node, list.map((x, i) => i === k ? { ...x, actions: Object.freeze(r.actions) } : x));
    out = r.result;
  }
  if (!out) throw bad(command, "no interaction " + k);
  return { document: Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, ...changes }) }), result: out };
}

const sameDevice = (a: PrototypeDevice, b: PrototypeDevice) =>
  a.device === b.device && a.rotation === b.rotation && a.color === b.color && a.customSize[0] === b.customSize[0] && a.customSize[1] === b.customSize[1] && a.responsive === b.responsive;
/** Native `proto.settings`: everything checked before anything changes; answers the settings after the call. */
function prototypeSettings(document: Document, p: Record<string, unknown>): PrototypeExecution {
  const command = "proto.settings";
  const page = document.nodes[document.currentPage] as PageNode;
  const given = (key: string) => p[key] !== undefined && p[key] !== null;
  const background = given("background") ? parseColour(p.background) : undefined;
  let device: string | undefined;
  if (given("device")) {
    device = typeof p.device === "string" ? knownDevice(p.device) : undefined;
    if (!device) {
      const shownValue = Array.from(JSON.stringify(p.device) ?? String(p.device)).slice(0, 60).join("");
      throw bad(command, `unknown device ${shownValue}: device is one of ${["None", customDevice, ...devices.map(d => d.name)].join("|")}`);
    }
  }
  let rotation: PrototypeDevice["rotation"] | undefined;
  if (given("rotation")) {
    const v = p.rotation;
    rotation = typeof v === "string" ? parseRotation(v) : typeof v === "number" ? parseRotation(rustFloat(v)) : undefined;
    if (!rotation) throw bad(command, "rotation: portrait|landscape");
  }
  const side = (key: string) => {
    if (!given(key)) return undefined;
    const v = typeof p[key] === "number" ? customSide(p[key] as number) : undefined;
    if (v === undefined) throw bad(command, key + ": 1–10000 points");
    return v;
  };
  const w = side("width"), h = side("height");
  let responsive: boolean | undefined;
  if (given("responsive")) {
    if (typeof p.responsive !== "boolean") throw bad(command, "responsive: true|false");
    responsive = p.responsive;
  }
  let colour: string | undefined;
  if (given("color")) {
    if (typeof p.color !== "string") throw bad(command, "color: one of the device's colour names");
    colour = p.color.trim();
  }
  const current = page.prototypeDevice ?? defaultPrototypeDevice;
  let next: PrototypeDevice = { ...current };
  if (device) next = { ...next, device };
  if (rotation) next = { ...next, rotation };
  // A width or height is the custom size's: it picks "Custom size".
  if (w !== undefined || h !== undefined) next = { ...next, customSize: [w ?? next.customSize[0], h ?? next.customSize[1]], device: customDevice };
  if (responsive !== undefined) next = { ...next, responsive };
  const colours = deviceModel(next)?.colors ?? [];
  if (colour === "") next = { ...next, color: "" };
  else if (colour !== undefined) {
    const found = colours.find(x => x.name.toLowerCase() === colour!.toLowerCase());
    if (!found) throw bad(command, colours.length ? "color: " + colours.map(x => x.name).join("|") : "this device has no colours");
    next = { ...next, color: found.name };
  } else if (!colours.some(x => x.name === next.color)) next = { ...next, color: "" };
  const nextBackground = background ?? page.prototypeBackground ?? defaultPrototypeBackground;
  const answer = settingsJson(next, nextBackground);
  const deviceChanged = !sameDevice(next, current);
  const backgroundChanged = background !== undefined && JSON.stringify(background) !== JSON.stringify(page.prototypeBackground ?? defaultPrototypeBackground);
  if (!deviceChanged && !backgroundChanged) return { document, result: answer };
  const { prototypeDevice: _d, prototypeBackground: _b, ...rest } = page;
  const isDefaultBackground = JSON.stringify(nextBackground) === JSON.stringify(defaultPrototypeBackground);
  const updated = Object.freeze({ ...rest, ...(!isDefaultBackground && { prototypeBackground: nextBackground }), ...(!sameDevice(next, defaultPrototypeDevice) && { prototypeDevice: Object.freeze(next) }) }) as PageNode;
  return { document: Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, [page.id]: updated }) }), result: answer };
}

/** Native `frames_in`: a page's top-level frames (also inside sections) in reading order. */
export function topFrames(document: Document, container: NodeId): NodeId[] {
  const out: { id: NodeId; x: number; y: number }[] = [];
  const walk = (id: NodeId, depth: number) => {
    for (const c of (document.nodes[id] as { children?: readonly NodeId[] } | undefined)?.children ?? []) {
      const node = document.nodes[c];
      if (!node) continue;
      if (node.kind !== "page" && isFrameLike(node)) {
        const b = boundsOf(document, [c]);
        if (b) out.push({ id: c, x: b.x, y: b.y });
      } else if (node.kind === "section" && depth < 64) walk(c, depth + 1);
    }
  };
  walk(container, 0);
  return out.sort((a, b) => a.y - b.y || a.x - b.x).map(f => f.id);
}
/** Native `open_player`: `start`'s top-level frame, else the selection's, the page's first flow or its first frame. */
function playerStart(command: string, document: Document, selection: readonly NodeId[], p: Record<string, unknown>): NodeId {
  const given = parseNodeId(p.start);
  if (given !== undefined) {
    const top = topLevelFrame(document, given);
    if (top === undefined) throw bad(command, "`start` isn't a frame or inside one");
    return top;
  }
  const page = document.nodes[document.currentPage] as PageNode;
  const start = (selection[0] !== undefined ? topLevelFrame(document, selection[0]) : undefined) ?? page.flows?.[0]?.start ?? topFrames(document, page.id)[0];
  if (start === undefined) throw bad(command, "no frame to present");
  return start;
}

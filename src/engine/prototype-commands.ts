import { LosslessNumber } from "lossless-json";
import { isFrameLike, type Document, type DocumentNode, type NodeId, type PageNode } from "./document";
import { inspectedId, parseNodeId, parseNumber } from "./parameters";
import { readPrototype, type PrototypeAction, type PrototypeFlow, type PrototypeInteraction } from "./prototype-data";

/** Source: upstream engine/cmd/proto.rs (interactions and flows). */
export const prototypeSpecs = Object.freeze({
  "proto.interaction.add": { label: "Add interaction", undo: true },
  "proto.interaction.clear": { label: "Remove all interactions", undo: true },
  "proto.interaction.remove": { label: "Remove interaction", undo: true },
  "proto.interaction.set": { label: "Edit interaction", undo: true },
  "proto.flow.add": { label: "Add flow starting point", undo: true },
  "proto.flow.rename": { label: "Rename flow", undo: true },
  "proto.flow.remove": { label: "Remove flow", undo: true },
});
export type PrototypeCommand = keyof typeof prototypeSpecs;
export interface PrototypeExecution { readonly document: Document; readonly result: Record<string, unknown> }

/** Native `MAX_DELAY_MS`: the longest a mouse trigger waits. */
export const maxDelayMs = 600_000;
const actionTypes = ["navigate","back","scrollTo","openOverlay","swapOverlay","closeOverlay","openUrl","changeTo","setVariable","setVariableMode","conditional"] as const;
const triggerTypes = ["onClick","onHover","onPress","onDrag","mouseEnter","mouseLeave","mouseDown","mouseUp","afterDelay","keyPress"] as const;
const transitionTypes = ["instant","dissolve","smartAnimate","moveIn","moveOut","push","slideIn","slideOut"] as const;
const mouseTriggers = new Set(["mouseEnter","mouseLeave","mouseDown","mouseUp"]);

const bad = (command: string, message: string) => new Error("invalid parameters for `" + command + "`: " + message);
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
function index(command: string, p: Record<string, unknown>) {
  if (p.index === undefined || p.index === null) throw bad(command, "`index` required");
  const k = lenientNumber(p.index);
  if (k === undefined || !(k >= 0 && k < 1e9) || !Number.isInteger(k)) throw bad(command, "`index` must be a whole number in 0..1e9");
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

export function executePrototype(command: PrototypeCommand, document: Document, selection: readonly NodeId[], p: Record<string, unknown>): PrototypeExecution {
  const setNodes = (changes: Record<NodeId, DocumentNode>): Document =>
    Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, ...changes }) });
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

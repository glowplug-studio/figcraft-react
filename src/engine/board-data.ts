import { isLosslessNumber } from "lossless-json";
import type { NodeId } from "./document";
import { fail, id, number, wireId } from "./native-values";

/** Source: upstream doc/src/board.rs and facilitation.rs: what board objects are for, and a board's timer and votes, as files carry them. */
export const boardShapes = Object.freeze(["rectangle", "roundedRectangle", "ellipse", "diamond", "triangle", "speechBubble", "chevron", "triangleDown",
  "parallelogramRight", "parallelogramLeft", "trapezoid", "pentagon", "hexagon", "octagon", "star", "plus", "arrowLeft", "arrowRight", "database",
  "document", "predefinedProcess", "manualInput", "internalStorage"] as const);
export type BoardShape = typeof boardShapes[number];
export const stamps = Object.freeze(["thumbsUp", "heart", "plusOne", "star", "question", "check"] as const);
export type Stamp = typeof stamps[number];
export type Routing = "straight" | "elbow" | "curved";
export type Side = "auto" | "top" | "right" | "bottom" | "left";
/** Native `End`: attached to a layer (at its side's middle, or where it was put by hand as fractions of its box), or a free point. */
export type End = { readonly node: NodeId; readonly side: Side; readonly at?: readonly [number, number] } | { readonly x: number; readonly y: number };
/** Native `ConnectorPath`: an elbow's runs, or how far a curve's middle was moved, from the middle of the two ends. */
export type ConnectorPath = { readonly runs: { readonly across: boolean; readonly at: readonly number[] } } | { readonly bow: { readonly x: number; readonly y: number } };
export interface Connector { readonly from: End; readonly to: End; readonly routing: Routing; readonly path?: ConnectorPath; readonly branch?: boolean }
/** Native `BoardItem`. */
export type BoardItem =
  | { readonly type: "sticky"; readonly author?: string }
  | { readonly type: "shape"; readonly shape: BoardShape }
  | ({ readonly type: "connector" } & Connector)
  | { readonly type: "label"; readonly connector: NodeId }
  | { readonly type: "stamp"; readonly stamp: Stamp; readonly author?: string; readonly on?: NodeId }
  | { readonly type: "ink" } | { readonly type: "table" } | { readonly type: "mindNode" };

/** Native `BOARD_COLORS` and `BOARD_PAGE`. */
export const boardColours = Object.freeze([["yellow", "#FFE78A"], ["orange", "#FFC994"], ["red", "#FFAEA6"], ["pink", "#F7B9DA"], ["violet", "#D4C2FC"],
  ["blue", "#ACD3FA"], ["green", "#C2E8A6"], ["gray", "#E3E1DD"]] as const);
export const boardPage = "#F4F3F0";

/** Native `BoardTimer`: counting down to `ends`, or paused with `left` (milliseconds). */
export type BoardTimer = { readonly state: "running"; readonly ends: number } | { readonly state: "paused"; readonly left: number };
export type VoteScope = { readonly type: "all" } | { readonly type: "stickies" } | { readonly type: "only"; readonly ids: readonly NodeId[] };
export interface Vote { readonly perPerson: number; readonly scope: VoteScope; readonly ended: boolean; readonly by?: string }
export type Ballots = Readonly<Record<string, readonly NodeId[]>>;
export interface VoteRecord { readonly vote: Vote; readonly ballots: Ballots; readonly names?: Readonly<Record<string, string>>; readonly ended: number }
export const timerMaxMs = 24 * 60 * 60 * 1000, votesMax = 99, voteHistoryMax = 20;

type Obj = Record<string, unknown>;
const record = (v: unknown, path: string): Obj => { if (!v || typeof v !== "object" || Array.isArray(v) || isLosslessNumber(v)) fail(`${path} must be an object`); return v as Obj; };
const str = (v: unknown, path: string): string => { if (typeof v !== "string") fail(`${path} must be text`); return v; };
const bool = (v: unknown, path: string): boolean => { if (typeof v !== "boolean") fail(`${path} must be true or false`); return v; };
const arr = (v: unknown, path: string): unknown[] => { if (!Array.isArray(v)) fail(`${path} must be a list`); return v; };
const oneOf = <T extends string>(v: unknown, all: readonly T[], path: string): T => { const s = str(v, path); if (!all.includes(s as T)) fail(`${path}: unknown ${s}`); return s as T; };
const u64 = (v: unknown, path: string): number => { const n = number(v, path); if (n < 0 || !Number.isInteger(n)) fail(`${path} must be a whole number`); return n; };
/** Only the keys native's serde names for an object (unknown ones would be lost on save). */
function keys(o: Obj, allowed: readonly string[], path: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}/${k} is not supported yet`);
}

function readEnd(v: unknown, path: string): End {
  const o = record(v, path);
  if ("node" in o) {
    keys(o, ["node", "side", "at"], path);
    const at = o.at === undefined || o.at === null ? undefined : arr(o.at, path + "/at").map((x, i) => number(x, `${path}/at/${i}`));
    if (at && at.length !== 2) fail(`${path}/at must be two numbers`);
    return { node: id(o.node, path + "/node"), side: o.side === undefined ? "auto" : oneOf(o.side, ["auto", "top", "right", "bottom", "left"] as const, path + "/side"), ...(at && { at: [at[0], at[1]] as const }) };
  }
  keys(o, ["x", "y"], path);
  return { x: number(o.x, path + "/x"), y: number(o.y, path + "/y") };
}
function readPath(v: unknown, path: string): ConnectorPath {
  const o = record(v, path), [k] = Object.keys(o);
  if (Object.keys(o).length !== 1) fail(`${path} must name one kind of path`);
  const inner = record(o[k], `${path}/${k}`);
  if (k === "runs") { keys(inner, ["across", "at"], path + "/runs"); return { runs: { across: bool(inner.across, path + "/runs/across"), at: arr(inner.at, path + "/runs/at").map((x, i) => number(x, `${path}/runs/at/${i}`)) } }; }
  if (k === "bow") { keys(inner, ["x", "y"], path + "/bow"); return { bow: { x: number(inner.x, path + "/bow/x"), y: number(inner.y, path + "/bow/y") } }; }
  return fail(`${path}: unknown path ${k}`);
}
/** Native `BoardItem` from a file (a node's `board`). */
export function readBoardItem(v: unknown, path = "board"): BoardItem | undefined {
  if (v === undefined || v === null) return undefined;
  const o = record(v, path), type = str(o.type, path + "/type");
  const author = (a: unknown) => a === undefined || a === "" ? {} : { author: str(a, path + "/author") };
  switch (type) {
    case "sticky": keys(o, ["type", "author"], path); return { type, ...author(o.author) };
    case "shape": keys(o, ["type", "shape"], path); return { type, shape: o.shape === undefined ? "rectangle" : oneOf(o.shape, boardShapes, path + "/shape") };
    case "connector": {
      keys(o, ["type", "from", "to", "routing", "path", "branch"], path);
      const p = o.path === undefined || o.path === null ? undefined : readPath(o.path, path + "/path");
      return { type, from: readEnd(o.from, path + "/from"), to: readEnd(o.to, path + "/to"), routing: o.routing === undefined ? "straight" : oneOf(o.routing, ["straight", "elbow", "curved"] as const, path + "/routing"),
        ...(p && { path: p }), ...(o.branch !== undefined && bool(o.branch, path + "/branch") && { branch: true }) };
    }
    case "label": keys(o, ["type", "connector"], path); return { type, connector: id(o.connector, path + "/connector") };
    case "stamp": keys(o, ["type", "stamp", "author", "on"], path);
      return { type, stamp: o.stamp === undefined ? "thumbsUp" : oneOf(o.stamp, stamps, path + "/stamp"), ...author(o.author), ...(o.on !== undefined && o.on !== null && { on: id(o.on, path + "/on") }) };
    case "ink": case "table": case "mindNode": keys(o, ["type"], path); return { type };
  }
  return fail(`${path}: unknown board object ${type}`);
}
const wireEnd = (e: End) => "node" in e ? { node: wireId(e.node), side: e.side, ...(e.at && { at: [...e.at] }) } : { x: e.x, y: e.y };
/** A board item as native writes it. */
export function wireBoardItem(b: BoardItem): Obj {
  switch (b.type) {
    case "connector": return { type: b.type, from: wireEnd(b.from), to: wireEnd(b.to), routing: b.routing, ...(b.path && { path: b.path }), ...(b.branch && { branch: true }) };
    case "label": return { type: b.type, connector: wireId(b.connector) };
    case "stamp": return { type: b.type, stamp: b.stamp, ...(b.author && { author: b.author }), ...(b.on !== undefined && { on: wireId(b.on) }) };
    default: return { ...b };
  }
}
/** Native `BoardItem::remap`: a connector's ends and a label's connector point at their copies. */
export function remapBoardItem(b: BoardItem, map: (id: NodeId) => NodeId | undefined): BoardItem {
  const end = (e: End): End => "node" in e ? { ...e, node: map(e.node) ?? e.node } : e;
  if (b.type === "connector") return { ...b, from: end(b.from), to: end(b.to) };
  if (b.type === "label") return { ...b, connector: map(b.connector) ?? b.connector };
  return b;
}

export function readTimer(v: unknown, path = "timer"): BoardTimer | undefined {
  if (v === undefined || v === null) return undefined;
  const o = record(v, path), state = str(o.state, path + "/state");
  if (state === "running") { keys(o, ["state", "ends"], path); return { state, ends: u64(o.ends, path + "/ends") }; }
  if (state === "paused") { keys(o, ["state", "left"], path); return { state, left: u64(o.left, path + "/left") }; }
  return fail(`${path}: unknown timer state ${state}`);
}
function readScope(v: unknown, path: string): VoteScope {
  if (v === undefined) return { type: "all" };
  const o = record(v, path), type = str(o.type, path + "/type");
  if (type === "all" || type === "stickies") { keys(o, ["type"], path); return { type }; }
  if (type === "only") { keys(o, ["type", "ids"], path); return { type, ids: arr(o.ids, path + "/ids").map((x, i) => id(x, `${path}/ids/${i}`)) }; }
  return fail(`${path}: unknown vote scope ${type}`);
}
export function readVote(v: unknown, path = "vote"): Vote | undefined {
  if (v === undefined || v === null) return undefined;
  const o = record(v, path);
  keys(o, ["perPerson", "scope", "ended", "by"], path);
  return { perPerson: u64(o.perPerson, path + "/perPerson"), scope: readScope(o.scope, path + "/scope"), ended: o.ended === undefined ? false : bool(o.ended, path + "/ended"),
    ...(o.by !== undefined && o.by !== "" && { by: str(o.by, path + "/by") }) };
}
export function readBallots(v: unknown, path = "votes"): Ballots {
  if (v === undefined || v === null) return {};
  const o = record(v, path);
  return Object.fromEntries(Object.entries(o).map(([k, ids]) => [k, arr(ids, `${path}/${k}`).map((x, i) => id(x, `${path}/${k}/${i}`))]));
}
export function readVoteHistory(v: unknown, path = "vote_history"): VoteRecord[] {
  if (v === undefined || v === null) return [];
  return arr(v, path).map((entry, i) => {
    const p = `${path}/${i}`, o = record(entry, p);
    keys(o, ["vote", "ballots", "names", "ended"], p);
    const names = o.names === undefined ? {} : Object.fromEntries(Object.entries(record(o.names, p + "/names")).map(([k, n]) => [k, str(n, `${p}/names/${k}`)]));
    return { vote: readVote(o.vote, p + "/vote")!, ballots: readBallots(o.ballots, p + "/ballots"), ...(Object.keys(names).length && { names }), ended: o.ended === undefined ? 0 : u64(o.ended, p + "/ended") };
  });
}
const wireScope = (s: VoteScope) => s.type === "only" ? { type: s.type, ids: s.ids.map(wireId) } : { type: s.type };
const wireVote = (v: Vote) => ({ perPerson: v.perPerson, scope: wireScope(v.scope), ended: v.ended, ...(v.by && { by: v.by }) });
const wireBallots = (b: Ballots) => Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k].map(wireId)]));
/** A board's document fields as native writes them (each left out when it holds nothing). */
export function wireBoardDocument(d: { kind?: "board"; timer?: BoardTimer; vote?: Vote; votes?: Ballots; voteHistory?: readonly VoteRecord[] }): Obj {
  return {
    ...(d.kind === "board" && { kind: "board" }),
    ...(d.timer && { timer: d.timer }),
    ...(d.vote && { vote: wireVote(d.vote) }),
    ...(d.votes && Object.keys(d.votes).length && { votes: wireBallots(d.votes) }),
    ...(d.voteHistory?.length && { vote_history: d.voteHistory.map(r => ({ vote: wireVote(r.vote), ballots: wireBallots(r.ballots), ...(r.names && Object.keys(r.names).length && { names: r.names }), ended: r.ended })) }),
  };
}

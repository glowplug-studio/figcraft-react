import { colour, type Colour } from "./colour";
import { parseColour } from "./colour-css";
import { isFrameLike, withRectanglePaints, type Document, type DocumentNode, type FrameNode, type NodeId, type TextNode, type VectorNode } from "./document";
import { HierarchyDraft, ancestors } from "./hierarchy";
import { boardColours, type BoardItem, type BoardShape, type Routing, type Stamp } from "./board-data";
import { shapeFromId, shapeLabel, shapeOrder, shapePadding, shapePath } from "./board-shapes";
import { newTextData, normaliseTextLines } from "./text-data";
import { networkFromPath } from "./vector-network";
import { solidPaint, type Paint } from "./solid-paint";
import { defaultStroke, type StrokeCap } from "./stroke";
import type { AutoLayout } from "./auto-layout";
import { parseNodeId } from "./parameters";
import { boundsOf } from "./viewport";
import { parseSvgPath } from "./svg-path";
import { createLayer } from "./creation";
import { stamps as stampIds } from "./board-data";
import { arriving, branchesOf, mapChildren, mapSide, mindGapX, mindGapY, mindLineHeight, mindMaxCoord, mindMaxStarters, mindMaxText, mindMinW, mindNodeSize,
  mindNodeTracking, mindRootSize, mindRootText, mindRootTracking, mindStarters } from "./board-mindmap";
import { buildTemplate, createOn, findTemplate, templates } from "./board-templates";
import { editTable, makeTable, maxColumns, maxRows, tableAnswer, tableOf, type TableCtx } from "./board-table";
import { inverse, multiply, transformPoint, type Affine } from "./affine";
import { worldTransform, pageForNode } from "./hierarchy";
import { networkFromPoints } from "./vector-network";
import { pathBounds } from "./vector-path";
import type { PathCommand } from "./corners";
import type { Connector, End, Side } from "./board-data";
import { attachedSides, reshaped, routeAlong, type Pt, type RouteEnd } from "./board-route";

/** Source: upstream engine/src/boards/board.rs and board/{items,edit}.rs: stickies and shapes with text, their colours and styles. */
export const boardSpecs = Object.freeze({
  "board.sticky": { label: "Sticky note", undo: true },
  "board.nextSticky": { label: "Next sticky note", undo: true },
  "board.shape": { label: "Shape with text", undo: true },
  "board.setColor": { label: "Board color", undo: true },
  "board.setStyle": { label: "Board style", undo: true },
  "board.connector": { label: "Connector", undo: true },
  "board.reattach": { label: "Reattach connector", undo: true },
  "board.label": { label: "Connector label", undo: true },
  "board.reshape": { label: "Reshape connector", undo: true },
  "board.addConnected": { label: "Add connected shape", undo: true },
  "board.stamp": { label: "Stamp", undo: true },
  "board.ink": { label: "Marker stroke", undo: true },
  "board.table": { label: "Table", undo: true },
  "board.tableEdit": { label: "Edit table", undo: true },
  "board.template": { label: "Board template", undo: true },
  "board.mindMap": { label: "Mind map", undo: true },
  "board.mindMapAdd": { label: "Add mind map node", undo: true },
});
export type BoardCommand = keyof typeof boardSpecs;
const takes: Record<BoardCommand, readonly string[]> = {
  "board.sticky": ["x", "y", "text", "color", "fontSize", "author", "parent"],
  "board.nextSticky": ["id", "side", "edit"],
  "board.shape": ["shape", "x", "y", "width", "height", "text", "color", "parent"],
  "board.setColor": ["ids", "color"],
  "board.setStyle": ["ids", "shape", "fontSize", "style", "startCap", "endCap"],
  "board.connector": ["from", "to", "fromSide", "toSide", "fromAt", "toAt", "style", "startCap", "endCap", "label"],
  "board.reattach": ["id", "ids", "end", "target", "side", "at"],
  "board.label": ["id", "ids", "text"],
  "board.reshape": ["id", "ids", "portion", "x", "y"],
  "board.addConnected": ["id", "side", "at", "edit"],
  "board.stamp": ["x", "y", "stamp"],
  "board.ink": ["path", "points", "highlighter", "color", "select"],
  "board.table": ["rows", "columns", "cells", "x", "y"],
  "board.tableEdit": ["id", "action", "index"],
  "board.template": ["name", "x", "y"],
  "board.mindMap": ["x", "y", "text", "children", "parent", "edit"],
  "board.mindMapAdd": ["id", "relation", "text", "edit"],
};

/** Native `NEEDS_BOARD` and `NOT_ON_BOARDS`. */
export const needsBoard = "this is for boards: make one with File ▸ New board";
export const notOnBoards = "boards have no prototypes or Developer Mode: use a design file for those";
const disabled = (command: string, why: string) => new Error("command `" + command + "` is not available right now: " + why);
const bad = (command: string, message: string) => new Error("invalid parameters for `" + command + "`: " + message);
/** Native `refuse_on_board`: prototyping and Dev Mode refuse on a board. */
export function refuseOnBoard(doc: Document, command: string) {
  const designOnly = command.startsWith("proto.") || command.startsWith("dev.") || ["view.prototype", "view.designPrototype", "view.devMode"].includes(command);
  if (designOnly && doc.kind === "board") throw disabled(command, notOnBoards);
}

/** Native `BoardTool`: the colour new stickies get and their text size, the shape and stamp the tools place, how new connectors run, the
 * marker's and highlighter's colours. */
export interface BoardTool { readonly sticky: Colour; readonly stickySize: number; readonly shape: BoardShape; readonly stamp: Stamp; readonly routing: Routing; readonly marker: Colour; readonly highlighter: Colour }
const rgb = (hex: string) => colour(Math.fround(parseInt(hex.slice(1, 3), 16) / 255), Math.fround(parseInt(hex.slice(3, 5), 16) / 255), Math.fround(parseInt(hex.slice(5, 7), 16) / 255), 1);
/** Native `INK` and `AUTHOR_INK`. */
export const ink = rgb("#1E1E1E"), authorInk = rgb("#5C5A55");
export const defaultBoardTool: BoardTool = Object.freeze({ sticky: rgb(boardColours[0][1]), stickySize: 16, shape: "rectangle", stamp: "thumbsUp", routing: "elbow",
  marker: ink, highlighter: rgb("#FFD21F") });
/** Native `board_color`: a board colour by name (any case), else any colour. */
export function boardColour(value: string): Colour | undefined {
  const named = boardColours.find(([n]) => n === value.trim().toLowerCase());
  return named ? rgb(named[1]) : parseColour(value.trim());
}
/** Native `line_shade`: a board colour's deeper shade for lines (other colours are used as they are). */
export function lineShade(c: Colour): Colour {
  const palette = boardColours.some(([, hex]) => { const b = rgb(hex); return b.r === c.r && b.g === c.g && b.b === c.b && b.a === c.a; });
  return palette ? colour(Math.fround(c.r * 0.55), Math.fround(c.g * 0.55), Math.fround(c.b * 0.55), c.a) : c;
}

/** Native `STICKY`, `STICKY_PAD`, `STICKY_GAP`, `SHAPE`. */
export const sticky = 200, stickyPad = 16, stickyGap = 24, shapeSize = 160;
const autoLayout = (over: Partial<AutoLayout>): AutoLayout => Object.freeze({ mode: "vertical", wrap: false, gap: 10, crossGap: 10, padding: [0, 0, 0, 0], mainAlign: "min",
  crossAlign: "min", contentAlign: "auto", gridColumns: 2, gridRows: 2, columnTracks: Object.freeze([]), rowTracks: Object.freeze([]), strokesIncluded: true, reverseZ: false, ...over } as AutoLayout);
/** Native `soft_shadow`: under stickies and stamps. */
const softShadow = () => Object.freeze({ type: "dropShadow", visible: true, color: Object.freeze({ r: 0, g: 0, b: 0, a: Math.fround(0.16) }), offset: Object.freeze([0, 2]),
  radius: 6, spread: 0, blend: "normal", showBehind: false }) as unknown as NonNullable<FrameNode["effects"]>[number];

interface Ctx { draft: HierarchyDraft; next: bigint }
function alloc(ctx: Ctx): NodeId { const { id, nextId } = ctx.draft.allocateId(ctx.next); ctx.next = nextId; return id; }
/** Native `add_text`: a text layer filling its frame's width (the frame's auto layout places it), named after its first line. */
function addText(ctx: Ctx, parent: NodeId, text: string, size: number, fill: Colour, align: "left" | "center", width: number): NodeId {
  const first = [...(text.split("\n")[0] ?? "")].slice(0, 64).join("");
  const id = alloc(ctx);
  const data = { ...newTextData(normaliseTextLines(text)), autoResize: "height" as const, alignH: align };
  const node = withRectanglePaints({ id, kind: "text", name: first.trim() ? first : "Text", parent, x: 0, y: 0, width: Math.max(width, 1), height: size * 1.4, fill: "#000000",
    text: Object.freeze({ ...data, style: Object.freeze({ ...data.style, fontSize: size }) }), textSizing: Object.freeze({ horizontal: "fill", vertical: "hug" }) } as unknown as TextNode, [solidPaint(fill)]);
  ctx.draft.insert(node, parent);
  return id;
}
/** Native `make_sticky`: the frame, its note and (when known) its author. */
function makeSticky(ctx: Ctx, parent: NodeId, at: readonly [number, number], text: string, fill: Colour, author: string, size: number): [NodeId, NodeId] {
  const id = alloc(ctx);
  const frame = withRectanglePaints({ id, kind: "frame", name: "Sticky", parent, x: at[0], y: at[1], width: sticky, height: sticky, fill: "#000000", children: Object.freeze([]),
    corners: Object.freeze({ radii: Object.freeze([2, 2, 2, 2]), smoothing: 0 }), effects: Object.freeze([softShadow()]), clip: false,
    layout: autoLayout({ gap: 8, padding: [stickyPad, stickyPad, stickyPad, stickyPad], mainAlign: "spaceBetween" }),
    sizing: Object.freeze({ horizontal: "fixed", vertical: "hug" }), childLayout: Object.freeze({ minHeight: sticky }),
    board: Object.freeze({ type: "sticky", ...(author && { author }) }) } as unknown as FrameNode, [solidPaint(fill)]);
  ctx.draft.insert(frame, parent);
  const inner = sticky - 2 * stickyPad;
  const note = addText(ctx, id, text, size, ink, "left", inner);
  if (author) {
    const a = addText(ctx, id, author, 10, authorInk, "left", inner);
    ctx.draft.set({ ...ctx.draft.nodes[a], name: "Author" });
  }
  return [id, note];
}
/** The outline layer of a shape with text. */
function outlineNode(id: NodeId, parent: NodeId, shape: BoardShape, w: number, h: number, fill: Colour): VectorNode {
  return withRectanglePaints({ id, kind: "vector", name: "Outline", parent, x: 0, y: 0, width: w, height: h, fill: "#000000", network: networkFromPath(shapePath(shape, w, h)),
    strokes: Object.freeze([solidPaint(lineShade(fill))]), stroke: Object.freeze({ ...defaultStroke, weight: 1.5, align: "inside" }),
    childLayout: Object.freeze({ absolute: true }), constraints: Object.freeze({ horizontal: "scale", vertical: "scale" }) } as unknown as VectorNode, [solidPaint(fill)]);
}
/** Native `make_shape`: the frame, its outline and its text. */
function makeShape(ctx: Ctx, parent: NodeId, at: readonly [number, number], [w, h]: readonly [number, number], shape: BoardShape, text: string, fill: Colour): [NodeId, NodeId] {
  const id = alloc(ctx);
  ctx.draft.insert(withRectanglePaints({ id, kind: "frame", name: shapeLabel(shape), parent, x: at[0], y: at[1], width: w, height: h, fill: "#000000", children: Object.freeze([]),
    clip: false, layout: autoLayout({ padding: shapePadding(shape, w, h), mainAlign: "center", crossAlign: "center" }),
    board: Object.freeze({ type: "shape", shape }) } as unknown as FrameNode, []), parent);
  ctx.draft.insert(outlineNode(alloc(ctx), id, shape, w, h, fill), id);
  const [, r, , l] = shapePadding(shape, w, h);
  return [id, addText(ctx, id, text, 16, ink, "center", Math.max(w - l - r, 1))];
}

const finite = (command: string, p: Record<string, unknown>, key: string, fallback: number) => {
  const v = p[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(command, "`" + key + "` must be a number");
  return v;
};
function colourParam(command: string, p: Record<string, unknown>): Colour | undefined {
  const v = p.color;
  if (v === undefined || v === null) return undefined;
  const c = typeof v === "string" ? boardColour(v) : parseColour(v);
  if (!c) throw bad(command, "`color` is a board colour (yellow, blue…) or a colour such as #FFE78A");
  return c;
}
function shapeParam(command: string, v: unknown): BoardShape {
  const s = typeof v === "string" ? shapeFromId(v) : undefined;
  if (!s) throw bad(command, "unknown shape `" + String(v) + "` (" + shapeOrder.join("|") + ")");
  return s;
}
/** Native `parent_of`: the page, a section or a frame that is not a board object. */
function parentOf(command: string, doc: Document, p: Record<string, unknown>): NodeId {
  const parent = p.parent === undefined || p.parent === null ? doc.currentPage : parseNodeId(p.parent);
  const n = parent !== undefined ? doc.nodes[parent] : undefined;
  if (!n) throw new Error("no such node " + String(p.parent));
  const atom = (b?: BoardItem) => !!b && ["sticky", "shape", "label", "stamp", "table", "mindNode"].includes(b.type);
  if (!(n.kind === "page" || n.kind === "section" || (isFrameLike(n) && !atom((n as { board?: BoardItem }).board)))) throw bad(command, "`parent` is the page, a section or a frame");
  return n.id;
}
/** Native `text_of`: the first text layer inside a board object that has text. */
export function textOf(doc: Document, id: NodeId): NodeId | undefined {
  const n = doc.nodes[id] as DocumentNode & { board?: BoardItem; children?: readonly NodeId[] };
  if (!n?.board || !["sticky", "shape", "label", "mindNode"].includes(n.board.type)) return undefined;
  return n.children?.find(c => doc.nodes[c]?.kind === "text");
}
/** Native `owner_of_text`: the board object whose text `text` is. */
export function ownerOfText(doc: Document, text: NodeId): NodeId | undefined {
  const p = doc.nodes[text]?.parent;
  return p != null && textOf(doc, p) === text ? p : undefined;
}
/** Native `req_targets`: `ids`, else the selection. */
function targets(command: string, p: Record<string, unknown>, selection: readonly NodeId[]): NodeId[] {
  const ids = Array.isArray(p.ids) ? p.ids.map(v => parseNodeId(v) ?? "") : p.ids === undefined || p.ids === null ? [...selection] : [parseNodeId(p.ids) ?? ""];
  if (!ids.length) throw disabled(command, "nothing is selected (pass `ids`)");
  return ids;
}
const solidOf = (n: DocumentNode) => ((n as { fills?: readonly Paint[] }).fills ?? []).find((f): f is Extract<Paint, { type: "solid" }> => f.type === "solid")?.color
  ?? (typeof (n as { fill?: string }).fill === "string" ? parseColour((n as { fill: string }).fill) : undefined);
const caps = ["none", "round", "square", "lineArrow", "triangleArrow", "reversedTriangle", "circleFilled", "diamondFilled", "squareFilled", "circle", "diamond", "lineArrowReversed"];

/** Native `LINE` and `LINE_WEIGHT`: connectors' colour and weight; native `CAPS`: a new connector's caps. */
export const line = rgb("#3A3936"), lineWeight = 2;
const defaultCaps: readonly [StrokeCap, StrokeCap] = ["none", "triangleArrow"];
type Layer = DocumentNode & { board?: BoardItem; network?: import("./vector-network").VectorNetwork; width: number; height: number; transform?: Affine; x: number; y: number; children?: readonly NodeId[] };
const worldBox = (doc: Document, id: NodeId) => { const b = boundsOf(doc, [id]); return b && { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; };
/** Native `route_ends`: a connector's ends as they are now. */
function routeEnds(doc: Document, c: Connector): [RouteEnd, RouteEnd] | undefined {
  const end = (e: End): RouteEnd | undefined => {
    if (!("node" in e)) return { point: { x: e.x, y: e.y } };
    const b = doc.nodes[e.node] ? worldBox(doc, e.node) : undefined;
    if (!b) return undefined;
    return e.at ? { box: b, side: e.side, on: { x: b.x0 + e.at[0] * (b.x1 - b.x0), y: b.y0 + e.at[1] * (b.y1 - b.y0) } } : { box: b, side: e.side };
  };
  const a = end(c.from), b = end(c.to);
  return a && b ? [a, b] : undefined;
}
/** Native `route`: the page points connector `c` runs through. */
export function route(doc: Document, c: Connector): Pt[] | undefined {
  const ends = routeEnds(doc, c);
  return ends && routeAlong(ends[0], ends[1], c.routing, c.path);
}
/** Native `route_path`: one curve for a curved connector, straight runs otherwise. */
function routePath(pts: readonly Pt[], routing: Connector["routing"]): PathCommand[] {
  if (routing === "curved" && pts.length === 4) return [["M", pts[0].x, pts[0].y], ["C", pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y]];
  return pts.map((p, i): PathCommand => [i === 0 ? "M" : "L", p.x, p.y]);
}
const mapPath = (path: readonly PathCommand[], m: Affine): PathCommand[] => path.map((c): PathCommand => {
  if (c[0] === "Z") return c;
  const pts: number[] = [];
  for (let i = 1; i < c.length; i += 2) { const q = transformPoint(m, { x: c[i] as number, y: c[i + 1] as number }); pts.push(q.x, q.y); }
  return [c[0], ...pts] as unknown as PathCommand;
});
/** Native `place_route`: the route written into connector `id` (its box, place and path); untouched when it already runs there. */
function placeRoute(draft: HierarchyDraft, id: NodeId, pts: readonly Pt[], routing: Connector["routing"]) {
  const doc = draft.document, n = doc.nodes[id] as Layer | undefined;
  if (!n) return;
  const pw = n.parent != null && doc.nodes[n.parent]?.kind !== "page" ? worldTransform(doc, n.parent) : [1, 0, 0, 1, 0, 0] as Affine;
  const local = mapPath(routePath(pts, routing), inverse(pw));
  const b = pathBounds(local);
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
  const rel = mapPath(local, [1, 0, 0, 1, -b.x, -b.y]);
  const network = routing === "curved" ? networkFromPath(rel) : networkFromPoints(rel.map(c => ({ x: c[1] as number, y: c[2] as number })), false);
  const same = n.x === b.x && n.y === b.y && !n.transform && n.width === b.width && n.height === b.height && JSON.stringify(n.network) === JSON.stringify(network);
  if (same) return;
  const { transform: _t, ...rest } = n;
  void _t;
  draft.set({ ...rest, network, x: b.x, y: b.y, width: b.width, height: b.height } as DocumentNode);
}
/** Native `ends_now`: a connector's first and last points on the page as drawn now. */
function endsNow(doc: Document, id: NodeId): [Pt, Pt] | undefined {
  const n = doc.nodes[id] as Layer | undefined, v = n?.network?.vertices;
  if (!n || !v?.length) return undefined;
  const w = worldTransform(doc, id);
  return [transformPoint(w, v[0]), transformPoint(w, v[v.length - 1])];
}
/** Native `route_mid`: the middle of connector `id`'s route by length, on the page (curves flattened finely). */
function routeMid(doc: Document, id: NodeId): Pt | undefined {
  const n = doc.nodes[id] as Layer | undefined, net = n?.network;
  if (!n || !net || !net.vertices.length) return undefined;
  const w = worldTransform(doc, id), pts: Pt[] = [];
  const at = (i: number) => net.vertices[i];
  net.segments.forEach((sg, k) => {
    const a = at(sg.a), b = at(sg.b);
    if (k === 0) pts.push(a);
    if (sg.ta[0] === 0 && sg.ta[1] === 0 && sg.tb[0] === 0 && sg.tb[1] === 0) { pts.push(b); return; }
    const c1 = { x: a.x + sg.ta[0], y: a.y + sg.ta[1] }, c2 = { x: b.x + sg.tb[0], y: b.y + sg.tb[1] };
    for (let i = 1; i <= 256; i++) {
      const t = i / 256, u = 1 - t;
      pts.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
    }
  });
  const page = pts.map(p => transformPoint(w, p));
  const total = page.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - page[i].x, q.y - page[i].y), 0);
  let left = total / 2;
  for (let i = 0; i + 1 < page.length; i++) {
    const a = page[i], b = page[i + 1], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left && l > 0) return { x: a.x + (b.x - a.x) * left / l, y: a.y + (b.y - a.y) * left / l };
    left -= l;
  }
  return page[0];
}
/** Native `label_of`: the label of connector `id`. */
export function labelOf(doc: Document, id: NodeId): NodeId | undefined {
  const parent = doc.nodes[id]?.parent, p = parent != null ? doc.nodes[parent] as Layer : undefined;
  return p?.children?.find(c => { const b = (doc.nodes[c] as Layer | undefined)?.board; return b?.type === "label" && b.connector === id; });
}
/** Native `place_label`: a label at the middle of its connector; gone with it. */
function placeLabel(draft: HierarchyDraft, label: NodeId, connector: NodeId) {
  const doc = draft.document, mid = doc.nodes[connector] ? routeMid(doc, connector) : undefined;
  if (!mid) { if (doc.nodes[label]) draft.remove(label); return; }
  const n = doc.nodes[label] as Layer | undefined;
  if (!n) return;
  const pw = n.parent != null && doc.nodes[n.parent]?.kind !== "page" ? worldTransform(doc, n.parent) : [1, 0, 0, 1, 0, 0] as Affine;
  const local = transformPoint(inverse(pw), mid), x = local.x - n.width / 2, y = local.y - n.height / 2;
  if (n.x === x && n.y === y && !n.transform) return;
  const { transform: _t, ...rest } = n;
  void _t;
  draft.set({ ...rest, x, y } as DocumentNode);
}
/** Native `set_label`: connector `id`'s label is `text` (empty removes it); the label's id. */
function setLabel(ctx: Ctx, id: NodeId, text: string): NodeId | undefined {
  const doc = ctx.draft.document, existing = labelOf(doc, id);
  if (!text.trim()) { if (existing) ctx.draft.remove(existing); return undefined; }
  if (existing) {
    const t = textOf(doc, existing), tn = t !== undefined ? doc.nodes[t] as TextNode : undefined;
    if (tn) ctx.draft.set({ ...tn, text: { ...tn.text, characters: normaliseTextLines(text), runs: [] } } as DocumentNode);
    return existing;
  }
  const parent = doc.nodes[id].parent!, l = alloc(ctx);
  ctx.draft.insert(withRectanglePaints({ id: l, kind: "frame", name: "Label", parent, x: 0, y: 0, width: 40, height: 24, fill: "#ffffff", children: Object.freeze([]),
    corners: Object.freeze({ radii: Object.freeze([4, 4, 4, 4]), smoothing: 0 }), clip: false, layout: autoLayout({ mode: "horizontal", padding: [3, 6, 3, 6] }),
    sizing: Object.freeze({ horizontal: "hug", vertical: "hug" }), board: Object.freeze({ type: "label", connector: id }) } as unknown as FrameNode, [solidPaint(colour(1, 1, 1, 1))]), parent);
  const t = addText(ctx, l, text, 12, ink, "center", 40), tn = ctx.draft.nodes[t] as TextNode;
  ctx.draft.set({ ...tn, text: { ...tn.text, autoResize: "widthAndHeight" }, textSizing: { horizontal: "hug", vertical: "hug" } } as DocumentNode);
  return l;
}
const sides: readonly Side[] = ["auto", "top", "right", "bottom", "left"];
/** Native `end_param`: a connector end from the params, a layer on this page or a point. */
function endParam(command: string, doc: Document, p: Record<string, unknown>, [key, sideKey, atKey]: readonly [string, string, string]): End {
  let side: Side = "auto";
  if (p[sideKey] !== undefined && p[sideKey] !== null) {
    const v = String(p[sideKey]).toLowerCase();
    if (!sides.includes(v as Side)) throw bad(command, "`" + sideKey + "` is auto, top, right, bottom or left");
    side = v as Side;
  }
  const v = p[key];
  if (v === undefined || v === null) throw bad(command, "`" + key + "` is required");
  if (typeof v === "object" && !Array.isArray(v) && "x" in v) {
    const o = v as { x: unknown; y: unknown };
    if (typeof o.x !== "number" || typeof o.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y)) throw bad(command, "`" + key + "` needs finite x and y");
    return { x: o.x, y: o.y };
  }
  const node = parseNodeId(v);
  if (node === undefined) throw bad(command, "`" + key + "` is a layer id or {x, y}");
  const n = doc.nodes[node] as Layer | undefined;
  if (!n) throw new Error("no such node " + node);
  if (n.kind === "page" || pageForNode(doc, node) !== doc.currentPage) throw bad(command, "`" + key + "` must be a layer on this page");
  if (n.board?.type === "connector") throw bad(command, "`" + key + "` can't be another connector");
  let at: [number, number] | undefined;
  const a = p[atKey];
  if (a !== undefined && a !== null) {
    if (!Array.isArray(a) || a.length !== 2 || !a.every(x => typeof x === "number" && Number.isFinite(x))) throw bad(command, "`" + atKey + "` is [x, y], fractions of the layer's box");
    at = [Math.min(Math.max(a[0], 0), 1), Math.min(Math.max(a[1], 0), 1)];
  }
  return { node, side, ...(at && { at }) };
}
/** Native `make`: connector `c` added to the page with its line, caps and route. */
function makeConnector(ctx: Ctx, page: NodeId, c: Connector, caps: readonly [StrokeCap, StrokeCap]): NodeId {
  const command = "board.connector", pts = route(ctx.draft.document, c);
  if (!pts) throw bad(command, "the ends can't be placed");
  if (pts.every((q, i) => i === 0 || (q.x === pts[i - 1].x && q.y === pts[i - 1].y))) throw bad(command, "the ends are in the same place");
  const id = alloc(ctx);
  ctx.draft.insert(Object.freeze({ id, kind: "vector", name: "Connector", parent: page, x: 0, y: 0, width: 0, height: 0, fill: "transparent", network: networkFromPoints([], false),
    strokes: Object.freeze([solidPaint(line)]), stroke: Object.freeze({ ...defaultStroke, weight: lineWeight, align: "center", join: "round", capStart: caps[0], capEnd: caps[1] }),
    board: Object.freeze({ type: "connector", ...c }) }) as unknown as VectorNode, page);
  placeRoute(ctx.draft, id, pts, c.routing);
  return id;
}
/** Native `connector_of`: the connector `id` names (a connector, or the label on one). */
function connectorOf(command: string, doc: Document, id: NodeId): [NodeId, Connector] {
  const n = doc.nodes[id] as Layer | undefined;
  if (!n) throw new Error("no such node " + id);
  const b = n.board;
  if (b?.type === "connector") { const { type: _t, ...c } = b; void _t; return [id, c]; }
  if (b?.type === "label") {
    const k = doc.nodes[b.connector] as Layer | undefined;
    if (k?.board?.type === "connector") { const { type: _t, ...c } = k.board; void _t; return [b.connector, c]; }
  }
  throw bad(command, "that isn't a connector");
}

/** Native `CONNECTED_GAP`: the room between an object and the next one `board.addConnected` makes. */
export const connectedGap = 80;
/** Native `connected_place`: where the next object goes on `side` of one (its top-left) and the sides the connector joins. */
export function connectedPlace([x, y]: readonly [number, number], [w, h]: readonly [number, number], [nw, nh]: readonly [number, number], side: string): [[number, number], Side, Side] | undefined {
  const cx = x + (w - nw) / 2, cy = y + (h - nh) / 2;
  switch (side) {
    case "right": return [[x + w + connectedGap, cy], "right", "left"];
    case "left": return [[x - connectedGap - nw, cy], "left", "right"];
    case "below": return [[cx, y + h + connectedGap], "bottom", "top"];
    case "above": return [[cx, y - connectedGap - nh], "top", "bottom"];
  }
  return undefined;
}
/** Native `pinned`: an end with the side it leaves by named (a reshaped path holds only as long as its ends do). */
const pinned = (end: End, side: Side | undefined): End => "node" in end && side ? { ...end, side } : end;

/** Native `STAMP_SIZE`, the stamps' labels, colours and marks (SVG path data on the badge's 40-unit box, filled or stroked). */
export const stampSize = 40;
const stampLabels: Record<Stamp, string> = { thumbsUp: "Thumbs up", heart: "Heart", plusOne: "Plus one", star: "Star", question: "Question", check: "Check" };
const stampColours: Record<Stamp, string> = { thumbsUp: "#3B82E8", heart: "#E5485F", plusOne: "#2EA063", star: "#EE9B1A", question: "#845ED8", check: "#14968C" };
const stampMarks: Record<Stamp, readonly (readonly [string, boolean])[]> = {
  thumbsUp: [["M10.5 19 H15 V29 H10.5 Z", true], ["M16.5 19 L20.6 11.4 C21.6 9.8 24.6 10.6 24.2 13 L23.4 17 H28.2 C29.8 17 30.9 18.5 30.4 20 L28.4 27.3 C28 28.4 27.1 29 25.9 29 H16.5 Z", true]],
  heart: [["M20 29.5 C12.5 24.5 9.5 20.6 10.4 16.4 C11.3 12.2 16.8 11.2 20 15.4 C23.2 11.2 28.7 12.2 29.6 16.4 C30.5 20.6 27.5 24.5 20 29.5 Z", true]],
  plusOne: [["M10 20 H20 M15 15 V25", false], ["M24.5 15 L27.5 12.5 V27.5", false]],
  star: [["M20 10.5 L22.8 16.7 L29.5 17.4 L24.5 21.9 L25.9 28.6 L20 25.2 L14.1 28.6 L15.5 21.9 L10.5 17.4 L17.2 16.7 Z", true]],
  question: [["M15.6 16.2 C15.6 10.6 24.4 10.6 24.4 16 C24.4 19.6 20 19.9 20 23.6", false], ["M18.2 28 A1.8 1.8 0 1 0 21.8 28 A1.8 1.8 0 1 0 18.2 28 Z", true]],
  check: [["M12.5 20.5 L18 26 L28 14.5", false]],
};
export const stampLabel = (s: Stamp) => stampLabels[s];
export const stampColour = (s: Stamp) => rgb(stampColours[s]);
/** Native `stamp_target`: the top-most layer of the page whose box holds `p`, other than stamps, connectors, labels, ink and `except`. */
export function stampTarget(doc: Document, page: NodeId, p: Pt, except?: NodeId): NodeId | undefined {
  const top = (doc.nodes[page] as Layer | undefined)?.children ?? [];
  for (let i = top.length - 1; i >= 0; i--) {
    const c = top[i], n = doc.nodes[c] as Layer | undefined;
    if (c === except || !n || (n as { visible?: boolean }).visible === false) continue;
    if (n.board && ["stamp", "connector", "label", "ink"].includes(n.board.type)) continue;
    const b = boundsOf(doc, [c]);
    if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return c;
  }
  return undefined;
}
/** Native `MARKER` and `HIGHLIGHTER`: (weight, opacity). */
export const marker = [4, 1] as const, highlighterStroke = [20, Math.fround(0.45)] as const;

/** Native `BRANCH` and `BRANCH_WEIGHT`. */
const branchColour = rgb("#757575"), branchWeight = 4;
/** Native `make_node`: a mind map node's frame hugging its one-line text. */
function makeMindNode(ctx: Ctx, parent: NodeId, at: readonly [number, number], text: string, root: boolean): [NodeId, NodeId] {
  const size = root ? mindRootSize : mindNodeSize, lineH = size * mindLineHeight / 100, id = alloc(ctx);
  ctx.draft.insert({ id, kind: "frame", name: "Mind map node", parent, x: at[0], y: at[1], width: mindMinW, height: lineH, fill: "transparent", children: Object.freeze([]), clip: false,
    layout: autoLayout({ mode: "horizontal", padding: [0, 0, 0, 0] }), sizing: Object.freeze({ horizontal: "hug", vertical: "hug" }),
    childLayout: Object.freeze({ minWidth: mindMinW, minHeight: lineH }), board: Object.freeze({ type: "mindNode" }) } as unknown as FrameNode, parent);
  const label = addText(ctx, id, text, size, ink, "left", 1), tn = ctx.draft.nodes[label] as TextNode;
  ctx.draft.set({ ...tn, textSizing: { horizontal: "hug", vertical: "hug" }, text: { ...tn.text, autoResize: "widthAndHeight", style: { ...tn.text.style,
    lineHeight: { unit: "percent", value: mindLineHeight }, letterSpacing: { unit: "percent", value: root ? mindRootTracking : mindNodeTracking }, fontStyle: root ? "Bold" : "Medium" } } } as DocumentNode);
  return [id, label];
}
/** Native `branch`: the curved branch from `parent` to `child` (on its left side when `left`). */
function makeBranch(ctx: Ctx, page: NodeId, parent: NodeId, child: NodeId, left: boolean): NodeId {
  const line = makeConnector(ctx, page, { from: { node: parent, side: left ? "left" : "right" }, to: { node: child, side: left ? "right" : "left" }, routing: "curved", branch: true }, ["round", "round"]);
  const n = ctx.draft.nodes[line] as Layer & { stroke: typeof defaultStroke };
  ctx.draft.set({ ...n, strokes: Object.freeze([solidPaint(branchColour)]), stroke: { ...n.stroke, weight: branchWeight } } as DocumentNode);
  return line;
}

/** Native unknown parameters (#1413): a name a command doesn't take is refused; `id` and `ids` are always taken. */
export function refuseUnknown(command: string, p: Record<string, unknown>, names: readonly string[]): void {
  const unknown = Object.keys(p).filter(k => !names.includes(k) && k !== "id" && k !== "ids");
  if (unknown.length) throw bad(command, (unknown.length === 1 ? "unknown parameter `" + unknown[0] + "`" : "unknown parameters " + unknown.map(k => "`" + k + "`").join(", ")) + " (it takes " + (names.length ? names.join(", ") : "none") + ")");
}
export interface BoardResult { readonly document: Document; readonly selection: readonly NodeId[]; readonly nextId: bigint; readonly result: Record<string, unknown>; readonly tool?: BoardTool }
/** Native `board.*` (this item's commands): `author` is the viewer's name (empty when unknown), `tool` the board tools' choices. */
export function executeBoard(command: BoardCommand, doc: Document, selection: readonly NodeId[], nextId: bigint, p: Record<string, unknown>, author: string, tool: BoardTool, view: { readonly cx: number; readonly cy: number } = { cx: 0, cy: 0 }): BoardResult {
  refuseUnknown(command, p, takes[command]);
  if (doc.kind !== "board") throw disabled(command, needsBoard);
  const ctx: Ctx = { draft: new HierarchyDraft(doc), next: nextId };
  const done = (sel: readonly NodeId[], result: Record<string, unknown>, nextTool?: BoardTool): BoardResult => ({ document: ctx.draft.finish(), selection: Object.freeze([...sel]), nextId: ctx.next, result, ...(nextTool && { tool: nextTool }) });
  switch (command) {
    case "board.sticky": {
      const fill = colourParam(command, p) ?? tool.sticky;
      const who = p.author === false ? "" : typeof p.author === "string" ? [...p.author.trim()].filter(c => c >= " " && c !== "\u007f").slice(0, 64).join("") : author;
      const parent = parentOf(command, doc, p);
      const text = typeof p.text === "string" ? p.text : "";
      const at = [finite(command, p, "x", 0), finite(command, p, "y", 0)] as const;
      let size = tool.stickySize;
      if (p.fontSize !== undefined && p.fontSize !== null) {
        if (typeof p.fontSize !== "number" || !Number.isFinite(p.fontSize) || p.fontSize < 1 || p.fontSize > 1000) throw bad(command, "`fontSize` is from 1 to 1000");
        size = p.fontSize;
      }
      const [id, note] = makeSticky(ctx, parent, at, text, fill, who, size);
      return done([id], { id: Number(id), text: Number(note) });
    }
    case "board.shape": {
      const shape = p.shape === undefined || p.shape === null ? tool.shape : shapeParam(command, p.shape);
      const size = (k: string) => {
        const v = p[k];
        if (v === undefined || v === null) return shapeSize;
        if (typeof v !== "number" || !(v >= 1 && v <= 100_000)) throw bad(command, "`" + k + "` is a size from 1 to 100000");
        return v;
      };
      const w = size("width"), h = size("height");
      const fill = colourParam(command, p) ?? tool.sticky;
      const parent = parentOf(command, doc, p);
      const at = [finite(command, p, "x", 0), finite(command, p, "y", 0)] as const;
      const [id, label] = makeShape(ctx, parent, at, [w, h], shape, typeof p.text === "string" ? p.text : "", fill);
      return done([id], { id: Number(id), text: Number(label) });
    }
    case "board.nextSticky": {
      const from = p.id !== undefined && p.id !== null ? parseNodeId(p.id) : selection[0] !== undefined ? ownerOfText(doc, selection[0]) ?? selection[0] : undefined;
      if (from === undefined) throw disabled(command, "select a sticky or a shape first");
      const n = doc.nodes[from] as DocumentNode & { board?: BoardItem; width: number; height: number; x: number; y: number };
      if (!n) throw new Error("no such node " + from);
      // A shape gets the next one joined to it, as the "+" beside it makes (#1597).
      if (n.board?.type === "shape") return executeBoard("board.addConnected", doc, selection, nextId, p, author, tool);
      if (n.board?.type !== "sticky") throw bad(command, "that isn't a sticky or a shape");
      const fill = solidOf(n) ?? tool.sticky;
      const side = p.side === undefined || p.side === null ? "right" : String(p.side);
      const offsets: Record<string, readonly [number, number]> = { right: [n.width + stickyGap, 0], left: [-(sticky + stickyGap), 0], below: [0, n.height + stickyGap], above: [0, -(sticky + stickyGap)] };
      const d = offsets[side];
      if (!d) throw bad(command, "`side` is right, below, left or above, not `" + side + "`");
      const [id, note] = makeSticky(ctx, n.parent!, [n.x + d[0], n.y + d[1]], "", fill, author, tool.stickySize);
      return done([id], { id: Number(id), text: Number(note) });
    }
    case "board.setColor": {
      const ids = targets(command, p, selection);
      const fill = colourParam(command, p);
      if (!fill) throw bad(command, "`color` is required");
      const changed: NodeId[] = [];
      for (const id of ids) {
        const n = ctx.draft.nodes[id] as DocumentNode & { board?: BoardItem; children?: readonly NodeId[] };
        const item = n?.board;
        if (!item) continue;
        if (item.type === "sticky") ctx.draft.set(withRectanglePaints(n as never, [solidPaint(fill)]));
        else if (item.type === "shape") {
          const outline = n.children?.[0], o = outline !== undefined ? ctx.draft.nodes[outline] : undefined;
          if (!o) continue;
          ctx.draft.set({ ...withRectanglePaints(o as VectorNode, [solidPaint(fill)]), strokes: Object.freeze([solidPaint(lineShade(fill))]) } as DocumentNode);
        } else if (item.type === "connector" || item.type === "ink") ctx.draft.set({ ...n, strokes: Object.freeze([solidPaint(lineShade(fill))]) } as DocumentNode);
        else continue;
        changed.push(id);
      }
      if (!changed.length) throw bad(command, "select stickies, shapes, connectors or ink");
      return done(selection, { ids: changed.map(Number) });
    }
    case "board.setStyle": {
      const ids = targets(command, p, selection);
      let size: number | undefined;
      if (p.fontSize !== undefined && p.fontSize !== null) {
        if (typeof p.fontSize !== "number" || !Number.isFinite(p.fontSize) || p.fontSize < 1 || p.fontSize > 1000) throw bad(command, "`fontSize` is from 1 to 1000");
        size = p.fontSize;
      }
      const shape = p.shape === undefined || p.shape === null ? undefined : shapeParam(command, p.shape);
      let routing: Routing | undefined;
      if (p.style !== undefined && p.style !== null) {
        const s = String(p.style).toLowerCase();
        if (s !== "straight" && s !== "elbow" && s !== "curved") throw bad(command, "`style` is straight, elbow or curved, not `" + String(p.style) + "`");
        routing = s;
      }
      const cap = (k: string): StrokeCap | undefined => {
        const v = p[k];
        if (v === undefined || v === null) return undefined;
        if (typeof v !== "string" || !caps.includes(v)) throw bad(command, "`" + k + "`: unknown cap");
        return v as StrokeCap;
      };
      const start = cap("startCap"), end = cap("endCap");
      const changed: NodeId[] = [];
      let stickySized = false;
      for (const id of ids) {
        const n = ctx.draft.nodes[id] as DocumentNode & { board?: BoardItem; children?: readonly NodeId[]; width: number; height: number; layout?: AutoLayout; stroke?: typeof defaultStroke };
        const item = n?.board;
        if (!item) continue;
        let did = false;
        if (item.type === "shape" && shape && shape !== item.shape) {
          ctx.draft.set({ ...n, board: { type: "shape", shape }, name: shapeLabel(shape), ...(n.layout && { layout: { ...n.layout, padding: shapePadding(shape, n.width, n.height) } }) } as DocumentNode);
          const o = n.children?.[0], on = o !== undefined ? ctx.draft.nodes[o] as VectorNode : undefined;
          if (on) ctx.draft.set({ ...on, kind: "vector", network: networkFromPath(shapePath(shape, n.width, n.height)), width: n.width, height: n.height, x: 0, y: 0, transform: undefined } as unknown as DocumentNode);
          did = true;
        }
        if (item.type === "connector" && (routing || start || end)) {
          const c = routing ? { ...item, routing, ...(item.path && item.routing === routing ? { path: item.path } : { path: undefined }) } : item;
          const { path, ...rest } = c as typeof item & { path?: unknown };
          const stroke = { ...((n.stroke as typeof defaultStroke | undefined) ?? defaultStroke), ...(start && { capStart: start }), ...(end && { capEnd: end }) };
          ctx.draft.set({ ...n, board: path === undefined ? rest : c, stroke } as DocumentNode);
          did = true;
        }
        if (size !== undefined && ["sticky", "shape", "label", "mindNode"].includes(item.type)) {
          const t = textOf(ctx.draft.document, id), tn = t !== undefined ? ctx.draft.nodes[t] as TextNode : undefined;
          if (tn) {
            ctx.draft.set({ ...tn, text: { ...tn.text, style: { ...tn.text.style, fontSize: size }, runs: tn.text.runs.map(r => ({ ...r, style: { ...r.style, fontSize: size } })) } } as DocumentNode);
            did = true;
            stickySized ||= item.type === "sticky";
          }
        }
        if (did) changed.push(id);
      }
      if (!changed.length) throw bad(command, "nothing selected takes these (stickies, shapes with text, connectors, labels)");
      return done(selection, { ids: changed.map(Number) }, stickySized && size !== undefined ? { ...tool, stickySize: size } : undefined);
    }
    case "board.connector": {
      const from = endParam(command, doc, p, ["from", "fromSide", "fromAt"]), to = endParam(command, doc, p, ["to", "toSide", "toAt"]);
      if ("node" in from && "node" in to && from.node === to.node) throw bad(command, "connect two different layers");
      let routing = tool.routing;
      if (p.style !== undefined && p.style !== null) {
        const st = String(p.style).toLowerCase();
        if (st !== "straight" && st !== "elbow" && st !== "curved") throw bad(command, "`style` is straight, elbow or curved, not `" + String(p.style) + "`");
        routing = st;
      }
      const cap = (k: string, fallback: StrokeCap): StrokeCap => {
        const v = p[k];
        if (v === undefined || v === null) return fallback;
        if (typeof v !== "string" || !caps.includes(v)) throw bad(command, "`" + k + "`: unknown cap");
        return v as StrokeCap;
      };
      const id = makeConnector(ctx, doc.currentPage, { from, to, routing }, [cap("startCap", defaultCaps[0]), cap("endCap", defaultCaps[1])]);
      const text = typeof p.label === "string" ? p.label : "";
      const label = text.trim() ? setLabel(ctx, id, text) : undefined;
      return done([id], { id: Number(id), ...(label !== undefined && { label: Number(label) }) });
    }
    case "board.reattach": {
      const target = (p.id !== undefined && p.id !== null ? [parseNodeId(p.id) ?? ""] : targets(command, p, selection))[0];
      if (target === undefined) throw bad(command, "select a connector");
      const [id, c] = connectorOf(command, doc, target);
      const which = p.end === "from" ? "from" : p.end === "to" ? "to" : undefined;
      if (!which) throw bad(command, "`end` is from or to");
      const end = endParam(command, doc, p, ["target", "side", "at"]), other = which === "from" ? c.to : c.from;
      if ("node" in end && "node" in other && end.node === other.node) throw bad(command, "connect two different layers");
      // A path shaped by hand was for where the end was.
      const { path: _path, ...rest } = c;
      void _path;
      const next: Connector = { ...rest, [which]: end };
      const pts = route(doc, next);
      if (!pts) throw bad(command, "the ends can't be placed");
      if (pts.every((q, i) => i === 0 || (q.x === pts[i - 1].x && q.y === pts[i - 1].y))) throw bad(command, "the ends are in the same place");
      ctx.draft.set({ ...ctx.draft.nodes[id], board: { type: "connector", ...next } } as DocumentNode);
      placeRoute(ctx.draft, id, pts, next.routing);
      return done(selection, { id: Number(id) });
    }
    case "board.reshape": {
      const target = (p.id !== undefined && p.id !== null ? [parseNodeId(p.id) ?? ""] : targets(command, p, selection))[0];
      if (target === undefined) throw bad(command, "select a connector");
      const [id, c] = connectorOf(command, doc, target);
      const num = (k: string) => { const v = p[k]; if (typeof v !== "number" || !Number.isFinite(v)) throw bad(command, "`" + k + "` is required"); return v; };
      const portion = num("portion"), x = num("x"), y = num("y");
      const refused = () => bad(command, "that connector has no such portion to move there");
      if (!(portion >= 0 && Number.isInteger(portion) && portion < 1e6)) throw refused();
      const ends = routeEnds(doc, c);
      const path = ends && reshaped(ends[0], ends[1], c.routing, c.path, portion, { x, y });
      if (!ends || !path) throw refused();
      const [s0, s1] = attachedSides(ends[0], ends[1]);
      const next: Connector = { from: pinned(c.from, s0), to: pinned(c.to, s1), routing: c.routing, path, ...(c.branch && { branch: true }) };
      const pts = route(doc, next);
      if (!pts) throw refused();
      ctx.draft.set({ ...ctx.draft.nodes[id], board: { type: "connector", ...next } } as DocumentNode);
      placeRoute(ctx.draft, id, pts, next.routing);
      return done(selection, { id: Number(id) });
    }
    case "board.addConnected": {
      const from = p.id !== undefined && p.id !== null ? parseNodeId(p.id) : selection[0] !== undefined ? ownerOfText(doc, selection[0]) ?? selection[0] : undefined;
      if (from === undefined) throw disabled(command, "select a sticky or a shape first");
      const n = doc.nodes[from] as Layer | undefined;
      if (!n) throw new Error("no such node " + from);
      const shape = n.board?.type === "shape" ? n.board.shape : undefined;
      if (n.board?.type !== "sticky" && !shape) throw bad(command, "that isn't a sticky or a shape");
      const side = p.side === undefined || p.side === null ? "right" : String(p.side);
      const parent = n.parent!;
      const next: [number, number] = shape ? [n.width, n.height] : [sticky, sticky];
      const fill = (shape ? (n.children?.[0] !== undefined ? solidOf(doc.nodes[n.children[0]]) : undefined) : solidOf(n)) ?? tool.sticky;
      const placed = connectedPlace([n.x, n.y], [n.width, n.height], next, side);
      if (!placed) throw bad(command, "`side` is right, below, left or above, not `" + side + "`");
      let [at, fromSide, toSide] = placed;
      // Dropped somewhere by hand: the next one is centred on that point of the page; the connector arrives by the side facing it.
      if (p.at !== undefined && p.at !== null) {
        const a = p.at;
        if (!Array.isArray(a) || a.length !== 2 || !a.every(v => typeof v === "number" && Number.isFinite(v))) throw bad(command, "`at` is [x, y] on the page, two finite numbers");
        const pw = doc.nodes[parent]?.kind === "page" ? [1, 0, 0, 1, 0, 0] as Affine : worldTransform(doc, parent);
        const local = transformPoint(inverse(pw), { x: a[0], y: a[1] });
        if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) throw bad(command, "`at` can't be placed in that parent");
        at = [local.x - next[0] / 2, local.y - next[1] / 2]; toSide = "auto";
      }
      const [id, text] = shape ? makeShape(ctx, parent, at, next, shape, "", fill) : makeSticky(ctx, parent, at, "", fill, author, tool.stickySize);
      const connector = makeConnector(ctx, doc.currentPage, { from: { node: from, side: fromSide }, to: { node: id, side: toSide }, routing: tool.routing }, defaultCaps);
      return done([id], { id: Number(id), text: Number(text), connector: Number(connector) });
    }
    case "board.stamp": {
      let stamp = tool.stamp;
      if (p.stamp !== undefined && p.stamp !== null) {
        const v = stampIds.find(x => x.toLowerCase() === String(p.stamp).toLowerCase());
        if (!v) throw bad(command, "unknown stamp `" + String(p.stamp) + "` (thumbsUp|heart|plusOne|star|question|check)");
        stamp = v;
      }
      const num = (k: string) => { const v = p[k]; if (typeof v !== "number" || !Number.isFinite(v)) throw bad(command, "`" + k + "` is required"); return v; };
      const x = num("x"), y = num("y"), half = stampSize / 2, page = doc.currentPage;
      // It sticks to the object it lands on (it moves with it).
      const on = stampTarget(doc, page, { x, y });
      const id = alloc(ctx);
      ctx.draft.insert(withRectanglePaints({ id, kind: "frame", name: stampLabels[stamp], parent: page, x: x - half, y: y - half, width: stampSize, height: stampSize, fill: "#000000",
        children: Object.freeze([]), corners: Object.freeze({ radii: Object.freeze([half, half, half, half]), smoothing: 0 }), effects: Object.freeze([softShadow()]), clip: false,
        board: Object.freeze({ type: "stamp", stamp, ...(author && { author }), ...(on !== undefined && { on }) }) } as unknown as FrameNode, [solidPaint(stampColour(stamp))]), page);
      for (const [d, filled] of stampMarks[stamp]) {
        const mark = { id: alloc(ctx), kind: "vector", name: "Mark", parent: id, x: 0, y: 0, width: stampSize, height: stampSize, fill: "transparent", network: networkFromPath(parseSvgPath(d)),
          // A new vector's stroke is centred (native `Node::new`), filled marks keep it and stroke nothing.
          ...(filled ? { stroke: Object.freeze({ ...defaultStroke, align: "center" }) } : { strokes: Object.freeze([solidPaint(colour(1, 1, 1, 1))]), stroke: Object.freeze({ ...defaultStroke, weight: 3, capStart: "round", capEnd: "round", join: "round", align: "center" }) }) } as unknown as VectorNode;
        ctx.draft.insert(filled ? withRectanglePaints(mark, [solidPaint(colour(1, 1, 1, 1))]) : mark, id);
      }
      return done([id], { id: Number(id) });
    }
    case "board.ink": {
      const high = p.highlighter === true;
      const fill = colourParam(command, p) ?? (high ? tool.highlighter : tool.marker);
      const [weight, opacity] = high ? highlighterStroke : marker;
      if (p.path === undefined && p.points === undefined) throw bad(command, "`path` or `points` is required");
      const hex = "#" + [fill.r, fill.g, fill.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
      const q: Record<string, unknown> = { type: "vector", parent: Number(doc.currentPage), closed: false, select: p.select !== false, name: high ? "Highlight" : "Ink",
        props: { fills: [], strokes: [hex], strokeWeight: weight, strokeCap: "round", strokeJoin: "round", strokeAlign: "center" } };
      if (p.path !== undefined) q.path = p.path;
      if (p.points !== undefined) q.points = p.points;
      const made = createLayer({ document: doc, selection }, nextId, "node.create", q, { cx: 0, cy: 0, zoom: 1, vw: 1, vh: 1 } as never);
      const draft = new HierarchyDraft(made.document), n = draft.nodes[made.id] as Layer;
      draft.set({ ...n, ...(opacity !== 1 && { opacity }), ...(high && { blend: "multiply" }), board: { type: "ink" } } as DocumentNode);
      return { document: draft.finish(), selection: made.selection, nextId: made.nextId, result: { id: Number(made.id) } };
    }
    case "board.table": {
      const tctx: TableCtx = { draft: ctx.draft, alloc: () => alloc(ctx), addText: (parent, text, size, align, width) => addText(ctx, parent, text, size, ink, align, width) };
      let given: string[][] = [];
      if (p.cells !== undefined && p.cells !== null) {
        if (!Array.isArray(p.cells)) throw bad(command, "`cells` is a list of rows, each a list of texts");
        given = p.cells.map(r => { if (!Array.isArray(r)) throw bad(command, "`cells` is a list of rows, each a list of texts"); return r.map(t => { if (typeof t !== "string") throw bad(command, "`cells` holds text"); return t; }); });
      }
      const widest = given.reduce((m, r) => Math.max(m, r.length), 0);
      const count = (k: string, fallback: number, max: number) => {
        const v = p[k];
        if (v === undefined) return fallback;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) throw bad(command, "`" + k + "` is a whole number from 1 to " + max);
        return v;
      };
      const rows = count("rows", given.length || 3, maxRows), columns = count("columns", widest || 3, maxColumns);
      if (given.length > rows || widest > columns) throw bad(command, "`cells` doesn't fit in " + rows + " × " + columns);
      const texts = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => given[r]?.[c] ?? ""));
      const w = 160 * columns, h = 40 * rows;
      const x = typeof p.x === "number" ? p.x : view.cx - w / 2, y = typeof p.y === "number" ? p.y : view.cy - h / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw bad(command, "`x` and `y` are finite numbers");
      const table = makeTable(tctx, doc.currentPage, [x, y], texts);
      return done([table], tableAnswer(ctx.draft.document, table));
    }
    case "board.tableEdit": {
      const tctx: TableCtx = { draft: ctx.draft, alloc: () => alloc(ctx), addText: (parent, text, size, align, width) => addText(ctx, parent, text, size, ink, align, width) };
      const target = p.id !== undefined && p.id !== null ? parseNodeId(p.id) : selection[0];
      if (target === undefined) throw disabled(command, "select a table");
      if (!doc.nodes[target]) throw new Error("no such node " + target);
      const table = tableOf(doc, target);
      if (table === undefined) throw bad(command, "that isn't a table");
      if (typeof p.action !== "string") throw bad(command, "`action` is required");
      let index: number | undefined;
      if (p.index !== undefined && p.index !== null) {
        if (typeof p.index !== "number" || !Number.isInteger(p.index) || p.index < 0) throw bad(command, "`index` is a whole number from 0");
        index = p.index;
      }
      editTable(tctx, table, p.action, index, m => bad(command, m));
      return done([table], tableAnswer(ctx.draft.document, table));
    }
    case "board.template": {
      const names = templates.map(t => t.id).join(", ");
      if (typeof p.name !== "string") throw bad(command, "`name` is one of " + names);
      const t = findTemplate(p.name);
      if (!t) throw bad(command, "no template `" + p.name + "`: one of " + names);
      const x = typeof p.x === "number" ? p.x : view.cx - t.size[0] / 2, y = typeof p.y === "number" ? p.y : view.cy - t.size[1] / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw bad(command, "`x` and `y` are finite numbers");
      // Built by running the board commands on the document as it goes: one undo step.
      const state = { doc, next: nextId };
      const made = buildTemplate(t.id, doc.currentPage, [x, y], {
        board: (c, q) => { const r = executeBoard(c as BoardCommand, state.doc, [], state.next, q, author, tool, view); state.doc = r.document; state.next = r.nextId; return r.result; },
        create: q => createOn(state, q),
      });
      return { document: state.doc, selection: Object.freeze(made.map(String)), nextId: state.next, result: { ids: made, name: t.id } };
    }
    case "board.mindMap": {
      const parent = parentOf(command, doc, p);
      // The view's centre is on the page and `x`/`y` are in the parent: a map in a section or frame takes the centre in its coordinates.
      const pw = doc.nodes[parent]?.kind === "page" ? [1, 0, 0, 1, 0, 0] as Affine : worldTransform(doc, parent), vc = transformPoint(inverse(pw), { x: view.cx, y: view.cy });
      const coord = (k: string, d: number) => { const v = p[k] === undefined ? d : p[k]; if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > mindMaxCoord) throw bad(command, "`" + k + "` is a position within a billion of the origin"); return v; };
      const x = coord("x", vc.x), y = coord("y", vc.y);
      let texts: string[] = [...mindStarters];
      if (p.children !== undefined) {
        if (!Array.isArray(p.children) || p.children.length > mindMaxStarters) throw bad(command, "`children` is a list of at most " + mindMaxStarters + " texts");
        texts = p.children.map(t => { if (typeof t !== "string") throw bad(command, "`children` holds texts"); return [...t].slice(0, mindMaxText).join(""); });
      }
      const rootText = typeof p.text === "string" ? [...p.text].slice(0, mindMaxText).join("") : mindRootText;
      const [root, label] = makeMindNode(ctx, parent, [x, y], rootText, true);
      // Anywhere below one another will do: the settling pass puts them right, in this order.
      const step = mindNodeSize * mindLineHeight / 100 + mindGapY;
      const children = texts.map((t, i) => {
        const [k, text] = makeMindNode(ctx, parent, [x + mindMinW + mindGapX, y + i * step], t, false);
        return { connector: Number(makeBranch(ctx, doc.currentPage, root, k, false)), id: Number(k), text: Number(text) };
      });
      return done([root], { children, id: Number(root), text: Number(label) });
    }
    case "board.mindMapAdd": {
      const from = p.id !== undefined && p.id !== null ? parseNodeId(p.id) : selection[0] !== undefined ? ownerOfText(doc, selection[0]) ?? selection[0] : undefined;
      if (from === undefined) throw disabled(command, "select a mind map node first");
      const n = doc.nodes[from] as Layer | undefined;
      if (!n) throw new Error("no such node " + from);
      if (n.board?.type !== "mindNode") throw bad(command, "that isn't a mind map node");
      const relation = p.relation === undefined || p.relation === null ? "child" : String(p.relation);
      if (relation !== "child" && relation !== "sibling") throw bad(command, "`relation` is child or sibling, not `" + relation + "`");
      const page = doc.currentPage, container = n.parent!;
      if (pageForNode(doc, from) !== page) throw bad(command, "that node is on another page");
      const bs = branchesOf(doc), at = boundsOf(doc, [from]);
      if (!at) throw bad(command, "that node has no place");
      const newH = mindNodeSize * mindLineHeight / 100;
      let parent: NodeId, left: boolean, topLeft: Pt;
      if (relation === "sibling") {
        const a = arriving(bs, from);
        if (!a) throw bad(command, "the first node has no siblings: add a child");
        // Its middle lands between this node and the next sibling, so the order puts it right after.
        parent = a.parent; left = a.left; topLeft = { x: at.x, y: at.y + at.height + mindGapY / 2 - newH / 2 };
      } else {
        left = mapSide(bs, from);
        const kids = mapChildren(doc, bs, from, left), last = kids.length ? boundsOf(doc, [kids[kids.length - 1]]) : undefined;
        const top = last ? last.y + last.height + mindGapY : at.y + at.height / 2 - newH / 2;
        parent = from; topLeft = { x: left ? at.x - mindGapX - mindMinW : at.x + at.width + mindGapX, y: top };
      }
      const cw = doc.nodes[container]?.kind === "page" ? [1, 0, 0, 1, 0, 0] as Affine : worldTransform(doc, container), local = transformPoint(inverse(cw), topLeft);
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) throw bad(command, "the new node can't be placed there");
      const text = typeof p.text === "string" ? [...p.text].slice(0, mindMaxText).join("") : "";
      const [node, label] = makeMindNode(ctx, container, [local.x, local.y], text, false);
      const line = makeBranch(ctx, page, parent, node, left);
      return done([node], { connector: Number(line), id: Number(node), text: Number(label) });
    }
    case "board.label": {
      const target = (p.id !== undefined && p.id !== null ? [parseNodeId(p.id) ?? ""] : targets(command, p, selection))[0];
      if (target === undefined) throw bad(command, "select a connector");
      const [id] = connectorOf(command, doc, target);
      if (typeof p.text !== "string") throw bad(command, "`text` is required");
      const label = setLabel(ctx, id, p.text);
      return done(selection, { id: Number(id), label: label === undefined ? null : Number(label) });
    }
  }
}

/** Native `settle_stamps`: a stamp moves with the object it sits on; one moved by itself sits on whatever is under its centre now; one whose
 * object is gone (or on another page) sits on nothing and stays. */
export function settleBoardStamps(doc: Document, before: Document): Document {
  if (doc.kind !== "board" || doc.nodes === before.nodes) return doc;
  const touched = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes)) if (doc.nodes[id] !== before.nodes[id]) touched.add(id);
  for (const id of Object.keys(before.nodes)) if (!doc.nodes[id]) touched.add(id);
  if (!touched.size) return doc;
  const hit = (id: NodeId) => touched.has(id) || ancestors(doc, id).some(a => touched.has(a));
  let draft: HierarchyDraft | undefined;
  for (const n of Object.values(doc.nodes) as Layer[]) {
    const b = n.board;
    if (b?.type !== "stamp") continue;
    const was = before.nodes[n.id] as Layer | undefined;
    const movedItself = touched.has(n.id) && !!was && (was.x !== n.x || was.y !== n.y || was.transform !== n.transform);
    const gone = b.on !== undefined && (!doc.nodes[b.on] || pageForNode(doc, b.on) !== pageForNode(doc, n.id));
    let now = b.on;
    if (movedItself) {
      const page = pageForNode(doc, n.id), box = boundsOf(doc, [n.id]);
      now = page !== undefined && box ? stampTarget(doc, page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, n.id) : undefined;
    } else if (gone) now = undefined;
    else if (b.on !== undefined && hit(b.on) && before.nodes[b.on] && !ancestors(doc, n.id).includes(b.on)) {
      // Carried by its object's move (the stamp itself neither turns nor scales).
      const c = boundsOf(doc, [n.id]), on = b.on;
      if (c) {
        const centre = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
        const there = transformPoint(worldTransform(doc, on), transformPoint(inverse(worldTransform(before, on)), centre));
        const d = { x: there.x - centre.x, y: there.y - centre.y };
        if (Number.isFinite(d.x) && Number.isFinite(d.y) && Math.hypot(d.x, d.y) > 1e-9) {
          draft ??= new HierarchyDraft(doc);
          const cur = draft.nodes[n.id] as Layer;
          draft.set({ ...cur, x: cur.x + d.x, y: cur.y + d.y } as DocumentNode);
        }
      }
    }
    if (now !== b.on) {
      draft ??= new HierarchyDraft(doc);
      const cur = draft.nodes[n.id] as Layer, { on: _o, ...rest } = b;
      void _o;
      draft.set({ ...cur, board: { ...rest, ...(now !== undefined && { on: now }) } } as DocumentNode);
    }
  }
  return draft ? draft.finish() : doc;
}

/** Native `settle_routes`: after layout, connectors run between their ends again (an end whose layer is gone stays where it was drawn, as
 * a point), one moved on its own takes its free ends along, and labels sit at their middles. Only what an edit can have moved is looked at. */
export function settleBoardRoutes(doc: Document, before: Document): Document {
  if (doc.kind !== "board" || doc.nodes === before.nodes) return doc;
  const touched = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes)) if (doc.nodes[id] !== before.nodes[id]) touched.add(id);
  for (const id of Object.keys(before.nodes)) if (!doc.nodes[id]) touched.add(id);
  if (!touched.size) return doc;
  const hit = (id: NodeId) => touched.has(id) || (doc.nodes[id] ? ancestors(doc, id).some(a => touched.has(a)) : false);
  const connectors: [NodeId, Connector][] = [], labels: [NodeId, NodeId][] = [];
  for (const n of Object.values(doc.nodes) as Layer[]) {
    const b = n.board;
    if (b?.type === "connector") {
      const ends = [b.from, b.to].flatMap(e => "node" in e ? [e.node] : []);
      if (hit(n.id) || ends.some(e => !doc.nodes[e] || hit(e))) { const { type: _t, ...c } = b; void _t; connectors.push([n.id, c]); }
    } else if (b?.type === "label") labels.push([n.id, b.connector]);
  }
  const draft = new HierarchyDraft(doc);
  const rerouted = new Set(connectors.map(([id]) => id));
  for (const [id, c0] of connectors) {
    let c = c0, changed = false;
    // Ends whose layer is gone (or on another page) stay where they are drawn, as points.
    const page = pageForNode(doc, id), now = endsNow(doc, id);
    const detach = (e: End, at: Pt | undefined): End => "node" in e && at && (!doc.nodes[e.node] || pageForNode(doc, e.node) !== page) ? (changed = true, { x: at.x, y: at.y }) : e;
    c = { ...c, from: detach(c.from, now?.[0]), to: detach(c.to, now?.[1]) };
    // Moved by itself (its place changed, not what it joins): its free ends move with it.
    const b = before.nodes[id] as Layer | undefined, n = doc.nodes[id] as Layer;
    if (b && touched.has(id) && (b.x !== n.x || b.y !== n.y || b.transform !== n.transform) && JSON.stringify(b.board) === JSON.stringify(n.board)) {
      const pts = route(doc, c), box = pts && pathBounds(routePath(pts, c.routing));
      const origin = transformPoint(worldTransform(doc, id), { x: 0, y: 0 });
      if (box) {
        const d = { x: origin.x - box.x, y: origin.y - box.y };
        if (Math.hypot(d.x, d.y) > 1e-9) {
          const carry = (e: End): End => "node" in e ? e : (changed = true, { x: e.x + d.x, y: e.y + d.y });
          c = { ...c, from: carry(c.from), to: carry(c.to) };
        }
      }
    }
    if (changed) draft.set({ ...draft.nodes[id], board: { type: "connector", ...c } } as DocumentNode);
    const pts = route(draft.document, c);
    if (pts) placeRoute(draft, id, pts, c.routing);
  }
  for (const [label, connector] of labels) if (rerouted.has(connector) || touched.has(connector) || hit(label)) placeLabel(draft, label, connector);
  return draft.finish();
}

/** Native `settle_text` (shapes): a resized shape with text keeps its text inside its outline's widest part. */
export function settleBoardText(doc: Document, before: Document): Document {
  if (doc.kind !== "board" || doc.nodes === before.nodes) return doc;
  let draft: HierarchyDraft | undefined;
  for (const n of Object.values(doc.nodes) as (DocumentNode & { board?: BoardItem; layout?: AutoLayout; width: number; height: number })[]) {
    if (n.board?.type !== "shape" || !n.layout) continue;
    const b = before.nodes[n.id] as typeof n | undefined;
    if (b && b.width === n.width && b.height === n.height) continue;
    const pad = shapePadding(n.board.shape, n.width, n.height);
    if (pad.every((v, i) => v === n.layout!.padding[i])) continue;
    draft ??= new HierarchyDraft(doc);
    draft.set({ ...n, layout: { ...n.layout, padding: pad } } as DocumentNode);
  }
  return draft ? draft.finish() : doc;
}
void ancestors;

/** Native board tool specs (`boards/board.rs`): the tool each chooses and what it remembers for the next press. */
export const boardToolIds = Object.freeze({ "tool.sticky": "sticky", "tool.shape": "shape", "tool.connector": "connector", "tool.marker": "marker",
  "tool.highlighter": "highlighter", "tool.eraser": "eraser", "tool.stamp": "stamp" } as const);
export type BoardToolCommand = keyof typeof boardToolIds;
export type BoardToolId = typeof boardToolIds[BoardToolCommand];
const toolTakes: Record<BoardToolCommand, readonly string[]> = { "tool.sticky": ["color"], "tool.shape": ["shape"], "tool.connector": ["style"], "tool.marker": ["color"],
  "tool.highlighter": ["color"], "tool.eraser": [], "tool.stamp": ["stamp"] };
/** Native `tool.sticky {color?}`, `tool.shape {shape?}`, `tool.connector {style?}`, `tool.marker`/`tool.highlighter {color?}`, `tool.eraser`, `tool.stamp {stamp?}`. */
export function boardToolCommand(command: BoardToolCommand, doc: Document, tool: BoardTool, p: Record<string, unknown>): BoardTool {
  refuseUnknown(command, p, toolTakes[command]);
  if (doc.kind !== "board") throw disabled(command, needsBoard);
  const text = (v: unknown) => v === undefined || v === null ? undefined : typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
  switch (command) {
    case "tool.sticky": { const c = colourParam(command, p); return c ? { ...tool, sticky: c } : tool; }
    case "tool.marker": { const c = colourParam(command, p); return c ? { ...tool, marker: c } : tool; }
    case "tool.highlighter": { const c = colourParam(command, p); return c ? { ...tool, highlighter: c } : tool; }
    case "tool.shape": { const v = text(p.shape); return v === undefined ? tool : { ...tool, shape: shapeParam(command, v) }; }
    case "tool.connector": {
      const v = text(p.style);
      if (v === undefined) return tool;
      if (v !== "straight" && v !== "elbow" && v !== "curved") throw bad(command, "`style` is straight, elbow or curved, not `" + v + "`");
      return { ...tool, routing: v };
    }
    case "tool.stamp": {
      const v = text(p.stamp);
      if (v === undefined) return tool;
      const s = stampIds.find(x => x.toLowerCase() === v.toLowerCase());
      if (!s) throw bad(command, "unknown stamp `" + v + "` (thumbsUp|heart|plusOne|star|question|check)");
      return { ...tool, stamp: s };
    }
    case "tool.eraser": return tool;
  }
}
/** Native `STICKY` and `SHAPE`: a placed sticky's and shape's size, centred on the press. */
export const stickySide = 200, shapeSide = 160;

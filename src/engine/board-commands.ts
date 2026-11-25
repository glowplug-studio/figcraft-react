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

/** Source: upstream engine/src/boards/board.rs and board/{items,edit}.rs: stickies and shapes with text, their colours and styles. */
export const boardSpecs = Object.freeze({
  "board.sticky": { label: "Sticky note", undo: true },
  "board.nextSticky": { label: "Next sticky note", undo: true },
  "board.shape": { label: "Shape with text", undo: true },
  "board.setColor": { label: "Board color", undo: true },
  "board.setStyle": { label: "Board style", undo: true },
});
export type BoardCommand = keyof typeof boardSpecs;
const takes: Record<BoardCommand, readonly string[]> = {
  "board.sticky": ["x", "y", "text", "color", "fontSize", "author", "parent"],
  "board.nextSticky": ["id", "side", "edit"],
  "board.shape": ["shape", "x", "y", "width", "height", "text", "color", "parent"],
  "board.setColor": ["ids", "color"],
  "board.setStyle": ["ids", "shape", "fontSize", "style", "startCap", "endCap"],
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

export interface BoardResult { readonly document: Document; readonly selection: readonly NodeId[]; readonly nextId: bigint; readonly result: Record<string, unknown>; readonly tool?: BoardTool }
/** Native `board.*` (this item's commands): `author` is the viewer's name (empty when unknown), `tool` the board tools' choices. */
export function executeBoard(command: BoardCommand, doc: Document, selection: readonly NodeId[], nextId: bigint, p: Record<string, unknown>, author: string, tool: BoardTool): BoardResult {
  const unknown = Object.keys(p).filter(k => !takes[command].includes(k));
  if (unknown.length) throw bad(command, (unknown.length === 1 ? "unknown parameter `" : "unknown parameters ") + (unknown.length === 1 ? unknown[0] + "`" : unknown.map(k => "`" + k + "`").join(", ")) + " (it takes " + takes[command].join(", ") + ")");
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
      if (n.board?.type === "shape") throw disabled(command, "the next shape joined to this one comes with connectors");
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
  }
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

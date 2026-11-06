import { arrangementTargets, moveWorld } from "./arrange";
import { layerTransform, withLayerTransform, type Document, type NodeId } from "./document";
import { pixelRound, type Point, type Rectangle } from "./geometry";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { boundsOf } from "./viewport";

export interface Track { readonly ids: readonly NodeId[]; readonly bounds: Rectangle; readonly anchor: Rectangle }
export interface SpacingAxis { readonly tracks: readonly Track[]; readonly vertical: boolean; readonly value?: number }
export interface SelectionSpacing { readonly horizontal?: SpacingAxis; readonly vertical?: SpacingAxis }
export interface ReorderLayout { readonly slots: readonly { id: NodeId; box: Rectangle }[]; readonly columns: number; readonly rows: number; readonly gapX: number; readonly gapY: number }
export const smartSpecs = Object.freeze({
  "arrange.spacing": { label: "Spacing", undo: true },
  "arrange.reorder": { label: "Reorder selection", undo: true },
  "arrange.roundToPixels": { label: "Round to pixels", undo: true },
});
const EPS = 0.01;
export const axisStart = (box: Rectangle, vertical: boolean) => vertical ? box.y : box.x;
export const axisEnd = (box: Rectangle, vertical: boolean) => vertical ? box.y + box.height : box.x + box.width;
function union(a: Rectangle, b: Rectangle): Rectangle {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
function axis(items: readonly { id: NodeId; box: Rectangle }[], vertical: boolean): SpacingAxis | undefined {
  const sorted = [...items].sort((a, b) => axisStart(a.box, vertical) - axisStart(b.box, vertical) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  const tracks: { ids: NodeId[]; bounds: Rectangle; anchor: Rectangle }[] = [];
  for (const { id, box } of sorted) {
    const lo = axisStart(box, vertical), hi = axisEnd(box, vertical);
    const aligned = tracks.find(track => {
      const a = axisStart(track.anchor, vertical), z = axisEnd(track.anchor, vertical);
      return Math.abs(lo - a) <= EPS || Math.abs(hi - z) <= EPS || Math.abs((lo + hi - a - z) * .5) <= EPS;
    });
    if (aligned) { aligned.ids.push(id); aligned.bounds = union(aligned.bounds, box); }
    else tracks.push({ ids: [id], bounds: box, anchor: box });
  }
  if (tracks.length < 2) return;
  tracks.sort((a, b) => axisStart(a.bounds, vertical) - axisStart(b.bounds, vertical));
  const low = Math.max(...tracks.map(track => axisStart(track.bounds, !vertical))), high = Math.min(...tracks.map(track => axisEnd(track.bounds, !vertical)));
  if (high - low <= EPS) return;
  const gaps = tracks.slice(1).map((track, index) => axisStart(track.bounds, vertical) - axisEnd(tracks[index].bounds, vertical));
  return { tracks, vertical, value: gaps.every(gap => Math.abs(gap - gaps[0]) <= EPS) ? gaps[0] : undefined };
}

export function selectionSpacing(document: Document, ids: readonly NodeId[]): SelectionSpacing {
  const first = document.nodes[ids[0]];
  if (!first || ids.length < 2 || ids.length > 2000) return {};
  const items: { id: NodeId; box: Rectangle }[] = [], seen = new Set<NodeId>();
  for (const id of ids) {
    let node = document.nodes[id];
    if (!node || node.kind === "page" || node.parent !== first.parent) return {};
    for (;;) {
      if (node.kind !== "page" && (node.visible === false || node.locked === true)) return {};
      if (node.parent === null) break;
      node = document.nodes[node.parent];
    }
    const parent = worldTransform(document, first.parent!);
    const determinant = parent[0] * parent[3] - parent[1] * parent[2];
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return {};
    let box: Rectangle | undefined;
    try { box = boundsOf(document, [id]); } catch { return {}; }
    if (!box || !Object.values(box).every(Number.isFinite) || box.width <= EPS || box.height <= EPS) return {};
    if (!seen.has(id)) { items.push({ id, box }); seen.add(id); }
  }
  return { horizontal: axis(items, false), vertical: axis(items, true) };
}

export function spacingOffsets(axis: SpacingAxis, value: number): Map<NodeId, number> {
  let at = axisStart(axis.tracks[0].bounds, axis.vertical);
  const offsets = new Map<NodeId, number>();
  for (const track of axis.tracks) {
    const delta = at - axisStart(track.bounds, axis.vertical);
    for (const id of track.ids) offsets.set(id, delta);
    at += axisEnd(track.bounds, axis.vertical) - axisStart(track.bounds, axis.vertical) + value;
  }
  return offsets;
}

export function reorderLayout(document: Document, ids: readonly NodeId[], layout = selectionSpacing(document, ids)): ReorderLayout | undefined {
  const h = layout.horizontal, v = layout.vertical, columns = h?.tracks.length ?? 1, rows = v?.tracks.length ?? 1;
  const gapX = h ? h.value : 0, gapY = v ? v.value : 0;
  if (gapX === undefined || gapY === undefined || gapX < 0 || gapY < 0 || ids.length < 2 || columns * rows !== ids.length) return;
  const slots: { id: NodeId; box: Rectangle }[] = [];
  for (const id of ids) {
    const col = h ? h.tracks.findIndex(track => track.ids.includes(id)) : 0, row = v ? v.tracks.findIndex(track => track.ids.includes(id)) : 0;
    if (col < 0 || row < 0 || slots[row * columns + col]) return;
    const box = boundsOf(document, [id]); if (!box) return;
    if (columns > 1 && rows > 1 && (Math.abs(box.x - h!.tracks[col].bounds.x) > EPS || Math.abs(box.y - v!.tracks[row].bounds.y) > EPS)) return;
    slots[row * columns + col] = { id, box };
  }
  return { slots, columns, rows, gapX, gapY };
}

export function reorderPositions(layout: ReorderLayout, source: NodeId, target: NodeId, swap: boolean): Map<NodeId, Point> | undefined {
  const from = layout.slots.findIndex(slot => slot.id === source), to = layout.slots.findIndex(slot => slot.id === target);
  if (from < 0 || to < 0) return;
  if (from === to) return new Map(layout.slots.map(({ id, box }) => [id, { x: box.x, y: box.y }]));
  const order = [...layout.slots];
  if (swap) [order[from], order[to]] = [order[to], order[from]];
  else order.splice(to, 0, order.splice(from, 1)[0]);
  const widths: number[] = Array(layout.columns).fill(0), heights: number[] = Array(layout.rows).fill(0);
  order.forEach(({ box }, index) => {
    const col = index % layout.columns, row = Math.floor(index / layout.columns);
    widths[col] = Math.max(widths[col], box.width); heights[row] = Math.max(heights[row], box.height);
  });
  const starts = (sizes: number[], at: number, gap: number) => sizes.map(size => { const previous = at; at += size + gap; return previous; });
  const xs = starts(widths, Math.min(...layout.slots.map(slot => slot.box.x)), layout.gapX), ys = starts(heights, Math.min(...layout.slots.map(slot => slot.box.y)), layout.gapY);
  return new Map(order.map(({ id, box }, index) => [id, { x: layout.columns === 1 ? box.x : xs[index % layout.columns], y: layout.rows === 1 ? box.y : ys[Math.floor(index / layout.columns)] }]));
}

/** Fixed base tracks support absolute previews even when the new gap crosses other tracks. */
export function executeSmartSelection(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>, base = document): Document {
  const allowed = ["id", "ids", ...(command === "arrange.spacing" ? ["horizontal", "vertical", "fromGesture"] : command === "arrange.reorder" ? ["source", "target", "swap", "fromGesture"] : [])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const ids = arrangementTargets(document, selection, params, false), draft = new HierarchyDraft(document);
  if (command === "arrange.roundToPixels") {
    for (const id of ids) {
      const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Round layers, not pages");
      const m = layerTransform(node), x = pixelRound(m[4]), y = pixelRound(m[5]);
      const width = Math.max(node.width > 0 ? 1 : 0, pixelRound(node.width)), height = Math.max(node.height > 0 ? 1 : 0, pixelRound(node.height));
      if (x !== m[4] || y !== m[5] || width !== node.width || height !== node.height) draft.set({ ...withLayerTransform(node, [m[0], m[1], m[2], m[3], x, y]), width, height });
    }
  } else if (command === "arrange.reorder") {
    const layout = reorderLayout(base, ids), source = parseNodeId(params.source), target = parseNodeId(params.target);
    if (!layout) throw new Error("Select a regular row, column or complete aligned grid");
    const positions = source !== undefined && target !== undefined ? reorderPositions(layout, source, target, parseBoolean(params.swap) === true) : undefined;
    if (!positions) throw new Error("Source and target must belong to the selection");
    for (const [id, point] of positions) {
      const now = boundsOf(draft.document, [id])!, dx = point.x - now.x, dy = point.y - now.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("Non-finite reorder result");
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) moveWorld(draft, id, dx, dy);
    }
  } else if (command === "arrange.spacing") {
    const layout = selectionSpacing(base, ids), moves = new Map<NodeId, { dx?: number; dy?: number }>();
    let any = false;
    for (const key of ["horizontal", "vertical"] as const) {
      if (!Object.hasOwn(params, key)) continue;
      const value = parseNumber(params[key], key), axis = layout[key];
      if (Math.abs(value) > 1e6) throw new Error("Spacing out of range");
      if (!axis) throw new Error("Selection has no spacing on this axis");
      any = true;
      for (const [id, delta] of spacingOffsets(axis, value)) {
        if (!Number.isFinite(delta)) throw new Error("Non-finite spacing result");
        moves.set(id, { ...moves.get(id), [key === "horizontal" ? "dx" : "dy"]: delta });
      }
    }
    if (!any) throw new Error("Pass horizontal or vertical spacing");
    for (const [id, delta] of moves) {
      const before = boundsOf(base, [id])!, now = boundsOf(draft.document, [id])!;
      moveWorld(draft, id, delta.dx === undefined ? 0 : before.x + delta.dx - now.x, delta.dy === undefined ? 0 : before.y + delta.dy - now.y);
    }
  } else throw new Error(`Unsupported smart-selection command: ${command}`);
  draft.normaliseGroups();
  return validateChangedGeometry(draft);
}

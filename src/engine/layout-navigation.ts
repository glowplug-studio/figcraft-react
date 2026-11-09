import { layerTransform, type Document, type FrameNode, type LayerNode, type NodeId } from "./document";
import { multiply, transformBounds } from "./affine";
import { placeGridCells } from "./grid-placement";
import type { Point, Rectangle } from "./geometry";
import { worldTransform, type HierarchyDraft } from "./hierarchy";
import { boundsOf } from "./viewport";

type Direction = { horizontal: boolean; forward: boolean };
type FlowBox = { id: NodeId; index: number; box: Rectangle };
type Guide = readonly [number, number, number, number];

export function flowingParent(doc: Document, id: NodeId): FrameNode | undefined {
  const n = doc.nodes[id];
  if (!n || n.kind === "page" || n.visible === false || n.childLayout?.absolute) return;
  const p = doc.nodes[n.parent];
  return p.kind === "frame" && p.layout ? p : undefined;
}

const flip = (r: Rectangle, vertical: boolean) => (vertical ? { x: r.y, y: r.x, width: r.height, height: r.width } : r);
function flowBoxes(doc: Document, ids: readonly NodeId[], vertical: boolean): FlowBox[] {
  if (!ids.length) return [];
  const parent = worldTransform(doc, doc.nodes[ids[0]].parent!);
  const translated = parent[0] === 1 && parent[1] === 0 && parent[2] === 0 && parent[3] === 1;
  return ids.map((id, index) => {
    const n = doc.nodes[id] as LayerNode;
    const box = translated && !n.transform
      ? {x: parent[4]+n.x, y: parent[5]+n.y, width: n.width, height: n.height}
      : transformBounds(multiply(parent, layerTransform(n)), n.width, n.height);
    return {id, index, box: flip(box, vertical)};
  });
}

function wrapRows(items: FlowBox[]) {
  const rows: FlowBox[][] = [];
  for (const item of items) {
    const row = rows.at(-1),
      prev = row?.at(-1)?.box,
      b = item.box;
    if (row && prev && b.x >= prev.x - 0.5 && !(b.x < prev.x + prev.width - 0.5 && b.y >= prev.y + prev.height - 0.5))
      row.push(item);
    else rows.push([item]);
  }
  return rows;
}

export function autoLayoutSlot(
  doc: Document,
  frame: FrameNode,
  point: Point,
  exclude: ReadonlySet<NodeId>,
): { index: number; line?: Guide } {
  const vertical = frame.layout?.mode === "vertical",
    x = vertical ? point.y : point.x,
    y = vertical ? point.x : point.y;
  const kids = frame.children.filter((id) => !exclude.has(id));
  const placed = kids.flatMap((id, index) => (flowingParent(doc, id) ? [{ id, index }] : []));
  const boxes = flowBoxes(
    doc,
    placed.map((item) => item.id),
    vertical,
  );
  if (!boxes.length) return { index: kids.length };
  let candidates = boxes,
    lo = 0,
    hi = 0;
  const wrap = frame.layout?.wrap && frame.layout.mode !== "grid";
  if (wrap) {
    let nearest = Infinity;
    for (const row of wrapRows(boxes)) {
      const low = row.reduce((a, b) => Math.min(a, b.box.y), Infinity),
        high = row.reduce((a, b) => Math.max(a, b.box.y + b.box.height), -Infinity);
      const distance = Math.max(0, low - y, y - high);
      if (distance < nearest) {
        nearest = distance;
        candidates = row;
        lo = low;
        hi = high;
      }
    }
  }
  const before = candidates.find((item) => x < item.box.x + item.box.width / 2),
    item = before ?? candidates.at(-1)!;
  const at = before ? item.box.x - 2 : item.box.x + item.box.width + 2,
    index = item.index + (before ? 0 : 1);
  if (!wrap) {
    lo = item.box.y;
    hi = lo + item.box.height;
  }
  return { index: placed[index]?.index ?? kids.length, line: vertical ? [lo, at, hi, at] : [at, lo, at, hi] };
}

function writeFlow(draft: HierarchyDraft, parent: FrameNode, order: NodeId[]) {
  const ids = new Set(order);
  let pos = 0;
  draft.set({ ...parent, children: Object.freeze(parent.children.map((id) => (ids.has(id) ? order[pos++] : id))) });
}

function moveAlong(
  draft: HierarchyDraft,
  parent: FrameNode,
  flow: NodeId[],
  block: ReadonlySet<NodeId>,
  forward: boolean,
) {
  const order = [...flow],
    step = forward ? 1 : -1;
  let moved = false;
  for (let i = forward ? order.length - 2 : 1; i >= 0 && i < order.length; i -= step) {
    const j = i + step;
    if (block.has(order[i]) && !block.has(order[j])) {
      [order[i], order[j]] = [order[j], order[i]];
      moved = true;
    }
  }
  if (moved) writeFlow(draft, parent, order);
  return moved;
}

function moveRow(draft: HierarchyDraft, parent: FrameNode, flow: NodeId[], block: NodeId[], forward: boolean) {
  const vertical = parent.layout!.mode === "vertical",
    rows = wrapRows(flowBoxes(draft.document, flow, vertical));
  const lead = forward ? block.at(-1)! : block[0],
    target = rows[rows.findIndex((row) => row.some((item) => item.id === lead)) + (forward ? 1 : -1)];
  if (!target) return false;
  const selection = flip(boundsOf(draft.document, block)!, vertical),
    centre = selection.x + selection.width / 2,
    excluded = new Set(block);
  let nearest: NodeId | undefined,
    best = Infinity;
  for (const { id, box } of target) {
    const distance = Math.abs(box.x + box.width / 2 - centre);
    if (!excluded.has(id) && distance < best) {
      nearest = id;
      best = distance;
    }
  }
  if (!nearest) return false;
  const order = flow.filter((id) => !excluded.has(id)),
    at = order.indexOf(nearest) + (forward ? 1 : 0);
  writeFlow(draft, parent, [...order.slice(0, at), ...block, ...order.slice(at)]);
  return true;
}

function moveGrid(draft: HierarchyDraft, parent: FrameNode, block: NodeId[], dir: Direction) {
  let moved = false;
  const delta = dir.forward ? 1 : -1,
    dc = dir.horizontal ? delta : 0,
    dr = dir.horizontal ? 0 : delta;
  const anchored = (id: NodeId) => {
    const props = (draft.nodes[id] as LayerNode).childLayout;
    return props?.gridColumn !== undefined || props?.gridRow !== undefined;
  };
  const pin = (id: NodeId, c: number, r: number) => {
    const n = draft.nodes[id] as LayerNode;
    draft.set({ ...n, childLayout: Object.freeze({ ...n.childLayout, gridColumn: c, gridRow: r }) });
  };
  for (const id of dir.forward ? [...block].reverse() : block) {
    const frame = draft.nodes[parent.id] as FrameNode,
      { cells, rows } = placeGridCells(draft.document, frame),
      cell = cells.get(id);
    if (!cell) continue;
    const c = cell.column + dc,
      r = cell.row + dr;
    if (c < 0 || r < 0 || c + cell.columnSpan > Math.max(1, frame.layout!.gridColumns) || r + cell.rowSpan > rows)
      continue;
    const x = c + (dc > 0 ? cell.columnSpan - 1 : 0),
      y = r + (dr > 0 ? cell.rowSpan - 1 : 0);
    let occupant: NodeId | undefined;
    for (const [other, b] of cells)
      if (other !== id && x >= b.column && x < b.column + b.columnSpan && y >= b.row && y < b.row + b.rowSpan) {
        occupant = other;
        break;
      }
    if (occupant && !anchored(id) && !anchored(occupant)) {
      const order = frame.children.filter((k) => k !== id && flowingParent(draft.document, k));
      order.splice(order.indexOf(occupant) + (dir.forward ? 1 : 0), 0, id);
      writeFlow(draft, frame, order);
    } else {
      if (occupant && anchored(occupant)) pin(occupant, cell.column, cell.row);
      pin(id, c, r);
    }
    moved = true;
  }
  return moved;
}

function moveNeighbour(draft: HierarchyDraft, parent: FrameNode, block: NodeId[], dir: Direction) {
  const doc = draft.document,
    outer = flowingParent(doc, parent.id);
  if (!outer || outer.layout!.mode !== (dir.horizontal ? "horizontal" : "vertical")) return;
  const siblings = outer.children.filter((id) => flowingParent(doc, id)),
    next = siblings[siblings.indexOf(parent.id) + (dir.forward ? 1 : -1)],
    dest = doc.nodes[next];
  if (dest?.kind !== "frame" || !dest.layout || dest.layout.mode === "grid" || dest.locked) return;
  const b = boundsOf(doc, [next])!,
    s = boundsOf(doc, block)!;
  const edge = (lo: number, length: number) =>
    dir.forward ? lo + Math.min(0.5, length) : lo + length - Math.min(0.5, length);
  const level = (centre: number, lo: number, length: number) => Math.max(lo, Math.min(lo + length, centre - 0.5));
  const probe = dir.horizontal
    ? { x: edge(b.x, b.width), y: level(s.y + s.height / 2, b.y, b.height) }
    : { x: level(s.x + s.width / 2, b.x, b.width), y: edge(b.y, b.height) };
  const { index } = autoLayoutSlot(doc, dest, probe, new Set(block));
  block.forEach((child, k) => draft.reparent(child, next, index + k));
}

export function nudgeFlow(draft: HierarchyDraft, selection: readonly NodeId[], dx: number, dy: number) {
  for (const [horizontal, units] of [
    [true, dx],
    [false, dy],
  ] as const) {
    if (!Number.isFinite(units) || !units) continue;
    const forward = units > 0,
      dir = { horizontal, forward },
      groups = new Map<NodeId, Set<NodeId>>();
    for (const id of selection) {
      const parent = flowingParent(draft.document, id);
      if (!parent) continue;
      let set = groups.get(parent.id);
      if (!set) groups.set(parent.id, (set = new Set()));
      set.add(id);
    }
    for (const [parentId, chosen] of [...groups].sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
      const parent = draft.nodes[parentId] as FrameNode,
        layout = parent.layout!,
        flow = parent.children.filter((id) => flowingParent(draft.document, id));
      const block = flow.filter((id) => chosen.has(id));
      if (!block.length) continue;
      let moved = false;
      if (layout.mode === "grid") moved = moveGrid(draft, parent, block, dir);
      else if ((layout.mode === "horizontal") === horizontal) moved = moveAlong(draft, parent, flow, chosen, forward);
      else if (layout.wrap) moved = moveRow(draft, parent, flow, block, forward);
      if (!moved) moveNeighbour(draft, parent, block, dir);
    }
  }
}

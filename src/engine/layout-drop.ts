import { inverse, multiply, transformBounds, transformPoint } from "./affine";
import { moveWorld } from "./arrange";
import { dragParent } from "./canvas-selection";
import { isFrameLike, isGroupLike, type Document, type FrameLikeNode, type NodeId } from "./document";
import type { Point, Rectangle } from "./geometry";
import { cellRect, gridGeometry } from "./grid-layout";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import { autoLayoutSlot } from "./layout-navigation";
import { boundsOf } from "./viewport";

export interface MoveDrop {
  target: NodeId;
  outline?: NodeId;
  inFlow: boolean;
  cell?: Rectangle;
  line?: readonly [Point, Point];
}

function nearestTrack(tracks: readonly (readonly [number, number])[], coordinate: number) {
  let nearest = 0, distance = Infinity;
  for (const [i, [start, end]] of tracks.entries()) {
    const gap = Math.max(0, start - coordinate, coordinate - end);
    if (gap < distance) { nearest = i; distance = gap; }
  }
  return nearest;
}

function gridCellAt(document: Document, frame: FrameLikeNode, point: Point) {
  const grid = gridGeometry(document, frame);
  const matrix = worldTransform(document, frame.id), local = transformPoint(inverse(matrix), point);
  const column = nearestTrack(grid.columns, local.x), row = nearestTrack(grid.rows, local.y);
  const box = cellRect(grid, {column, row, columnSpan: 1, rowSpan: 1});
  const rect = transformBounds(multiply(matrix, [1, 0, 0, 1, box.x, box.y]), box.width, box.height);
  return {column, row, rect};
}

/** The drag preview and its insertion indicator both use the original gesture geometry. */
export function placeMove(draft: HierarchyDraft, moving: readonly NodeId[], delta: Point, point: Point) {
  const doc = draft.document, home = doc.nodes[moving[0]].parent!;
  const flow = !isGroupLike(doc.nodes[home]) && moving.every(id => {
    const node = doc.nodes[id];
    return node.kind !== "page" && !node.childLayout?.absolute;
  });
  const target = flow ? dragParent(doc, point, moving) : home;
  const frame = doc.nodes[target];
  const drop: MoveDrop = { target, inFlow: false, outline: flow && target !== doc.currentPage ? target : undefined };
  if (flow && isFrameLike(frame) && frame.layout) {
    const layout = frame.layout;
    const cell = layout.mode === "grid" ? gridCellAt(doc, frame, point) : undefined;
    const excluded = new Set(moving);
    const slot = cell ? undefined : autoLayoutSlot(doc, frame, point, excluded);
    for (const id of moving) if (draft.nodes[id].parent !== target) draft.reparent(id, target);
    if (cell) {
      const first = draft.nodes[moving[0]];
      if (first.kind !== "page") draft.set({...first, childLayout: Object.freeze({...first.childLayout, gridColumn: cell.column, gridRow: cell.row})});
      drop.cell = cell.rect;
    } else if (slot) {
      const children = frame.children.filter(id => !excluded.has(id));
      children.splice(slot.index, 0, ...moving);
      draft.set({...frame, children: Object.freeze(children)});
    }
    drop.inFlow = true;
    if (target === home) drop.outline = undefined;
  } else {
    for (const id of moving) {
      const parent = draft.nodes[draft.nodes[id].parent!];
      if (flow && isFrameLike(parent) && parent.layout) draft.reparent(id, doc.currentPage);
      moveWorld(draft, id, delta.x, delta.y);
    }
  }
  draft.normaliseGroups();
  const document = draft.finish();
  if (drop.inFlow && !drop.cell && isFrameLike(frame) && frame.layout) {
    const box = boundsOf(document, moving)!;
    const offset = Math.max(3, Math.min(24, frame.layout.gap / 2));
    drop.line = frame.layout.mode === "vertical"
      ? [{x: box.x, y: box.y - offset}, {x: box.x + box.width, y: box.y - offset}]
      : [{x: box.x - offset, y: box.y}, {x: box.x - offset, y: box.y + box.height}];
  }
  return {document, drop};
}

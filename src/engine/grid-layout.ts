import { transformBounds } from "./affine";
import { layerSizing, type GridTrack } from "./auto-layout";
import { layerTransform, type Document, type FrameNode, type LayerNode } from "./document";
import { placeGridCells, type GridCell } from "./grid-placement";
import { defaultStroke, hasVisibleStroke } from "./stroke";

export function frameInsets(frame: FrameNode): readonly [number, number, number, number] {
  const layout = frame.layout!, stroke = frame.stroke ?? defaultStroke;
  const inside = layout.strokesIncluded && hasVisibleStroke(frame) && stroke.align === "inside";
  const inset = (i: number) => Math.max(0, layout.padding[i]) + (inside ? Math.max(0, stroke.sides?.[i] ?? stroke.weight) : 0);
  return [inset(0), inset(1), inset(2), inset(3)];
}

export function outerBox(node: LayerNode) {
  const [a,b,c,d] = layerTransform(node);
  return transformBounds([a,b,c,d,0,0], node.width, node.height);
}

export function clampSize(value: number, min?: number, max?: number) {
  return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number.isFinite(value) ? Math.max(0, value) : 0));
}

function resolveAxis(tracks: readonly GridTrack[], count: number, gap: number, hug: boolean, room: number,
  offset: number, requirements: readonly {index: number; span: number; size: number}[]) {
  const sizing = (i: number) => tracks[i]?.sizing ?? "fill";
  const value = (i: number) => Math.min(1e6, Math.max(0, tracks[i]?.value ?? 1));
  const sizes = Array.from({length: count}, (_, i) => sizing(i) === "fixed" ? value(i) : 0);
  for (const {index, span, size} of requirements)
    if (span === 1 && sizing(index) !== "fixed") sizes[index] = Math.max(size, sizes[index]);

  for (const {index, span, size} of requirements) {
    if (span === 1) continue;
    const growing: number[] = [];
    let room = gap * (span - 1), flexible = false;
    for (let i = index; i < index + span; i++) {
      room += sizes[i];
      flexible ||= sizing(i) === "fill";
      if (sizing(i) !== "fixed") growing.push(i);
    }
    if (size > room && growing.length && (hug || !flexible)) {
      const extra = (size - room) / growing.length;
      for (const i of growing) sizes[i] += extra;
    }
  }

  if (!hug) {
    let free = room - gap * (count - 1);
    let flexible: number[] = [];
    for (let i = 0; i < count; i++) {
      if (sizing(i) === "fill") flexible.push(i);
      else free -= sizes[i];
    }
    while (flexible.length) {
      const fractions = flexible.reduce((sum, i) => sum + value(i), 0);
      const unit = fractions > 1e-12 ? Math.max(0, free) / fractions : 0;
      const open: number[] = [];
      for (const i of flexible) {
        if (unit * value(i) >= sizes[i]) open.push(i);
        else free -= sizes[i];
      }
      if (open.length === flexible.length) {
        for (const i of open) sizes[i] = unit * value(i);
        break;
      }
      flexible = open;
    }
  }
  let start = offset;
  const ranges = sizes.map(size => {
    const range = [start, start + size] as const;
    start += size + gap;
    return range;
  });
  return {ranges, extent: sizes.reduce((sum, size) => sum + size, 0) + gap * (count - 1)};
}

export function gridGeometry(document: Document, frame: FrameNode) {
  const layout = frame.layout!, grid = placeGridCells(document, frame);
  const [top,right,bottom,left] = frameInsets(frame);
  const sizing = layerSizing(frame);
  const hugW = sizing.horizontal === "hug", hugH = sizing.vertical === "hug";
  type Requirement = {index: number; span: number; size: number};
  const widths: Requirement[] = [], heights: Requirement[] = [];
  for (const [id, cell] of grid.cells) {
    const node = document.nodes[id] as LayerNode, child = layerSizing(node), box = outerBox(node);
    widths.push({index: cell.column, span: cell.columnSpan,
      size: child.horizontal === "fill" && !hugW ? node.childLayout?.minWidth ?? 0 : box.width});
    heights.push({index: cell.row, span: cell.rowSpan,
      size: child.vertical === "fill" && !hugH ? node.childLayout?.minHeight ?? 0 : box.height});
  }
  const x = resolveAxis(layout.columnTracks, grid.columns, Math.max(0, layout.gap), hugW, frame.width-left-right, left, widths);
  const y = resolveAxis(layout.rowTracks, grid.rows, Math.max(0, layout.crossGap), hugH, frame.height-top-bottom, top, heights);
  const limits = frame.childLayout;
  return {columns: x.ranges, rows: y.ranges, cells: grid.cells,
    width: Math.max(left+right, clampSize(hugW ? x.extent+left+right : frame.width, limits?.minWidth, limits?.maxWidth)),
    height: Math.max(top+bottom, clampSize(hugH ? y.extent+top+bottom : frame.height, limits?.minHeight, limits?.maxHeight))};
}

export function cellRect(grid: ReturnType<typeof gridGeometry>, cell: GridCell) {
  const x = grid.columns[cell.column][0], y = grid.rows[cell.row][0];
  return {x, y, width: Math.max(0, grid.columns[cell.column+cell.columnSpan-1][1]-x),
    height: Math.max(0, grid.rows[cell.row+cell.rowSpan-1][1]-y)};
}

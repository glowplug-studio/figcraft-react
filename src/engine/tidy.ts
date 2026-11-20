import type { Document, NodeId } from "./document";
import type { Rectangle } from "./geometry";
import { rootIds } from "./hierarchy";
import { boundsOf } from "./viewport";

// Native `selection/tidy.rs`: the moves that even a selection's gaps. The order and the sizes of every layer are
// kept and the first layer stays where it is. Rows are the groups of layers whose Y ranges overlap (transitively),
// columns the groups whose X ranges overlap. A row's horizontal gaps are evened and every Y kept; a column is the
// mirror image. A grid (two or more of each, one layer in every cell) is packed along the axis with more groups.

const eps = .01, maxLayers = 2000;
interface Item { readonly id: NodeId; readonly box: Rectangle }
export interface TidyMove { readonly id: NodeId; readonly dx: number; readonly dy: number }
type Shape = { readonly grid: boolean; readonly vertical: boolean };

const span = (b: Rectangle, vertical: boolean): readonly [number, number] => vertical ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
const byStart = (vertical: boolean) => (a: Item, b: Item) => span(a.box, vertical)[0] - span(b.box, vertical)[0];

/** Columns (`vertical` false) or rows: the layers whose ranges on the axis overlap, transitively, in order. */
function groups(items: readonly Item[], vertical: boolean): Item[][] {
  const out: Item[][] = [];
  let end = -Number.MAX_VALUE;
  for (const item of [...items].sort(byStart(vertical))) {
    const [lo, hi] = span(item.box, vertical), group = out.at(-1);
    if (group && lo < end - eps) { group.push(item); end = Math.max(end, hi); }
    else { out.push([item]); end = hi; }
  }
  return out;
}
/** Layers that share a group must overlap each other pairwise on the other axis, not merely sit in the same band. */
function overlapping(group: readonly Item[], vertical: boolean): boolean {
  return group.every((a, i) => group.slice(i + 1).every(b => {
    const p = span(a.box, !vertical), q = span(b.box, !vertical);
    return Math.min(p[1], q[1]) - Math.max(p[0], q[0]) > eps;
  }));
}
const onePerCell = (cols: readonly Item[][], rows: readonly Item[][]) =>
  cols.every(c => rows.every(r => c.filter(a => r.some(b => b.id === a.id)).length === 1));
function classify(items: readonly Item[]): Shape | undefined {
  const cols = groups(items, false), rows = groups(items, true);
  if (rows.length === 1 && cols.length >= 2 && cols.every(g => overlapping(g, false))) return { grid: false, vertical: false };
  if (cols.length === 1 && rows.length >= 2 && rows.every(g => overlapping(g, true))) return { grid: false, vertical: true };
  if (cols.length >= 2 && rows.length >= 2 && onePerCell(cols, rows)) return { grid: true, vertical: rows.length > cols.length };
  return undefined;
}
function available(document: Document, ids: readonly NodeId[], min: number): { items: Item[]; shape: Shape } | undefined {
  const roots = rootIds(document, ids.filter(id => document.nodes[id]));
  if (roots.length < min || roots.length > maxLayers) return undefined;
  const items: Item[] = [];
  for (const id of roots) {
    const node = document.nodes[id]; if (!node || node.kind === "page") return undefined;
    const parent = node.parent ? document.nodes[node.parent] : undefined;
    // The frame places the layers of its flow.
    if (parent && "layout" in parent && parent.layout && !node.childLayout?.absolute) return undefined;
    const box = boundsOf(document, [id]);
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return undefined;
    items.push({ id, box });
  }
  const shape = classify(items);
  return shape && { items, shape };
}

/** The one gap an axis is evened to: `spacing`, a single gap, the most common gap (the smaller of two equally
 * common ones), else the mean rounded to a whole number, half up. */
function evenGap(gaps: readonly number[], spacing: number | undefined): number {
  if (spacing !== undefined) return spacing;
  if (gaps.length === 1) return gaps[0];
  if (!gaps.length) return 0;
  const count = (g: number) => gaps.filter(o => Math.abs(o - g) <= eps).length;
  let best: readonly [number, number] | undefined;
  for (const g of gaps) { const n = count(g); if (!best || n > best[0] || n === best[0] && g < best[1]) best = [n, g]; }
  return best && best[0] >= 2 ? best[1] : Math.floor(gaps.reduce((a, b) => a + b, 0) / gaps.length + .5 + 1e-9);
}
/** The even gap of a line, raised so that every layer starts strictly after the end of the layer two places before
 * it, and the second layer after the first. */
function raiseNegativeGap(gap: number, widths: readonly number[]): number {
  if (widths.length < 3) return gap;
  const narrowest = Math.min(...widths.slice(1, -1)), first = widths[0];
  if (!Number.isFinite(narrowest) || !Number.isFinite(first)) return gap;
  return Math.max(gap, Math.floor(-narrowest / 2) + 1, Math.floor(-first) + 1);
}
/** A row or a column: the first layer stays, each next one follows the last at the even gap. */
function lineMoves(items: readonly Item[], vertical: boolean, spacing: number | undefined): TidyMove[] {
  const line = [...items].sort(byStart(vertical));
  const gaps = line.slice(1).map((item, i) => span(item.box, vertical)[0] - span(line[i].box, vertical)[1]);
  const widths = line.map(item => span(item.box, vertical)[1] - span(item.box, vertical)[0]);
  const gap = spacing ?? raiseNegativeGap(evenGap(gaps, undefined), widths);
  let at = line.length ? span(line[0].box, vertical)[0] : 0;
  return line.map(({ id, box }) => {
    const [lo, hi] = span(box, vertical), d = at - lo;
    at += hi - lo + gap;
    return vertical ? { id, dx: 0, dy: d } : { id, dx: d, dy: 0 };
  });
}
const snapTo = (value: number, snap: boolean) => snap ? Math.floor(value + .5) : value;
/** A grid packed in units (columns, or rows when `vertical`): the units are evened around where they were, every
 * layer is centred in its unit and each unit is laid out from the selection's start on the other axis. */
function gridMoves(units: readonly Item[][], vertical: boolean, spacing: number | undefined, snap: boolean): TidyMove[] {
  const boxes = units.map(unit => {
    const starts = unit.map(i => span(i.box, vertical)[0]), ends = unit.map(i => span(i.box, vertical)[1]);
    const width = Math.max(0, ...unit.map(i => span(i.box, vertical)[1] - span(i.box, vertical)[0]));
    return { start: (Math.min(...starts) + Math.max(...ends)) / 2 - width / 2, width };
  });
  const sorted = units.map(unit => [...unit].sort(byStart(!vertical)));
  const between = evenGap(boxes.slice(1).map((b, i) => b.start - (boxes[i].start + boxes[i].width)), spacing);
  const within = evenGap(sorted.flatMap(unit => unit.slice(1).map((item, i) => span(item.box, !vertical)[0] - span(unit[i].box, !vertical)[1])), spacing);
  const start = Math.min(...units.flat().map(i => span(i.box, !vertical)[0]));
  let at = boxes.length ? snapTo(boxes[0].start, snap) : 0;
  const out: TidyMove[] = [];
  sorted.forEach((unit, index) => {
    let position = start;
    for (const { id, box } of unit) {
      const [lo, hi] = span(box, vertical), [lo2, hi2] = span(box, !vertical);
      const main = snapTo(at + (boxes[index].width - (hi - lo)) / 2, snap) - lo, cross = position - lo2;
      position += hi2 - lo2 + within;
      out.push(vertical ? { id, dx: cross, dy: main } : { id, dx: main, dy: cross });
    }
    at += boxes[index].width + between;
  });
  return out;
}

/** Whether Tidy up is offered: three to 2,000 layers with boxes, none in an auto layout flow, forming a row, a
 * column or a grid. */
export function canTidy(document: Document, ids: readonly NodeId[]): boolean {
  return available(document, ids, 3) !== undefined;
}
/** The page-space moves that tidy `ids`: empty when unavailable or when nothing would move. `spacing` sets the gap
 * and lets two layers through; `snap` rounds a grid's positions along its packing axis to whole pixels. */
export function tidyMoves(document: Document, ids: readonly NodeId[], spacing: number | undefined, snap: boolean): TidyMove[] {
  const found = available(document, ids, spacing === undefined ? 3 : 2); if (!found) return [];
  const moves = found.shape.grid ? gridMoves(groups(found.items, found.shape.vertical), found.shape.vertical, spacing, snap) : lineMoves(found.items, found.shape.vertical, spacing);
  return moves.filter(m => !Number.isFinite(m.dx) || !Number.isFinite(m.dy) || Math.abs(m.dx) > 1e-9 || Math.abs(m.dy) > 1e-9);
}

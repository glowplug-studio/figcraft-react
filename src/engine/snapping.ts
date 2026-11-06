import { isLeaf } from "./document";
import { identity, inverse, multiply, transformBounds, transformPoint, type Affine } from "./affine";
import type { Document, NodeId } from "./document";
import { pixelRound, type Point, type Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { ancestorIds } from "./canvas-selection";

export interface Guide { x0: number; y0: number; x1: number; y1: number; label?: string; dashed?: boolean }
type Span = readonly [number, number, number];
type Gap = readonly [number, number, number];
const right = (b: Rectangle) => b.x + b.width, bottom = (b: Rectangle) => b.y + b.height;
const shifted = (b: Rectangle, d: Point): Rectangle => ({ ...b, x: b.x + d.x, y: b.y + d.y });
const linear = (m: Affine, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });
export const distanceLabel = (distance: number): string => String(pixelRound(Math.abs(distance) * 100) / 100);
/** Point snapping ignores moving bounds. Reuse only while every target and ancestor is unchanged. */
export class PointSnapCache {
  #cached?: { parent: NodeId; page: NodeId; dependencies: readonly NodeId[]; document: Document; targets: SnapTargets };
  constructor(private ids: readonly NodeId[]) {}
  get(document: Document): SnapTargets {
    const parent = document.nodes[this.ids[0]]?.parent ?? document.currentPage, old = this.#cached;
    if (old && old.parent === parent && old.page === document.currentPage && old.dependencies.every(id => document.nodes[id] === old.document.nodes[id])) return old.targets;
    const container = document.nodes[parent], moving = new Set(this.ids);
    const dependencies = [parent, ...ancestorIds(document, parent), ...(container && !isLeaf(container) ? container.children.filter(id => !moving.has(id)) : [])];
    const targets = new SnapTargets(document, this.ids); this.#cached = { parent, page: document.currentPage, dependencies, document, targets }; return targets;
  }
}
function spans(b: Rectangle): [Span[], Span[]] {
  return [[b.x, b.x + b.width / 2, right(b)].map(x => [x, b.y, bottom(b)]), [b.y, b.y + b.height / 2, bottom(b)].map(y => [y, b.x, right(b)])];
}
/** Captured once per gesture; source corresponds to native canvas/snap::Targets. */
export class SnapTargets {
  readonly xs: Span[] = [];
  readonly ys: Span[] = [];
  readonly boxes: Rectangle[] = [];
  readonly space: Affine;
  readonly toSpace: Affine;
  readonly moving?: Rectangle;
  constructor(document: Document, moving: readonly NodeId[]) {
    const parentId = document.nodes[moving[0]]?.parent ?? document.currentPage;
    const parent = document.nodes[parentId], world = worldTransform(document, parentId);
    this.space = parentId !== document.currentPage && !(Math.abs(world[1]) < 1e-7 && Math.abs(world[2]) < 1e-7) ? world : identity;
    this.toSpace = inverse(this.space);
    const box = (id: NodeId): Rectangle | undefined => {
      const node = document.nodes[id];
      return node && node.kind !== "page" ? transformBounds(multiply(this.toSpace, worldTransform(document, id)), node.width, node.height) : undefined;
    };
    let union: Rectangle | undefined;
    for (const id of moving) {
      const b = box(id); if (!b) continue;
      if (!union) union = b;
      else { const x = Math.min(union.x, b.x), y = Math.min(union.y, b.y); union = { x, y, width: Math.max(right(union), right(b)) - x, height: Math.max(bottom(union), bottom(b)) - y }; }
    }
    this.moving = union;
    if (parentId !== document.currentPage) { const b = box(parentId); if (b) { const [xs, ys] = spans(b); this.xs.push(...xs); this.ys.push(...ys); } }
    if (parent && !isLeaf(parent)) for (const id of parent.children) {
      const node = document.nodes[id];
      if (moving.includes(id) || !node || node.kind === "page" || node.visible === false) continue;
      const b = box(id); if (b) this.addBox(b);
    }
  }
  addBox(box: Rectangle): void { const [xs, ys] = spans(box); this.xs.push(...xs); this.ys.push(...ys); this.boxes.push(box); }
  removeBox(box: Rectangle): void {
    const [xs, ys] = spans(box);
    for (const [list, remove] of [[this.xs, xs], [this.ys, ys]]) for (const s of remove) {
      for (let index = list.length - 1; index >= 0; index--) if (list[index].every((v, i) => v === s[i])) { list.splice(index, 1); break; }
    }
    for (let index = this.boxes.length - 1; index >= 0; index--) {
      const b = this.boxes[index];
      if (b.x === box.x && b.y === box.y && b.width === box.width && b.height === box.height) { this.boxes.splice(index, 1); break; }
    }
  }
  #spacings(box: Rectangle, horizontal: boolean): { delta: number; gaps: Gap[] }[] {
    const transpose = (b: Rectangle): Rectangle => horizontal ? b : { x: b.y, y: b.x, width: b.height, height: b.width };
    const r = transpose(box), row = this.boxes.map(transpose).filter(b => b.y < bottom(r) && bottom(b) > r.y);
    const before = row.filter(b => b.x + b.width / 2 < r.x + r.width / 2).sort((a, b) => right(b) - right(a));
    const after = row.filter(b => b.x + b.width / 2 >= r.x + r.width / 2).sort((a, b) => a.x - b.x);
    const middle = (a: Rectangle, b: Rectangle) => (Math.max(a.y, b.y) + Math.min(bottom(a), bottom(b))) / 2;
    const out: { delta: number; gaps: Gap[] }[] = [], [l, l2] = before, [n, n2] = after;
    if (l && n && n.x - right(l) > r.width) {
      const x = (right(l) + n.x - r.width) / 2;
      out.push({ delta: x - r.x, gaps: [[right(l), x, middle(l, r)], [x + r.width, n.x, middle(r, n)]] });
    }
    if (l && l2 && l.x > right(l2)) {
      const x = right(l) + l.x - right(l2);
      out.push({ delta: x - r.x, gaps: [[right(l2), l.x, middle(l2, l)], [right(l), x, middle(l, r)]] });
    }
    if (n && n2 && n2.x > right(n)) {
      const x = n.x - (n2.x - right(n)) - r.width;
      out.push({ delta: x - r.x, gaps: [[x + r.width, n.x, middle(r, n)], [right(n), n2.x, middle(n, n2)]] });
    }
    return out.filter(v => Number.isFinite(v.delta));
  }
  #guides(box: Rectangle, spacing = true): Guide[] {
    const guides: Guide[] = [], [xs, ys] = spans(box);
    for (const [targets, values, vertical] of [[this.xs, xs, true], [this.ys, ys, false]] as const) for (const [v, a, b] of values) {
      const hits = targets.filter(([line]) => Math.abs(line - v) < 1e-6);
      if (!hits.length) continue;
      let lo = a, hi = b;
      for (const [, x, y] of hits) { lo = Math.min(lo, x); hi = Math.max(hi, y); }
      lo = Math.max(-1e6, lo); hi = Math.min(1e6, hi);
      guides.push(vertical ? { x0: v, y0: lo, x1: v, y1: hi } : { x0: lo, y0: v, x1: hi, y1: v });
    }
    for (const horizontal of spacing ? [true, false] : []) for (const { delta, gaps } of this.#spacings(box, horizontal)) {
      if (Math.abs(delta) >= 1e-6) continue;
      for (const [from, to, across] of gaps) {
        const g = horizontal ? { x0: from, y0: across, x1: to, y1: across, label: distanceLabel(to - from) } : { x0: across, y0: from, x1: across, y1: to, label: distanceLabel(to - from) };
        if (!guides.some(other => JSON.stringify(other) === JSON.stringify(g))) guides.push(g);
      }
    }
    return guides.map(g => { const a = transformPoint(this.space, { x: g.x0, y: g.y0 }), b = transformPoint(this.space, { x: g.x1, y: g.y1 }); return { ...g, x0: a.x, y0: a.y, x1: b.x, y1: b.y }; });
  }
  snapPoint(point: Point, threshold: number): { point: Point; guides: Guide[] } {
    const q = transformPoint(this.toSpace, point);
    const nearest = (lines: Span[], value: number): number => {
      let delta: number | undefined;
      for (const [line] of lines) { const d = line - value; if (Math.abs(d) <= threshold && (delta === undefined || Math.abs(d) < Math.abs(delta))) delta = d; }
      return value + (delta ?? 0);
    };
    const x = nearest(this.xs, q.x), y = nearest(this.ys, q.y);
    // A point supplies one span per axis, so coincident generated guides are deduplicated.
    const guides = this.#guides({ x, y, width: 0, height: 0 }, false).filter((g, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(g)) === i);
    return { point: transformPoint(this.space, { x, y }), guides };
  }
  snapMove(delta: Point, threshold: number): { correction: Point; guides: Guide[] } {
    if (!this.moving) return { correction: { x: 0, y: 0 }, guides: [] };
    const r = shifted(this.moving, linear(this.toSpace, delta)), [xs, ys] = spans(r);
    const nearest = (targets: Span[], values: Span[], horizontal: boolean): number => {
      let best: number | undefined;
      for (const [line] of targets) for (const [value] of values) {
        const d = line - value; if (Math.abs(d) <= threshold && (best === undefined || Math.abs(d) < Math.abs(best))) best = d;
      }
      let equal: number | undefined;
      for (const { delta } of this.#spacings(r, horizontal)) if (Math.abs(delta) <= threshold && (equal === undefined || Math.abs(delta) < Math.abs(equal))) equal = delta;
      if (equal !== undefined && (best === undefined || Math.abs(equal) < Math.abs(best))) best = equal;
      return best ?? 0;
    };
    const correction = { x: nearest(this.xs, xs, true), y: nearest(this.ys, ys, false) };
    return { correction: linear(this.space, correction), guides: this.#guides(shifted(r, correction)) };
  }
  roundMove(delta: Point): Point {
    if (!this.moving) return delta;
    const local = linear(this.toSpace, delta), b = this.moving;
    return linear(this.space, { x: pixelRound(b.x + local.x) - b.x, y: pixelRound(b.y + local.y) - b.y });
  }
}

import { identity, type Affine } from "./affine";
import { cubicPoint } from "./cubic";
import { isLeaf, type Document, type NodeId } from "./document";
import { pixelRound, type Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { SnapTargets, type Guide } from "./snapping";
import { vectorNetwork, type VectorEditPart } from "./vector-edit";
import { networkCubic } from "./vector-network";

const MAX_POINTS = 20_000, MAX_NODES = 200_000, MAX_MOVING = 256;

/** Native Pen hover cache: immutable document/page, edited layer and initial extra points. */
export class PenSnapCache {
  #cached?: { document: Document; edited?: NodeId; extra: readonly Point[]; targets: VectorPointTargets };
  targets(document: Document, edited?: NodeId, extra: readonly Point[] = []): VectorPointTargets {
    const old = this.#cached;
    if (old && old.document === document && old.edited === edited && old.extra.length === extra.length && old.extra.every((p, i) => p.x === extra[i].x && p.y === extra[i].y)) return old.targets;
    const targets = new VectorPointTargets(document, edited, [], [], extra);
    this.#cached = { document, edited, extra: extra.map(p => ({ ...p })), targets }; return targets;
  }
  clear(): void { this.#cached = undefined; }
}
const pagePoint = (w: Affine, p: Point): Point => ({ x: w[0] * p.x + w[2] * p.y + w[4], y: w[1] * p.x + w[3] * p.y + w[5] });
type Line = { value: number; order: number; lo: number; hi: number };
/** Sorted distinct coordinates avoid rescanning every layer per moving point. Original order
 * remains the tie-breaker, matching native target-first iteration. */
class AxisIndex {
  readonly lines: readonly Line[];
  constructor(spans: readonly (readonly [number, number, number])[]) {
    const unique = new Map<number, Line>();
    spans.forEach(([value, lo, hi], order) => {
      if (!Number.isFinite(value)) return;
      const old = unique.get(value);
      if (old) { old.lo = Math.min(old.lo, lo); old.hi = Math.max(old.hi, hi); }
      else unique.set(value, { value, order, lo, hi });
    });
    this.lines = [...unique.values()].sort((a, b) => a.value - b.value);
  }
  lower(value: number): number {
    let lo = 0, hi = this.lines.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.lines[mid].value < value) lo = mid + 1; else hi = mid; }
    return lo;
  }
  best(points: readonly Point[], axis: "x" | "y", threshold: number): number | undefined {
    let delta: number | undefined, order = Infinity, pointIndex = Infinity;
    points.forEach((p, index) => {
      const at = this.lower(p[axis]);
      for (const line of [this.lines[at - 1], this.lines[at]]) {
        if (!line) continue;
        const d = line.value - p[axis], size = Math.abs(d), previous = Math.abs(delta ?? Infinity);
        if (size <= threshold && (size < previous || size === previous && (line.order < order || line.order === order && index < pointIndex))) { delta = d; order = line.order; pointIndex = index; }
      }
    });
    return delta;
  }
  span(value: number, across: number): readonly [number, number] | undefined {
    let lo = across, hi = across, found = false;
    for (let i = this.lower(value - 1e-6); i < this.lines.length && this.lines[i].value <= value + 1e-6; i++) {
      const line = this.lines[i]; if (Math.abs(line.value - value) >= 1e-6) continue;
      found = true; lo = Math.min(lo, line.lo); hi = Math.max(hi, line.hi);
    }
    return found ? [Math.max(-1e6, lo), Math.min(1e6, hi)] : undefined;
  }
}

/** Captured page-space targets, preserving native candidate and tie ordering. */
export class VectorPointTargets {
  readonly layers: SnapTargets;
  readonly points: Point[] = [];
  readonly #xs: AxisIndex;
  readonly #ys: AxisIndex;
  readonly #pointXs: readonly Point[];
  constructor(document: Document, edited: NodeId | undefined, moving: readonly number[], others: readonly Pick<VectorEditPart, "id" | "vertices">[] = [], extra: readonly Point[] = []) {
    this.layers = new SnapTargets(document, edited ? [edited] : [], identity);
    let budget = MAX_POINTS;
    const add = (p: Point): void => {
      this.layers.xs.push([p.x, p.y, p.y]); this.layers.ys.push([p.y, p.x, p.x]); this.points.push(p);
    };
    for (const p of extra.slice(0, budget)) add(p);
    budget = Math.max(0, budget - extra.length);
    const vector = (id: NodeId, indices: readonly number[]): void => {
      if (!budget) return;
      const net = vectorNetwork(document, id); if (!net) return;
      const skip = new Set(indices), w = worldTransform(document, id);
      const put = (p: Point): void => { if (budget && Number.isFinite(p.x) && Number.isFinite(p.y)) { add(p); budget--; } };
      for (let i = 0; i < net.vertices.length && budget; i++) if (!skip.has(i)) put(pagePoint(w, net.vertices[i]));
      for (let i = 0; i < net.segments.length && budget; i++) {
        const s = net.segments[i]; if (skip.has(s.a) || skip.has(s.b)) continue;
        const c = networkCubic(net, i); if (c) put(pagePoint(w, cubicPoint(c, .5)));
      }
    };
    if (edited) vector(edited, moving);
    const page = document.nodes[document.currentPage], stack = page && !isLeaf(page) ? [...page.children] : [];
    const skipById = new Map(others.map(p => [p.id, p.vertices])); let visited = 0;
    while (stack.length && visited++ < MAX_NODES && budget) {
      const id = stack.pop()!, node = document.nodes[id]; if (!node || node.kind === "page" || node.visible === false) continue;
      if (node.kind === "vector" && id !== edited) vector(id, skipById.get(id) ?? []);
      if (!isLeaf(node)) for (const child of node.children) stack.push(child);
    }
    this.#xs = new AxisIndex(this.layers.xs); this.#ys = new AxisIndex(this.layers.ys);
    this.#pointXs = this.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  }
  #hasPoint(p: Point): boolean {
    let lo = 0, hi = this.#pointXs.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.#pointXs[mid].x < p.x - 1e-6) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < this.#pointXs.length && this.#pointXs[i].x <= p.x + 1e-6; i++) {
      const t = this.#pointXs[i]; if (Math.hypot(t.x - p.x, t.y - p.y) < 1e-6) return true;
    }
    return false;
  }
  snap(points: readonly Point[], grab: Point | undefined, zoom: number, objects: boolean, pixel: boolean, lock?: boolean): { correction: Point; guides: Guide[] } {
    const pts = points.slice(0, MAX_MOVING), threshold = 5 / Math.max(zoom, 1e-6);
    const x = objects ? this.#xs.best(pts, "x", threshold) : undefined, y = objects ? this.#ys.best(pts, "y", threshold) : undefined;
    const correction = { x: x ?? 0, y: y ?? 0 };
    if (pixel && grab && Number.isFinite(grab.x) && Number.isFinite(grab.y)) {
      if (x === undefined) correction.x = pixelRound(grab.x) - grab.x;
      if (y === undefined) correction.y = pixelRound(grab.y) - grab.y;
    }
    if (lock === true) correction.y = 0; else if (lock === false) correction.x = 0;
    const guides: Guide[] = [];
    if (objects) {
      const at = pts.map(p => ({ x: p.x + correction.x, y: p.y + correction.y }));
      for (const vertical of [true, false]) for (const p of at) {
        const value = vertical ? p.x : p.y, span = (vertical ? this.#xs : this.#ys).span(value, vertical ? p.y : p.x);
        if (span) { const [lo, hi] = span; guides.push(vertical ? { x0: value, y0: lo, x1: value, y1: hi } : { x0: lo, y0: value, x1: hi, y1: value }); }
      }
      for (const p of at) if (this.#hasPoint(p) && !guides.some(g => g.x0 === p.x && g.x1 === p.x && g.y0 === p.y && g.y1 === p.y)) guides.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
    return { correction, guides };
  }
}

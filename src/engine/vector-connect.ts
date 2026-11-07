import { mergeVertices } from "./vector-edit-ops";
import { freezeNetwork, type VectorNetwork, type VectorRegion, type VectorSegment } from "./vector-network";

type Handle = readonly [number, number];
const zero: Handle = [0, 0];

/** Build the incident lists once per command, preserving native segment order. */
class Connections {
  readonly segments: VectorSegment[];
  readonly incident: number[][];
  regions: readonly VectorRegion[];
  constructor(readonly network: VectorNetwork) {
    this.regions = network.regions;
    this.segments = [...network.segments];
    this.incident = Array.from({ length: network.vertices.length }, () => []);
    this.segments.forEach((edge, i) => {
      this.incident[edge.a]?.push(i);
      if (edge.b !== edge.a) this.incident[edge.b]?.push(i);
    });
  }

  private pathBetween(from: number, to: number): number[] | undefined {
    const seen = new Set([from]), queue = [from];
    const previous = new Map<number, [number, number]>();
    for (let head = 0; head < queue.length; head++) {
      const vertex = queue[head];
      if (vertex === to) {
        const path: number[] = [];
        for (let at = to; at !== from;) {
          const [parent, segment] = previous.get(at)!;
          path.push(segment); at = parent;
        }
        return path.reverse();
      }
      for (const i of this.incident[vertex]) {
        const edge = this.segments[i], next = edge.a === vertex ? edge.b : edge.a;
        if (!this.incident[next] || seen.has(next)) continue;
        seen.add(next); previous.set(next, [vertex, i]); queue.push(next);
      }
    }
  }

  private sharesVertex(first: number, second: number): boolean {
    const p = this.segments[first], q = this.segments[second];
    return Boolean(p && q && (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b));
  }

  private closeRegions(path: number[], segment: number): void {
    const chain = new Set(path);
    const filled = this.regions.some(region => region.loops.some(loop => loop.some(i => chain.has(i))));
    if (!filled) {
      this.regions = [...this.regions, { loops: [[segment, ...path]], winding: "nonZero" }];
      return;
    }
    // Insert into the loop's own winding order. Click order must never reverse a hole.
    this.regions = this.regions.map(region => ({
      ...region, loops: region.loops.map(loop => {
        if (loop.length !== path.length || !loop.every(i => chain.has(i))) return loop;
        const gap = loop.findIndex((i, k) => k > 0 && !this.sharesVertex(loop[k - 1], i));
        const closed = [...loop];
        closed.splice(gap < 0 ? loop.length : gap, 0, segment);
        return closed.every((i, k) => this.sharesVertex(i, closed[(k + 1) % closed.length])) ? closed : loop;
      }),
    }));
  }

  connect(a: number, b: number, ta: Handle, tb: Handle): number {
    const path = this.incident[a].length === 1 && this.incident[b].length === 1 ? this.pathBetween(b, a) : undefined;
    const segment = this.segments.length;
    this.segments.push({ a, b, ta: ta.every(Number.isFinite) ? ta : zero, tb: tb.every(Number.isFinite) ? tb : zero });
    this.incident[a].push(segment); this.incident[b].push(segment);
    if (path) this.closeRegions(path, segment);
    return segment;
  }

  /** Continue the existing end handle, fall back to the incident edge, then to the new chord. */
  handle(vertex: number, chord: Handle, length: number): Handle {
    const edges = this.incident[vertex];
    if (edges.length === 1) {
      const edge = this.segments[edges[0]], start = edge.a === vertex;
      const handle = start ? edge.ta : edge.tb, magnitude = Math.hypot(...handle);
      if (magnitude > 1e-9) return [-handle[0] / magnitude * length, -handle[1] / magnitude * length];
      const end = this.network.vertices[vertex], other = this.network.vertices[start ? edge.b : edge.a];
      if (other) {
        const x = end.x - other.x, y = end.y - other.y, distance = Math.hypot(x, y);
        if (distance > 1e-9) return [x / distance * length, y / distance * length];
      }
    }
    return [chord[0] * length, chord[1] * length];
  }

  finish(): VectorNetwork {
    return freezeNetwork({ ...this.network, segments: this.segments, regions: this.regions });
  }
}

export function connectVectorPoints(net: VectorNetwork, a: number, b: number, ta: Handle = zero, tb: Handle = zero) {
  if (a === b || !Number.isInteger(a) || !Number.isInteger(b) || !net.vertices[a] || !net.vertices[b]) return;
  const draft = new Connections(net), segment = draft.connect(a, b, ta, tb);
  return { network: draft.finish(), segment };
}

export function joinVectorPoints(net: VectorNetwork, selected: readonly number[], smooth: boolean): { network: VectorNetwork; joins: number } {
  const points = [...new Set(selected)].filter(i => Number.isInteger(i) && net.vertices[i]).sort((a, b) => a - b);
  const distance = (a: number, b: number) => Math.hypot(net.vertices[a].x - net.vertices[b].x, net.vertices[a].y - net.vertices[b].y);
  if (points.length < 2) return { network: net, joins: 0 };
  if (points.length === 2 && distance(points[0], points[1]) < .5) {
    return { network: mergeVertices(net, points[0], points[1]), joins: 1 };
  }
  const draft = new Connections(net);
  const ends = points.length === 2 ? points : points.filter(i => draft.incident[i].length <= 1);
  let joins = 0;
  for (let k = 0; k + 1 < ends.length; k++) {
    const a = ends[k];
    let nearest = k + 1, shortest = distance(a, ends[nearest]);
    for (let i = nearest + 1; i < ends.length; i++) {
      const gap = distance(a, ends[i]);
      if (gap < shortest) { shortest = gap; nearest = i; }
    }
    const [b] = ends.splice(nearest, 1);
    let ta = zero, tb = zero;
    if (smooth) {
      const p = net.vertices[a], q = net.vertices[b];
      const chord: Handle = shortest > 1e-9 ? [(q.x - p.x) / shortest, (q.y - p.y) / shortest] : zero;
      ta = draft.handle(a, chord, shortest / 3);
      tb = draft.handle(b, [-chord[0], -chord[1]], shortest / 3);
    }
    draft.connect(a, b, ta, tb); joins++;
  }
  return { network: joins ? draft.finish() : net, joins };
}

import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-vector-loop-ops.json";
import type { PathCommand } from "../../src/engine/corners";
import { cubicLength } from "../../src/engine/cubic";
import { connectVectorPoints } from "../../src/engine/vector-connect";
import { deleteVertices, removeSegments, setHandle, setMirroring } from "../../src/engine/vector-edit-ops";
import { freezeNetwork, networkFromPoints, type HandleMirroring, type VectorNetwork } from "../../src/engine/vector-network";
import { flattenContours } from "../../src/engine/corners";
import { vectorFillPath, vectorRegionPath, vectorStrokePath } from "../../src/engine/vector-path";
import { roundedNetwork } from "../../src/engine/vector-rounded";

// Vector loops that close through a bridge, and mirror modes that smooth a sharp point, observed through the native
// network operations at bad07e44 (upstream #1951 and #2110; tests/fixtures/native-vector-loop-ops.provenance.md).
// The scenarios restate crates/engine/src/canvas/vectoredit/ops.rs and crates/doc/src/tests.rs.

type Wire = { vertices: { x: number; y: number; radius: number; mirror?: HandleMirroring }[]; segments: { a: number; b: number; ta: number[]; tb: number[] }[]; regions: { loops: number[][]; winding: "nonZero" | "evenOdd" }[] };
type Op = { op: string; vertices?: number[]; segments?: number[]; heal?: boolean; segment?: number; start?: boolean; rel?: number[]; independent?: boolean; a?: number; b?: number; ta?: number[]; tb?: number[]; mode?: HandleMirroring };
type Case = { name: string; network: Wire; steps: { op: Op; returned: number | null; network: Wire }[]; rounded: boolean; drawnLoops: number[][][]; fill: unknown[][]; stroke: unknown[][]; regions: (unknown[][] | null)[] };
const cases = fixture.cases as unknown as Case[];
const network = (wire: Wire): VectorNetwork => freezeNetwork({
  vertices: wire.vertices.map(v => ({ x: v.x, y: v.y, radius: v.radius, ...(v.mirror && { mirror: v.mirror }) })),
  segments: wire.segments.map(s => ({ a: s.a, b: s.b, ta: [s.ta[0], s.ta[1]] as const, tb: [s.tb[0], s.tb[1]] as const })),
  regions: wire.regions.map(r => ({ loops: r.loops, winding: r.winding })),
});
function apply(net: VectorNetwork, op: Op): { network: VectorNetwork; returned: number | null } {
  if (op.op === "deleteVertices") return { network: deleteVertices(net, op.vertices!, op.heal), returned: null };
  if (op.op === "removeSegments") return { network: removeSegments(net, op.segments!), returned: null };
  if (op.op === "setMirroring") return { network: setMirroring(net, op.vertices!, op.mode!), returned: null };
  if (op.op === "setHandle") return { network: setHandle(net, op.segment!, op.start!, [op.rel![0], op.rel![1]], op.independent), returned: null };
  const connected = connectVectorPoints(net, op.a!, op.b!, [op.ta![0], op.ta![1]], [op.tb![0], op.tb![1]]);
  return { network: connected?.network ?? net, returned: connected?.segment ?? null };
}
function sameNetwork(actual: VectorNetwork, expected: Wire, why: string) {
  expect(actual.regions.map(r => r.loops), `${why}: loops`).toEqual(expected.regions.map(r => r.loops));
  expect(actual.segments.map(s => [s.a, s.b]), `${why}: segment ends`).toEqual(expected.segments.map(s => [s.a, s.b]));
  actual.segments.forEach((s, i) => [...s.ta, ...s.tb].forEach((value, j) => expect(value, `${why}: handle ${j} of segment ${i}`).toBeCloseTo([...expected.segments[i].ta, ...expected.segments[i].tb][j], 9)));
  expect(actual.vertices.length, `${why}: points`).toBe(expected.vertices.length);
  actual.vertices.forEach((v, i) => {
    expect([v.x, v.y, v.radius], `${why}: point ${i}`).toEqual([expected.vertices[i].x, expected.vertices[i].y, expected.vertices[i].radius]);
    expect(v.mirror ?? null, `${why}: mirroring of point ${i}`).toBe(expected.vertices[i].mirror ?? null);
  });
}
function samePath(actual: readonly PathCommand[] | undefined, expected: unknown[][] | null, why: string) {
  if (!expected) { expect(actual, why).toBeUndefined(); return; }
  expect(actual!.map(c => c[0]).join(""), why).toBe(expected.map(c => c[0]).join(""));
  actual!.forEach((command, i) => command.slice(1).forEach((value, j) => expect(value as number, `${why}: element ${i}`).toBeCloseTo(expected[i][j + 1] as number, 7)));
}

describe("native vector loops and mirror modes", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    let net = network(c.network);
    c.steps.forEach((step, i) => {
      const result = apply(net, step.op); net = result.network;
      expect(result.returned, `step ${i} returns`).toBe(step.returned);
      sameNetwork(net, step.network, `after ${step.op.op} (step ${i})`);
    });
    const drawn = roundedNetwork(net);
    expect(drawn !== undefined, "rounded").toBe(c.rounded);
    expect((drawn ?? net).regions.map(r => r.loops), "loops as drawn").toEqual(c.drawnLoops);
    samePath(vectorFillPath(net), c.fill, "fill");
    samePath(vectorStrokePath(drawn ?? net), c.stroke, "stroke");
    c.regions.forEach((expected, i) => samePath(vectorRegionPath(drawn ?? net, i), expected, `region ${i}`));
  });
});

// crates/doc/src/tests.rs::a_chamfered_rectangles_rounded_fill_is_cut_at_every_point: a property of every way a loop
// can list and direct its segments.
describe("a rounded chamfered rectangle", () => {
  const corners = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const length = (path: readonly PathCommand[]) => {
    let sum = 0, pen = { x: 0, y: 0 }, start = pen;
    for (const c of path) {
      if (c[0] === "M") pen = start = { x: c[1], y: c[2] };
      else if (c[0] === "L") { sum += Math.hypot(c[1] - pen.x, c[2] - pen.y); pen = { x: c[1], y: c[2] }; }
      else if (c[0] === "C") { const to = { x: c[5], y: c[6] }; sum += cubicLength([pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, to]); pen = to; }
      else { sum += Math.hypot(start.x - pen.x, start.y - pen.y); pen = start; }
    }
    return sum;
  };
  const keepsOff = (path: readonly PathCommand[], p: { x: number; y: number }) => {
    let best = Infinity;
    for (const points of flattenContours(path, 1e-4)) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, size = dx * dx + dy * dy;
      const t = size ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / size)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };
  it("cuts the fill at every point however the loop lists and directs its segments", () => {
    for (let first = 0; first < corners.length; first++) for (const backwards of [false, true]) for (let flipped = 0; flipped < 1 << corners.length; flipped++) {
      const base = networkFromPoints(corners, true), loop = [...base.regions[0].loops[0].slice(first), ...base.regions[0].loops[0].slice(0, first)];
      if (backwards) loop.reverse();
      const net = freezeNetwork({
        vertices: base.vertices.map(v => ({ ...v, radius: 43 })),
        segments: base.segments.map((s, i) => flipped & 1 << i ? { a: s.b, b: s.a, ta: s.tb, tb: s.ta } : s),
        regions: [{ ...base.regions[0], loops: [loop] }],
      });
      const why = `loop from segment ${first}${backwards ? " backwards" : ""}, segments flipped ${flipped.toString(2).padStart(5, "0")}`;
      const drawn = roundedNetwork(net)!, stroke = vectorStrokePath(drawn), fill = vectorFillPath(net), region = vectorRegionPath(drawn, 0)!;
      for (const p of corners) for (const path of [stroke, fill, region]) expect(keepsOff(path, p), why).toBeGreaterThan(2);
      expect(Math.abs(length(fill) - length(stroke)), `${why}: fill and stroke`).toBeLessThan(1e-6);
      expect(Math.abs(length(region) - length(stroke)), `${why}: region and stroke`).toBeLessThan(1e-6);
    }
  });
});

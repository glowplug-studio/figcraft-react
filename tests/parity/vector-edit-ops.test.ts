import { describe, expect, it } from "vitest";
import { multiply } from "../../src/engine/affine";
import { cubicPoint } from "../../src/engine/cubic";
import { bendSegment, deleteVertices, makeSmooth, mergeVertices, moveHandles, moveVertices, removeSegments, setHandle, setMirroring, smoothVertices, splitSegment, transformVertices } from "../../src/engine/vector-edit-ops";
import { freezeNetwork, networkCubic, networkFromPoints, networkIncident, networkMirroring, vectorLine, type VectorNetwork } from "../../src/engine/vector-network";
import { vectorFillContains, vectorLoopWalk } from "../../src/engine/vector-path";

const point = (x: number, y: number) => ({ x, y });
const line = () => networkFromPoints([point(0, 0), point(50, 0), point(100, 0)], false);
const square = () => networkFromPoints([point(0, 0), point(100, 0), point(100, 100), point(0, 100)], true);
const framed = (): VectorNetwork => {
  const n = square(); return freezeNetwork({ ...n, regions: [{ ...n.regions[0], fills: [], paintSpace: { width: 100, height: 100, transform: [1, 0, 0, 1, 20, 30] } }] });
};
const curve = (): VectorNetwork => setHandle(setHandle(line(), 0, true, [10, 40], true), 0, false, [-20, 50], true);
function continuous(n: VectorNetwork, loop: readonly number[]): boolean {
  const ends = vectorLoopWalk(n, loop).map(([i, reverse]) => reverse ? [n.segments[i].b, n.segments[i].a] : [n.segments[i].a, n.segments[i].b]);
  return ends.every((e, i) => e[1] === ends[(i + 1) % ends.length][0]);
}

describe("native vector point and handle operations", () => {
  it("moves duplicate indices once and translates paint frames only when every vertex moves", () => {
    const n = framed(), before = JSON.stringify(n), partial = moveVertices(n, [0, 0, -1, 99], point(10, 20));
    expect(partial.vertices[0]).toMatchObject({ x: 10, y: 20 }); expect(partial.vertices[1]).toEqual(n.vertices[1]);
    expect(partial.regions).toEqual(n.regions); expect(partial.segments).toEqual(n.segments);
    const all = moveVertices(n, [0, 1, 2, 3, 2], point(-5, 7));
    expect(all.regions[0].paintSpace?.transform).toEqual([1, 0, 0, 1, 15, 37]);
    expect(all.regions[0].fills).toEqual([]); expect(JSON.stringify(n)).toBe(before); expect(Object.isFrozen(all.vertices[0])).toBe(true);
    expect(moveVertices(n, [0], point(Infinity, 0))).toBe(n); expect(moveVertices(n, [0], point(0, 0))).toBe(n);
  });
  it("transforms selected anchor handles and whole-network paint frames without scaling radii", () => {
    const source = framed(), n = setHandle(source, 0, true, [10, 20], true);
    const m = [0, 2, -3, 0, 40, 50] as const, partial = transformVertices(n, [0], m);
    expect(partial.vertices[0]).toMatchObject({ x: 40, y: 50, radius: 0 }); expect(partial.segments[0].ta).toEqual([-60, 20]);
    expect(partial.vertices[1]).toEqual(n.vertices[1]); expect(partial.regions).toEqual(n.regions);
    const all = transformVertices(n, [0, 1, 2, 3], m);
    expect(all.regions[0].paintSpace?.transform).toEqual(multiply(m, n.regions[0].paintSpace!.transform));
    expect(transformVertices(n, [0, 1], [1e308, 0, 0, 1, 0, 0])).toBe(n);
  });
  it("matches native equal-length, angle-only and independent mirroring", () => {
    let n = setMirroring(line(), [1], "angleAndLength"); n = setHandle(n, 1, true, [20, 10]);
    expect(n.segments[0].tb).toEqual([-20, -10]);
    n = setMirroring(n, [1], "angle"); n = setHandle(n, 1, true, [0, 30]);
    expect(n.segments[0].tb[0]).toBeCloseTo(0, 12); expect(n.segments[0].tb[1]).toBeCloseTo(-22.360679, 4);
    const old = n.segments[0].tb; n = setHandle(n, 1, true, [10, 0], true);
    expect(networkMirroring(n, 1)).toBe("none"); expect(n.segments[0].tb).toEqual(old);
    n = setMirroring(n, [1], "angleAndLength");
    expect(n.segments[0].tb[0] + n.segments[1].ta[0]).toBeCloseTo(0, 12);
    expect(n.segments[0].tb[1] + n.segments[1].ta[1]).toBeCloseTo(0, 12);
    expect(Math.hypot(...n.segments[0].tb)).toBeCloseTo((10 + Math.sqrt(500)) / 2, 10);
  });
  it("chooses the longer handle direction and keeps zero-length angle edge behaviour", () => {
    let n = setHandle(setHandle(line(), 0, false, [-30, 0], true), 1, true, [0, 10], true);
    n = setMirroring(n, [1], "angle"); expect(n.segments[1].ta).toEqual([10, -0]); expect(n.segments[0].tb).toEqual([-30, 0]);
    const before = n.segments[0].tb; n = setHandle(n, 1, true, [0, 0]); expect(n.segments[0].tb).toEqual(before);
    n = setMirroring(setHandle(n, 0, false, [0, 0], true), [1], "angle");
    n = setHandle(n, 1, true, [0, 12]); expect(n.segments[0].tb).toEqual([-0, -12]);
  });
  it("moves selected handles from their original positions before mirroring side effects", () => {
    const n = setHandle(setMirroring(line(), [1], "angleAndLength"), 1, true, [10, 0]);
    const out = moveHandles(n, [[1, true], [0, false]], point(3, 4));
    expect(out.segments[0].tb).toEqual([-7, 4]); expect(out.segments[1].ta).toEqual([7, -4]);
    const independent = moveHandles(n, [[1, true], [0, false]], point(3, 4), true);
    expect(independent.segments[1].ta).toEqual([13, 4]); expect(independent.segments[0].tb).toEqual([-7, 4]); expect(networkMirroring(independent, 1)).toBe("none");
    expect(n.segments[1].ta).toEqual([10, 0]);
  });
  it("matches native smooth/sharp directions and leaves endpoints unchanged", () => {
    let n = makeSmooth(square(), 0, point(30, 0));
    expect(n.segments[0].ta).toEqual([30, 0]); expect(n.segments[3].tb).toEqual([-30, -0]); expect(networkMirroring(n, 0)).toBe("angle");
    n = smoothVertices(n, [0], false); expect(n.segments[0].ta).toEqual([0, 0]); expect(n.vertices[0].mirror).toBeUndefined();
    const bowed = networkFromPoints([point(0, 0), point(50, 30), point(100, 0)], false), smooth = smoothVertices(bowed, [1]);
    const reach = Math.hypot(50, 30) / 3;
    expect(smooth.segments[0].tb[0]).toBeCloseTo(-reach, 12); expect(smooth.segments[1].ta[0]).toBeCloseTo(reach, 12);
    expect(smooth.segments[0].tb[1]).toBe(0); expect(networkMirroring(smooth, 1)).toBe("angle");
    expect(smoothVertices(bowed, [0, 2])).toBe(bowed);
  });
  it("pulls handles towards incident chords and preserves native junction tie ordering", () => {
    const n = networkFromPoints([point(0, 0), point(100, 0)], false), endpoint = makeSmooth(n, 1, point(10, 20));
    expect(endpoint.segments[0].tb).toEqual([-10, -20]);
    const junction = freezeNetwork({ vertices: [0, 1, 2, 3].map(i => ({ x: i ? 10 : 0, y: 0, radius: 0 })), segments: [vectorLine(0, 1), vectorLine(0, 2), vectorLine(0, 3)], regions: [] });
    const out = makeSmooth(junction, 0, point(0, 10));
    expect(out.segments[2].ta).toEqual([0, 10]); expect(out.segments[0].ta).toEqual([-0, -10]); expect(out.segments[1].ta).toEqual([0, 0]);
  });
  it("bends through the requested point at the clamped parameter", () => {
    const n = line();
    for (const t of [-1, .05, .2, .5, .9, 2]) {
      const target = point(20, 30), out = bendSegment(n, 0, t, target), p = cubicPoint(networkCubic(out, 0)!, Math.max(.05, Math.min(.95, t)));
      expect(p.x).toBeCloseTo(target.x, 10); expect(p.y).toBeCloseTo(target.y, 10); expect(out.vertices).toEqual(n.vertices);
    }
    expect(bendSegment(n, 0, NaN, point(1, 1))).toBe(n);
  });
  it("splits curved segments without changing the curve or endpoint metadata", () => {
    const n = curve(), c = networkCubic(n, 0)!, out = splitSegment(n, 0, .37)!;
    expect(out.vertex).toBe(3); expect(out.network.vertices[out.vertex].mirror).toBe("angle");
    expect(out.network.vertices.slice(0, 3)).toEqual(n.vertices);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, part = t <= .37 ? networkCubic(out.network, 0)! : networkCubic(out.network, 2)!;
      const p = cubicPoint(part, t <= .37 ? t / .37 : (t - .37) / .63), expected = cubicPoint(c, t);
      expect(p.x).toBeCloseTo(expected.x, 10); expect(p.y).toBeCloseTo(expected.y, 10);
    }
  });
  it("splits straight segments using native cubic parameterisation and parameter limits", () => {
    const n = line(), quarter = splitSegment(n, 0, .25)!;
    expect(quarter.network.vertices[quarter.vertex].x).toBe(7.8125);
    expect(quarter.network.segments[0].ta).toEqual([0, 0]); expect(quarter.network.vertices[quarter.vertex].mirror).toBeUndefined();
    expect(splitSegment(n, 0, NaN)?.network.vertices.at(-1)?.x).toBe(25);
    for (const [input, t] of [[-1, .01], [2, .99]]) expect(splitSegment(n, 0, input)?.network.vertices.at(-1)?.x).toBeCloseTo(cubicPoint(networkCubic(n, 0)!, t).x, 12);
    expect(splitSegment(n, 99, .5)).toBeUndefined();
  });
  it("retains reversed native triangle loop order and region paint metadata after splits", () => {
    const open = networkFromPoints([point(0, 0), point(100, 0), point(100, 100)], false);
    for (const [seg, loop] of [[1, [2, 1, 0]], [2, [2, 1, 0]], [1, [0, 1, 2]]] as const) {
      const n = freezeNetwork({ ...open, segments: [...open.segments, vectorLine(0, 2)], regions: [{ ...framed().regions[0], loops: [loop] }] });
      const { network: out, vertex } = splitSegment(n, seg, .5)!;
      expect(continuous(out, out.regions[0].loops[0])).toBe(true); expect(vectorFillContains(out, point(25, 10))).toBe(true);
      expect(out.regions[0].fills).toEqual([]); expect(out.regions[0].paintSpace).toEqual(n.regions[0].paintSpace);
      if (seg === 1) expect(out.vertices[vertex]).toMatchObject({ x: 100, y: 50 });
    }
  });
  it("removes orphaned ends, preserves attached points and reopens surviving fill loops", () => {
    const n = removeSegments(square(), [0]); expect(n.segments).toHaveLength(3); expect(n.vertices).toHaveLength(4);
    expect(vectorFillContains(n, point(50, 50))).toBe(true);
    const open = removeSegments(line(), [1, 1, 99]); expect(open.vertices).toHaveLength(2); expect(open.segments).toEqual([vectorLine(0, 1)]);
    const s = removeSegments(framed(), [1]); expect(s.regions[0].paintSpace).toEqual(framed().regions[0].paintSpace);
    const empty = removeSegments(square(), [0, 1, 2, 3]); expect(empty.vertices).toHaveLength(0); expect(empty.regions).toHaveLength(0);
  });
  it("matches native delete versus heal, stable descending indices and kept metadata", () => {
    const n = framed(), healed = deleteVertices(n, [1], true), removed = deleteVertices(n, [1], false);
    expect([healed.vertices.length, healed.segments.length, healed.regions.length]).toEqual([3, 3, 1]);
    expect([removed.vertices.length, removed.segments.length]).toEqual([3, 2]);
    expect(continuous(healed, healed.regions[0].loops[0])).toBe(true); expect(healed.regions[0].paintSpace).toEqual(n.regions[0].paintSpace);
    const both = deleteVertices(n, [3, 1, 1, 99]); expect(both.vertices.map(v => [v.x, v.y])).toEqual([[0, 0], [100, 100]]); expect(both.segments).toHaveLength(0);
    expect(deleteVertices(n, [0, 1, 2, 3]).vertices).toHaveLength(0); expect(n.vertices).toHaveLength(4);
  });
  it("heals a curved point while retaining its position on the resulting curve", () => {
    const n = networkFromPoints([point(0, 0), point(50, 50), point(100, 0)], false);
    const curved = setHandle(setHandle(n, 0, true, [0, 25], true), 1, false, [0, 25], true), out = deleteVertices(curved, [1], true);
    expect(out.segments).toHaveLength(1); expect(out.vertices).toHaveLength(2);
    const middle = cubicPoint(networkCubic(out, 0)!, .5); expect(middle.x).toBeCloseTo(50, 10); expect(middle.y).toBeCloseTo(50, 10);
    expect(out.segments[0].ta[0]).toBe(0); expect(out.segments[0].tb[0]).toBe(0);
  });
  it("ignores junk indices and non-finite input without mutating published networks", () => {
    const n = line(), original = JSON.stringify(n);
    expect(removeSegments(n, [99])).toBe(n); expect(deleteVertices(n, [99], true)).toBe(n);
    expect(setHandle(n, 99, true, [1, 1])).toBe(n); expect(setHandle(n, 0, true, [NaN, 1])).toBe(n);
    expect(makeSmooth(n, 99, point(1, 1))).toBe(n); expect(moveHandles(n, [[99, true]], point(1, 1))).toBe(n);
    expect(transformVertices(n, [1], [NaN, 0, 0, 1, 0, 0])).toBe(n); expect(JSON.stringify(n)).toBe(original);
    expect(networkIncident(n, 1)).toEqual([[0, false], [1, true]]);
  });
  it("merges onto the retained point, removes collapsed straight edges and keeps curved loops", () => {
    const n = freezeNetwork({ ...line(), vertices: line().vertices.map((v, i) => ({ ...v, radius: i * 5 })) });
    const merged = mergeVertices(n, 2, 1);
    expect(merged.vertices).toHaveLength(2); expect(merged.vertices[1]).toMatchObject({ x: 100, y: 0, radius: 10 });
    expect(merged.segments).toEqual([vectorLine(0, 1)]);
    const curved = mergeVertices(setHandle(n, 1, true, [10, 20], true), 2, 1);
    expect(curved.segments).toHaveLength(2); expect(curved.segments[1]).toMatchObject({ a: 1, b: 1, ta: [10, 20] });
    expect(mergeVertices(n, 99, 1)).toBe(n); expect(mergeVertices(n, 1, 1)).toBe(n);
  });
});

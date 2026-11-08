import { describe, expect, it } from "vitest";
import { cubicDerivative, cubicPoint } from "../../src/engine/cubic";
import { cutComponents, cutVectorAcross, cutVectorSegment, cutVectorVertex } from "../../src/engine/vector-cut";
import { eraseVector } from "../../src/engine/vector-erase";
import { networkCubic, networkFromPoints, networkIncident } from "../../src/engine/vector-network";
import { vectorRegionContains } from "../../src/engine/vector-path";

const square = () => networkFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], true);
const longLine = () => networkFromPoints([{ x: 0, y: 0 }, { x: 6400, y: 0 }], false);
describe("native vector cuts", () => {
  it("opens a seam with two coincident endpoints while retaining the square's fill", () => {
    for (const cut of [cutVectorSegment(square(), 0, .5)!, cutVectorVertex(square(), 2)!]) {
      const [a, b] = cut.vertices;
      expect(a).not.toBe(b); expect(cut.network.vertices[a]).toEqual(cut.network.vertices[b]);
      expect(networkIncident(cut.network, a)).toHaveLength(1); expect(networkIncident(cut.network, b)).toHaveLength(1);
      expect(vectorRegionContains(cut.network, 0, { x: 50, y: 50 })).toBe(true);
    }
    expect(cutVectorVertex(square(), 9)).toBeUndefined();
  });
  it("splits both sides in the finite line's range and remaps each piece's loops and paint metadata", () => {
    const net = square(), region = { ...net.regions[0], fills: [], winding: "evenOdd" as const };
    const cut = cutVectorAcross({ ...net, regions: [region] }, { x: 50, y: -10 }, { x: 50, y: 110 });
    const parts = cutComponents(cut.network);
    expect(cut.vertices).toHaveLength(4); expect(parts).toHaveLength(2);
    parts.forEach((part, index) => {
      expect(part.regions[0]).toMatchObject({ fills: [], winding: "evenOdd" });
      expect(vectorRegionContains(part, 0, { x: 25, y: 50 })).toBe(index === 0);
      expect(vectorRegionContains(part, 0, { x: 75, y: 50 })).toBe(index === 1);
    });
    for (const [a, b] of [[{ x: 0, y: -5 }, { x: 0, y: 105 }], [{ x: 50, y: 20 }, { x: 50, y: 80 }]]) {
      expect(cutVectorAcross(net, a, b).network).toBe(net);
    }
  });
  it("cuts three crossings of one curved segment in original parameter order", () => {
    const line = networkFromPoints([{ x: 0, y: -8 }, { x: 100, y: 8 }], false);
    // Signed height is 100(t-.2)(t-.5)(t-.8).
    const net = { ...line, segments: [{ ...line.segments[0], ta: [100 / 3, 22] as const, tb: [-100 / 3, -22] as const }] };
    const cut = cutVectorAcross(net, { x: -1, y: 0 }, { x: 101, y: 0 });
    expect(cut.vertices).toHaveLength(6); expect(cutComponents(cut.network)).toHaveLength(4);
    const xs = cut.vertices.map(i => cut.network.vertices[i].x).sort((a, b) => a - b);
    xs.forEach((x, i) => expect(x).toBeCloseTo([20, 20, 50, 50, 80, 80][i], 7));
  });
});
describe("native circular vector eraser", () => {
  it("finds a radius-one crossing entirely between samples and retains both remote ends", () => {
    const net = longLine(), erased = eraseVector(net, { x: 5050, y: 0 }, 1);
    expect(erased.segments).toHaveLength(2);
    const xs = erased.vertices.map(v => v.x).sort((a,b) => a-b);
    xs.forEach((x,i) => expect(x).toBeCloseTo([0,5049,5051,6400][i], 2));
    for (const radius of [NaN, 0, -1, Infinity]) expect(eraseVector(net, { x: 5050, y: 0 }, radius)).toBe(net);
    expect(eraseVector(net, { x: 5050, y: 1 }, 1)).toBe(net);
  });
  it("removes a grazing curved interval, an endpoint and a fully enclosed segment", () => {
    const line = longLine(), net = { ...line, segments: [{ ...line.segments[0], ta: [0,3000] as const, tb: [0,3000] as const }] };
    const c = networkCubic(net, 0)!, p = cubicPoint(c, .7039), d = cubicDerivative(c, .7039), speed = Math.hypot(d.x, d.y);
    const centre = { x: p.x - .49 * d.y / speed, y: p.y + .49 * d.x / speed };
    expect(eraseVector(net, centre, .5).segments).toHaveLength(2);
    const half = eraseVector(line, { x: 0, y: 0 }, 640);
    expect(Math.min(...half.vertices.map(v => v.x))).toBeCloseTo(640, 3);
    expect(eraseVector(line, { x: 3200, y: 0 }, 4000).segments).toEqual([]);
  });
});

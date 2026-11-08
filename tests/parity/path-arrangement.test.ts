import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/engine/corners";
import { arrangementFaces, unionFaces } from "../../src/engine/path-arrangement";
import { outlineBand } from "../../src/engine/path-boolean";
import { parseSvgPath } from "../../src/engine/svg-path";
import { pathWinding } from "../../src/engine/vector-path";

const input = (svg: string, evenOdd = false) => ({ path: parseSvgPath(svg), evenOdd });
const square = (x: number, y: number, size: number) => `M${x} ${y}h${size}v${size}h-${size}Z`;
const contains = (path: readonly PathCommand[], x: number, y: number) => pathWinding(path, { x, y }) !== 0;

describe("native Shape Builder path arrangements", () => {
  it("reports square coverage and dissolves only the chosen shared edges", () => {
    const faces = arrangementFaces([input(square(0, 0, 10)), input(square(5, 5, 10))]);
    expect(faces.map(f => [f.cover, Math.round(f.area)])).toEqual([[[0],75], [[0,1],25], [[1],75]]);
    const joined = unionFaces(faces.map(f => f.path));
    expect(joined.filter(cmd => cmd[0] === "M")).toHaveLength(1);
    expect(contains(joined, 12, 12)).toBe(true);
    expect(contains(joined, 12, 2)).toBe(false);
  });
  it("keeps holes attached to their immediate exterior and separates enclosed islands", () => {
    const ring = [square(0,0,30),square(10,10,10),square(13,13,4)].join(" ");
    const faces = arrangementFaces([input(ring, true), input(square(35,0,3))]);
    expect(faces.map(f => Math.round(f.area)).sort((a,b) => a-b)).toEqual([9,16,800]);
    const outer = faces.find(f => Math.round(f.area) === 800)!;
    expect(outer.path.filter(cmd => cmd[0] === "M")).toHaveLength(2);
    expect(contains(outer.path, 15,15)).toBe(false);
    expect(contains(outer.path, 5,5)).toBe(true);
    const nonZero = arrangementFaces([input(ring)]);
    expect(nonZero.map(f => Math.round(f.area))).toEqual([900]);
  });
  it("separates disconnected regions even when their coverage is identical", () => {
    const faces = arrangementFaces([input(square(0,0,20)), input("M8 -5h4v30H8Z")]);
    expect(faces.map(f => [f.cover.join(","),Math.round(f.area)])).toEqual([
      ["0",160],["0",160],["0,1",80],["1",20],["1",20],
    ]);
    for (const [x,y] of [[2,10],[10,10],[18,10],[10,-2],[10,22]]) {
      expect(faces.filter(face => contains(face.path,x,y))).toHaveLength(1);
    }
  });
  it("retains cubic boundaries in every face of overlapping circles", () => {
    const circle = (x: number) => input(`M${x} 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z`);
    const faces = arrangementFaces([circle(0),circle(10)]);
    expect(faces).toHaveLength(3);
    for (const face of faces) expect(face.path.some(c => c[0] === "C")).toBe(true);
    expect(faces[1].area).toBeCloseTo(122.84,0);
  });
  it("keeps the three regions of a centred star stroke disjoint", () => {
    const star: PathCommand[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 40 : 100;
      star.push([i ? "L" : "M", 150 + r * Math.cos(a), 150 + r * Math.sin(a)]);
    }
    star.push(["Z"]);
    const stroke = outlineBand(star, 8, "miter", 4, ["butt","butt"], null);
    const faces = arrangementFaces([{path:star,evenOdd:false},{path:stroke,evenOdd:false}]);
    expect(faces.map(f => f.cover)).toEqual([[0],[0,1],[1]]);
    for (let y = 52; y < 250; y += 7) for (let x = 52; x < 250; x += 7) {
      const expected = [star,stroke].flatMap((path,i) => contains(path,x,y) ? [i] : []);
      const hits = faces.filter(f => contains(f.path,x,y));
      expect(hits.map(f => f.cover)).toEqual(expected.length ? [expected] : []);
    }
  });
  it("returns at most 4096 connected faces in the native coverage order", () => {
    const separated = Array.from({length:4097}, (_, i) => square(3*i,0,1)).join(" ");
    const faces = arrangementFaces([input(separated)]);
    expect(faces).toHaveLength(4096);
    expect(faces.every(f => f.cover.length === 1 && f.cover[0] === 0 && Math.abs(f.area-1) < 1e-8)).toBe(true);
  });
  it("closes open inputs, ignores empty inputs and rejects hostile geometry", () => {
    expect(arrangementFaces([input("M0 0L10 0L10 10")])[0].area).toBeCloseTo(50,9);
    expect(arrangementFaces([])).toEqual([]);
    expect(() => arrangementFaces(Array(257).fill(input(square(0,0,1))))).toThrow("256");
    expect(() => arrangementFaces([{path:[["M",NaN,0],["L",1,1]], evenOdd:false}])).toThrow("invalid coordinates");
  });
});

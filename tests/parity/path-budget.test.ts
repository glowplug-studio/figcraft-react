import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/engine/corners";
import { arrangementFaces } from "../../src/engine/path-arrangement";
import { BooleanComplexityError, BooleanFoldBudget, checkBooleanStep, closedSubpaths, maxPathSegments, maxPossibleCrossings, pathComplexity } from "../../src/engine/path-budget";

function rect(x: number, y: number, width: number, height: number): PathCommand[] {
  return [["M",x,y],["L",x+width,y],["L",x+width,y+height],["L",x,y+height],["Z"]];
}
const zig = (n: number): PathCommand[] => [["M",0,0], ...Array.from({ length: n }, (_,i): PathCommand => ["L",i+1,i%2])];
describe("native path operation complexity limits", () => {
  it("counts touching boxes, close edges and exact cubic extrema", () => {
    expect(pathComplexity([[...rect(0,0,1,1),...rect(5,5,1,1)]])).toEqual({ segments: 8, crossings: 8 });
    const arch: PathCommand[] = [["M",0,0],["C",0,100,100,100,100,0]];
    const line: PathCommand[] = [["M",40,80],["L",60,80]];
    expect(pathComplexity([arch,line])).toEqual({ segments: 2, crossings: 0 });
    expect(pathComplexity([arch],true)).toEqual({ segments: 2, crossings: 1 });
  });
  it("admits ten thousand disjoint dots while refusing the native dense 750-bar grid", () => {
    const dots = Array.from({ length: 10_000 }, (_,i) => rect((i%100)*3,Math.floor(i/100)*3,2,2)).flat();
    expect(pathComplexity([dots])).toEqual({ segments: 40_000, crossings: 40_000 });
    const across = Array.from({ length: 750 }, (_,i) => rect(0,i*4,3000,2)).flat();
    const down = Array.from({ length: 750 }, (_,i) => rect(i*4,0,2,3000)).flat();
    expect(() => checkBooleanStep([across,down])).toThrow("too complex");
  });
  it("allows the segment limit and refuses an excess before sweeping", () => {
    const path = zig(maxPathSegments);
    expect(pathComplexity([path])?.segments).toBe(maxPathSegments);
    path.push(["L",0,0]); expect(pathComplexity([path])).toBeUndefined();
    expect(() => checkBooleanStep([path])).toThrow("too complex");
  });
  it("counts the accumulated fold independently of each step and validates every coordinate", () => {
    const path = zig(20_000), budget = new BooleanFoldBudget();
    for (let i=0;i<100;i++) budget.spend(path,path);
    expect(() => budget.spend(path,[])).toThrow("too complex");
    expect(() => budget.spend([],[])).toThrow("too complex");
    for (const x of [Infinity,NaN,1.5e9+1]) expect(() => checkBooleanStep([[["M",x,0]]])).toThrow("invalid coordinates");
  });
  // Upstream 554ad0ea (#2249), crates/pathops/src/budget_tests.rs at bad07e44.
  it("refuses the closed inputs of an arrangement before normalising them", () => {
    // Open L shapes whose segments never overlap but whose implicit closing edges all do.
    const path: PathCommand[] = [];
    for (let i = 0; i < 2200; i++) { const x = -i, y = 10_000 + i; path.push(["M",x,0],["L",x,y],["L",10_000,y]); }
    expect(pathComplexity([path])!.crossings, "open input passes").toBeLessThanOrEqual(maxPossibleCrossings);
    expect(() => arrangementFaces([{ path, evenOdd: false }])).toThrow(BooleanComplexityError);
  });
  it("leaves out subpaths of a lone move when closing", () => {
    const path: PathCommand[] = Array.from({ length: 1000 }, (_,i): PathCommand => ["M",i,0]);
    expect(closedSubpaths(path)).toEqual([]);
    path.push(["L",5,5]);
    expect(closedSubpaths(path), "the last move, the line and the close").toEqual([["M",999,0],["L",5,5],["Z"]]);
    // A segment drawn on from a close is open again and is closed in turn.
    expect(closedSubpaths([["M",0,0],["L",1,0],["Z"],["L",2,2],["M",9,9]])).toEqual([["M",0,0],["L",1,0],["Z"],["L",2,2],["Z"]]);
    expect(closedSubpaths([["M",0,0],["L",1,0],["M",3,3],["L",4,3],["L",4,4],["Z"]])).toEqual([["M",0,0],["L",1,0],["Z"],["M",3,3],["L",4,3],["L",4,4],["Z"]]);
  });
});

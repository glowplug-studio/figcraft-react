import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/engine/corners";
import { BooleanFoldBudget, checkBooleanStep, maxPathSegments, pathComplexity } from "../../src/engine/path-budget";

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
});

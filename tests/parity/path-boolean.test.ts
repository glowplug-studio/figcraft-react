import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/engine/corners";
import { ellipsePath } from "../../src/engine/ellipse";
import { booleanStep, foldBooleanPaths, normaliseBooleanPath, type BooleanOperation } from "../../src/engine/path-boolean";
import { pathWinding } from "../../src/engine/vector-path";
const square = (x: number,y: number,w: number): PathCommand[] => [["M",x,y],["L",x+w,y],["L",x+w,y+w],["L",x,y+w],["Z"]];
const inside = (p: readonly PathCommand[],x:number,y:number) => pathWinding(p,{x,y}) !== 0;
function cells(p: readonly PathCommand[], width=20) {
  let area = 0;
  for (let x=0;x<width;x++) for (let y=0;y<width;y++) if (inside(p,x+.25,y+.25)) area++;
  return area;
}
describe("curve-preserving boolean topology", () => {
  it("matches all four native operations and closes partial subpaths", () => {
    const a=square(0,0,10), b=square(5,5,10).slice(0,-1);
    for (const [op,area] of Object.entries({ union:175, subtract:75, intersect:25, exclude:150 })) {
      expect(cells(booleanStep(a,b,op as BooleanOperation))).toBe(area);
    }
    expect(booleanStep(a,a,"subtract")).toEqual([]);
    expect(booleanStep(a,[],"intersect")).toEqual([]);
  });
  it("uses each upper operand's operation and simplifies the single operand", () => {
    const a=square(0,0,10), b=square(5,0,10), c=square(5,2.5,5);
    expect(cells(foldBooleanPaths([{path:a,operation:"exclude"}, {path:b,operation:"union"}, {path:c,operation:"subtract"}]))).toBe(125);
    expect(foldBooleanPaths([])).toEqual([]);
    expect(cells(foldBooleanPaths([{path:a,operation:"subtract"}]))).toBe(100);
  });
  it("honours holes, coincident contours, open boundaries and self crossing lobes", () => {
    const a=square(0,0,20), ring=[...a,...square(5,5,10)];
    expect(cells(normaliseBooleanPath(ring,true))).toBe(300);
    expect(cells(normaliseBooleanPath(ring,false))).toBe(400);
    expect(normaliseBooleanPath([...a,...a],true)).toEqual([]);
    const bow: PathCommand[]=[["M",0,0],["L",10,10],["L",0,10],["L",10,0],["Z"]];
    const out=normaliseBooleanPath(bow);
    expect(inside(out,5,2)).toBe(true); expect(inside(out,5,8)).toBe(true); expect(inside(out,1,5)).toBe(false);
  });
  it("emits cubic intersections and retains every one of 4097 separated islands", () => {
    const circle=ellipsePath(20,20,{start:0,sweep:2*Math.PI,inner:0});
    const clipped=booleanStep(circle,square(10,0,20),"intersect");
    expect(clipped.some(c=>c[0]==="C")).toBe(true);
    expect(inside(clipped,12,10)).toBe(true); expect(inside(clipped,7,10)).toBe(false);
    const all=normaliseBooleanPath(Array.from({length:4097},(_,i)=>square(i*2,0,1)).flat());
    expect(all.filter(c=>c[0]==="M")).toHaveLength(4097); expect(inside(all,8192.5,.5)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { colour, toRgba8 } from "../../src/engine/colour";
import { defaultGradient, gradientFrame, readGradient, sampleSorted, sortedStops, squareLinearWidth } from "../../src/engine/gradient";

const red = colour(1,0,0), blue = colour(0,0,1), black = colour(0,0,0);
describe("native gradient geometry and stops", () => {
  it("starts with the base RGB colour fading to transparency for all four kinds", () => {
    for (const kind of ["linear","radial","angular","diamond"] as const) {
      const g = defaultGradient(kind, colour(1,0,0,0.4));
      expect(g.stops).toEqual([{position:0,color:red},{position:1,color:colour(1,0,0,0)}]);
      expect(g.from).toEqual(kind === "linear" ? [0.5,0] : [0.5,0.5]);
      expect(g.width).toEqual(kind === "linear" ? [-0.5,0] : [1,0.5]);
    }
  });
  it("keeps moved linear handles perpendicular in the actual box and preserves imported skew", () => {
    for (const [w,h] of [[120,80],[80,120],[1,1]]) {
      const from = [0,0.5] as const, to = [1,1] as const;
      const g = {...defaultGradient("linear",black), from, to, width:squareLinearWidth(from,to,w,h)};
      const [a,b,c,d] = gradientFrame(g,w,h);
      expect(a*c+b*d).toBeCloseTo(0,6);
      expect(a*d-b*c).not.toBe(0);
    }
    expect(squareLinearWidth([0,0],[1,1],0,NaN)).toEqual([-1,1]);
    const g = readGradient({type:"linearGradient",stops:["red","blue"],width:[0.25,0.4]},true);
    expect(gradientFrame(g,200,100)).toEqual([0,100,-50,40,100,0]);
  });
  it("normalises command shorthand and preserves strict canonical file records", () => {
    const g = readGradient({type:"linearGradient",stops:["red","white","blue"],from:[0,0.5],to:[1,0.5]},true);
    expect(g.width).toEqual([0,1.5]);
    expect(g.stops.map(s => s.position)).toEqual([0,0.5,1]);
    expect(readGradient({...g,type:"gradient"})).toEqual(g);
    expect(() => readGradient({type:"linearGradient",stops:["red","blue"]})).toThrow();
    for (const input of [{type:"unknownGradient",stops:[]},{type:"gradient",stops:"red"},{type:"gradient",stops:[42]},
      {type:"gradient",stops:["blue"],to:"left"},{type:"gradient",stops:[{position:0,color:{type:"gradient"}}]}]) {
      expect(() => readGradient(input,true)).toThrow();
    }
  });
  it("stably sorts and clamps sampling stops while keeping coincident stops as a hard edge", () => {
    const original = [{position:2,color:blue},{position:0.5,color:red},{position:-1,color:red},
      {position:0.5,color:blue},{position:NaN,color:black}];
    const sorted = sortedStops(original);
    expect(sorted.map(s=>s.position)).toEqual([0,0.5,0.5,1]);
    expect(original[0].position).toBe(2);
    expect(sampleSorted(sorted,0.5)).toEqual(red);
    expect(sampleSorted(sorted,0.5001)).toEqual(blue);
    expect(sampleSorted(sorted,NaN)).toEqual(red);
    expect(sampleSorted(sorted,2)).toEqual(blue);
    expect(sampleSorted([],0.5)).toEqual(black);
    expect(sortedStops([])).toEqual([{position:0,color:black}]);
  });
  it("interpolates straight sRGB and alpha independently and preserves an inserted sampled stop", () => {
    const ends = [{position:0,color:red},{position:1,color:colour(0,0,1,0)}];
    expect(toRgba8(sampleSorted(ends,0.5))).toEqual([128,0,128,128]);
    const withMiddle = sortedStops([...ends,{position:0.3,color:sampleSorted(ends,0.3)}]);
    for (let i=0; i<=100; i++) {
      const before = toRgba8(sampleSorted(ends,i/100)), after = toRgba8(sampleSorted(withMiddle,i/100));
      expect(after.every((v,j)=>Math.abs(before[j]-v)<=1)).toBe(true);
    }
  });
});

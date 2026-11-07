import { expect, it } from "vitest";
import { roundedRect, type PathCommand, type Radii } from "../../src/engine/corners";
import { EditorEngine } from "../../src/engine/editor";
import { measurePath } from "../../src/engine/path-measure";
import { hitRectangle } from "../../src/engine/selection";
import { shapePath, strokeGeometry } from "../../src/engine/shape-path";
import { parseSvgPath } from "../../src/engine/svg-path";
import { freezeNetwork, networkCubic, networkFromPath, networkFromPoints, type VectorNetwork } from "../../src/engine/vector-network";
import { vectorFillContains, vectorFillPath, vectorStrokePath, vectorStrokeRuns } from "../../src/engine/vector-path";
import { drawnVectorNetwork, roundedNetwork } from "../../src/engine/vector-rounded";
import { vectorPaintRegions } from "../../src/engine/vector-presentation";
import { vectorStrokePlan } from "../../src/engine/vector-stroke";
import { fromRgba8 } from "../../src/engine/colour";
import { solidPaint } from "../../src/engine/solid-paint";
import type { VectorNode } from "../../src/engine/document";

const p = (x: number, y: number) => ({ x, y });
function radii(net: VectorNetwork, values: readonly number[]) {
  return freezeNetwork({ ...net, vertices: net.vertices.map((v,i) => ({ ...v, radius: values[i % values.length] })) });
}
const square = (v: readonly number[]) => radii(networkFromPoints([p(0,0),p(100,0),p(100,100),p(0,100)], true),v);
function area(path: readonly PathCommand[]) {
  let sum = 0;
  for (const line of measurePath(path, 40_000, .00001)!) for (let i=1;i<line.points.length;i++) {
    const a=line.points[i-1], b=line.points[i]; sum += a.x*b.y-b.x*a.y;
  }
  return Math.abs(sum)/2;
}

for (const [values,s] of [[[20,20,20,20],.6],[[30,0,10,0],.6],[[12,12,12,12],1],[[40,40,40,40],.6]] as const) {
  it(`matches the rectangle corner area for ${values} at ${s}, including reversed loops`, () => {
    const net = square(values), expected = area(roundedRect(100,100,{radii:values as Radii,smoothing:s}));
    for(const loop of [net.regions[0].loops[0], [...net.regions[0].loops[0]].reverse()]) {
      const withLoop = freezeNetwork({...net,regions:[{...net.regions[0],loops:[loop]}]});
      const drawn = roundedNetwork(withLoop,s)!, got = area(vectorFillPath(drawn));
      expect(Math.abs(got-expected)).toBeLessThan(.1); expect(Math.abs(got-area(vectorFillPath(withLoop)))).toBeGreaterThan(1);
      expect(drawn.regions[0].loops[0]).toHaveLength(drawn.segments.length);
      expect(drawn.vertices.every(v=>v.x>=-1e-6 && v.x<=100+1e-6 && v.y>=-1e-6 && v.y<=100+1e-6)).toBe(true);
      for(const [i,r] of values.entries()) if (!r) expect(drawn.vertices[i]).toEqual(withLoop.vertices[i]);
    }
    expect(net.vertices).toHaveLength(4); expect(net.vertices.map(v=>v.radius)).toEqual(values);
  });
}

it("retains open and curved arcs, sharp junctions and zero smoothing", () => {
  const net=square([20]);
  expect(roundedNetwork(net,NaN)).toBe(roundedNetwork(net,0));
  const open=radii(networkFromPoints([p(200,0),p(250,0),p(250,50)],false),[20]);
  expect(roundedNetwork(open,.6)).toBe(roundedNetwork(open));
  const compound=radii(networkFromPath(parseSvgPath("M0 0H100V100H0Z M200 0H250V50")),[20]);
  const runs=vectorStrokeRuns(roundedNetwork(compound,.6)!);
  expect(runs.find(r=>!r.closed)?.path).toEqual(vectorStrokeRuns(open)[0].path);
  expect(runs.find(r=>r.closed)?.path).toEqual(vectorStrokePath(roundedNetwork(net,.6)!));
  const curved=radii(networkFromPath(parseSvgPath("M0 0C20 -10 70 -15 100 0V100H0Z")),[20,20,0,0]);
  expect(roundedNetwork(curved,.8)).toEqual(roundedNetwork(curved,0));
});

it("draws concave and holed contours, preserving fills, winding and finite malformed-loop output", () => {
  const concave=radii(networkFromPath(parseSvgPath("M0 0H100V35H40V100H0Z")),[12]);
  const drawn=roundedNetwork(concave,1)!;
  expect(vectorFillPath(drawn)).not.toEqual(vectorFillPath(concave)); expect(vectorFillContains(drawn,p(20,60))).toBe(true);
  const holed=radii(networkFromPath(parseSvgPath("M0 0H100V100H0Z M25 25V75H75V25Z")),[10]);
  const ring=roundedNetwork(holed,.6)!; expect(vectorFillContains(ring,p(50,50))).toBe(false); expect(vectorFillContains(ring,p(12,50))).toBe(true);
  const odd=square([Infinity,10,NaN,10]); const malformed={...odd,regions:[{...odd.regions[0],loops:[[0,1,2,3,99]]}]};
  const result=roundedNetwork(malformed,.6)!; expect(result.vertices.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y))).toBe(true);
  expect(vectorStrokePath(result).length).toBeGreaterThan(0);
});

it("uses the drawn contour for hit testing, fill paint, stroke and width geometry while saving the authored points", () => {
  const e=new EditorEngine(),id=String(e.execute("vector.create",{points:[[0,0],[1000,0],[1000,1000],[0,1000]],closed:true}).id);
  e.execute("node.set",{id,props:{cornerRadius:200,cornerSmoothing:1,fill:"#ff0000"}});
  const doc=e.getSnapshot().document, node=doc.nodes[id] as VectorNode, drawn=drawnVectorNetwork(node);
  expect(node.network.vertices).toHaveLength(4); expect(drawn.vertices.length).toBeGreaterThan(4);
  expect(shapePath(node)).toEqual(vectorFillPath(drawn)); expect(vectorPaintRegions(node)[0].path).toEqual(shapePath(node));
  expect(strokeGeometry(node)).toEqual(vectorStrokePath(drawn)); expect(vectorStrokePlan(node).clip).toEqual(strokeGeometry(node));
  const firstInside=(net:VectorNetwork)=>{ let lo=0,hi=500; for(let i=0;i<20;i++) { const x=(lo+hi)/2; if(vectorFillContains(net,p(x,20))) hi=x; else lo=x; }return hi; };
  const a=firstInside(node.network), b=firstInside(drawn); expect(Math.abs(a-b)).toBeGreaterThan(5);
  const point=p((a+b)/2,20); expect(vectorFillContains(node.network,point)).not.toBe(vectorFillContains(drawn,point));
  expect(hitRectangle(doc,point)).toBe(vectorFillContains(drawn,point)?id:undefined);
  expect(hitRectangle(doc,p(500,500))).toBe(id);
  expect(networkCubic(node.network,0)![0]).toMatchObject({ x: 0, y: 0, radius: 200 });
});

it("keeps styled-region geometry, stored winding and paint metadata consistent in both traversal directions", () => {
  const e = new EditorEngine();
  const id = String(e.execute("vector.create", { path: "M0 0H100V100H0Z", props: { fill:"#00ff00" } }).id);
  e.execute("node.set", { id, props: { cornerRadius:20, cornerSmoothing:.6 } });
  const node = e.getSnapshot().document.nodes[id] as VectorNode;
  for (let mask = 0; mask < 16; mask++) {
    const segments = node.network.segments.map((s,i) => mask & (1 << i) ? { a:s.b, b:s.a, ta:s.tb, tb:s.ta } : s);
    const region = { ...node.network.regions[0], fills:[solidPaint(fromRgba8(254,0,12))], winding:"evenOdd" as const };
    for (const loop of [[0,1,2,3], [3,2,1,0]]) {
      const styled = { ...node, network:freezeNetwork({ ...node.network, segments, regions:[{ ...region, loops:[loop] }] }) };
      const rendered = vectorPaintRegions(styled);
      expect(rendered).toHaveLength(1); expect(rendered[0].rule).toBe("evenodd");
      expect(rendered[0].paints).toEqual(region.fills);
      expect(Math.abs(area(rendered[0].path) - area(roundedRect(100,100,{radii:[20,20,20,20],smoothing:.6})))).toBeLessThan(.1);
    }
  }
});

it("keeps sharp points and junctions intact and bounds smoothing to the supported interval", () => {
  const sharp = square([0]); expect(roundedNetwork(sharp,1)).toBeUndefined();
  const net = square([20]), network = freezeNetwork({ ...net, vertices:[...net.vertices,{x:-50,y:-20,radius:0}],
    segments:[...net.segments,{a:0,b:4,ta:[0,0],tb:[0,0]}] });
  const result=roundedNetwork(network,1)!; expect(result.vertices[0]).toMatchObject({x:0,y:0,radius:0});
  expect(roundedNetwork(network,2)).toBe(result);
  const plain=roundedNetwork(network,-3); expect(plain).toBe(roundedNetwork(network,0));
  expect(plain).not.toEqual(result);
});

import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { freezeNetwork, networkFromPoints, vectorLine, vectorVertex, type VectorNetwork } from "../../src/engine/vector-network";
import { connectVectorPoints, joinVectorPoints } from "../../src/engine/vector-connect";
import { deleteVertices } from "../../src/engine/vector-edit-ops";
import { vectorFillContains, vectorFillPath, vectorRegionPath, vectorStrokePath } from "../../src/engine/vector-path";
import { measurePath, nearestOnPolylines, polylineLength } from "../../src/engine/path-measure";
import type { VectorNode } from "../../src/engine/document";
import { roundedNetwork } from "../../src/engine/vector-rounded";
import { decodeFigcraft } from "../../src/engine/file-format";

const p = (x: number, y: number) => ({ x, y });
const vertices = (coords: readonly (readonly [number, number])[]) => coords.map(([x, y]) => vectorVertex(x, y));
const shape = (e: EditorEngine, id: string) => (e.getSnapshot().document.nodes[id] as VectorNode).network;

it("connecting_the_ends_of_a_hole_keeps_its_winding for either click order and retains region paints", () => {
  const ring = freezeNetwork({
    vertices: vertices([[0,0],[100,0],[100,100],[0,100],[25,25],[75,25],[75,75],[25,75]]),
    segments: [0,1,2,3,4,5,6,7].map(i => vectorLine(i, i % 4 === 3 ? i - 3 : i + 1)),
    regions: [{ loops: [[0,1,2,3],[7,6,5,4]], winding: "nonZero", fills: [], paintSpace: { width: 100, height: 100, transform: [1,0,0,1,0,0] } }],
  });
  const broken = deleteVertices(ring, [5]);
  expect(vectorFillContains(ring, p(70,30))).toBe(false);
  for (const [a,b] of [[4,5],[5,4]]) {
    const connected = connectVectorPoints(broken, a, b)!;
    expect(connected.network.regions).toHaveLength(1);
    const [outer, inner] = connected.network.regions[0].loops;
    expect(outer).toEqual([0,1,2,3]); expect(inner).toHaveLength(3); expect(inner).toContain(connected.segment);
    expect(connected.network.regions[0]).toMatchObject({ fills: [], paintSpace: ring.regions[0].paintSpace });
    expect([p(40,60),p(10,50),p(70,30)].map(pt => vectorFillContains(connected.network, pt))).toEqual([false,true,true]);
  }
});

it("leaves a disordered filled loop alone and inserts at an internal gap of an ordered loop", () => {
  const net = networkFromPoints([p(0,0),p(100,0),p(100,100),p(0,100),p(-50,50)], false);
  const close = (loop: number[]) => connectVectorPoints(freezeNetwork({ ...net, regions: [{ winding: "evenOdd", loops: [loop] }] }), 0, 4)!.network;
  expect(close([0,2,1,3]).regions[0].loops).toEqual([[0,2,1,3]]);
  expect(close([1,2,3,0]).regions[0].loops).toEqual([[1,2,3,4,0]]);
});

it("matches every native direction and start permutation of a rounded five-corner chamfer", () => {
  const corners = [p(0,0),p(50,0),p(100,50),p(100,100),p(0,100)], base = networkFromPoints(corners, true);
  for (let first=0; first<5; first++) for (const backwards of [false, true]) for (let flips=0; flips<32; flips++) {
    const loop = Array.from({ length: 5 }, (_,i) => (first+i)%5); if (backwards) loop.reverse();
    const net = freezeNetwork({ vertices: base.vertices.map(v => ({ ...v, radius: 43 })), segments: base.segments.map((s,i) => flips & (1<<i) ? vectorLine(s.b,s.a) : s), regions: [{ winding: "nonZero", loops:[loop] }] });
    const paths = [vectorStrokePath(net), vectorFillPath(net), vectorRegionPath(roundedNetwork(net)!, 0)!];
    const lengths = paths.map(path => {
      const measured = measurePath(path, 40000, .01)!;
      for (const corner of corners) expect(nearestOnPolylines(measured, corner)!.distance, JSON.stringify({first,backwards,flips,corner})).toBeGreaterThan(2);
      return measured.reduce((sum, line) => sum + polylineLength(line), 0);
    });
    expect(lengths[1]).toBeCloseTo(lengths[0], 6); expect(lengths[2]).toBeCloseTo(lengths[0], 6);
  }
});

it("joins sorted endpoint pairs, includes exactly two interior points and merges strict sub-half-pixel overlaps", () => {
  const net = freezeNetwork({ vertices: vertices([[0,0],[10,0],[20,0],[40,0],[50,0],[60,0]]), segments: [vectorLine(0,1),vectorLine(1,2),vectorLine(3,4),vectorLine(4,5)], regions: [] });
  const pairs = joinVectorPoints(net, [5,2,1,4,3,0,2,900], false);
  expect(pairs.joins).toBe(2); expect(pairs.network.segments.slice(4).map(s=>[s.a,s.b])).toEqual([[0,2],[3,5]]);
  expect(joinVectorPoints(net,[4,1],false).network.segments.at(-1)).toEqual(vectorLine(1,4));
  // Isolated equidistant partners resolve to the first in sorted order.
  const ties = freezeNetwork({ vertices: vertices([[0,0],[5,0],[-5,0]]), segments: [], regions: [] });
  expect(joinVectorPoints(ties,[2,0,1],false).network.segments).toEqual([vectorLine(0,1)]);
  for (const gap of [.499,.5]) {
    const line = networkFromPoints([p(0,0),p(gap,0)],false);
    expect(joinVectorPoints(line,[1,0],true).network.vertices.length).toBe(gap<.5 ? 1 : 2);
  }
});

it("smooth joins continue endpoint tangents and use the chord for isolated points", () => {
  const net = freezeNetwork({ vertices: vertices([[0,0],[0,30],[90,30],[90,60]]), segments: [{ ...vectorLine(0,1), tb:[-3,0] }, vectorLine(2,3)], regions: [] });
  const link = joinVectorPoints(net,[2,1],true).network.segments.at(-1)!;
  expect(link.ta[0]).toBeCloseTo(30); expect(link.ta[1]).toBeCloseTo(0);
  expect(link.tb[0]).toBeCloseTo(0); expect(link.tb[1]).toBeCloseTo(-30);
  const isolated = freezeNetwork({ ...net, segments: [] });
  const chord = joinVectorPoints(isolated,[1,2],true).network.segments[0];
  expect(chord.ta[0]).toBe(30); expect(chord.tb[0]).toBe(-30); expect(Math.abs(chord.tb[1])).toBe(0);
});

it("routes edit joins to the active part and explicit connect through the paired network operation", () => {
  const e = new EditorEngine(), id = String(e.execute("vector.create", { points: [[0,0],[100,0],[100,100]] }).id);
  e.execute("vector.edit.begin"); e.execute("vector.edit.select", { vertices: [0,2] });
  expect(e.execute("vector.join", { ids: ["999"] })).toEqual({ joins: 1 }); expect(shape(e,id).regions).toHaveLength(1);
  e.execute("edit.undo"); expect(shape(e,id).segments).toHaveLength(2);
  const before = e.getSnapshot(); expect(() => e.execute("vector.edit.connect", {a:1,b:1})).toThrow("can't connect"); expect(e.getSnapshot()).toBe(before);
  expect(e.execute("vector.edit.connect", {a:0,b:2.9})).toEqual({segment:2});
  e.execute("vector.edit.select", {segments:[0]}); expect(e.execute("vector.smoothJoin")).toEqual({joins:1});
  expect(e.getVectorEdit()?.segments).toEqual([]);
});

it("layer join closes one network in place, preserves no-ops, and uses flatten for several layers", async () => {
  for (const command of ["vector.join","vector.smoothJoin"]) {
    const e = new EditorEngine(), id = String(e.execute("vector.create",{points:[[5,5],[80,5],[60,70]]}).id);
    const open = e.getSnapshot().document; expect(e.execute(command)).toEqual({ok:true});
    expect(shape(e,id).regions[0].loops).toEqual([[0,1,2]]); e.execute(command); e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(open);
    const rect = String(e.execute("shape.rectangle",{x:200,y:150}).id), before = e.getSnapshot().document;
    e.execute(command); expect(e.getSnapshot().document).toBe(before);
    expect(() => e.execute(command,{ids:[id,"bad"]})).toThrow();
    const joined = String(e.execute(command,{ids:[id,rect]}).id);
    expect(e.getSnapshot().selection).toEqual([joined]); expect(e.getSnapshot().document.nodes[id]).toBeUndefined();
    expect((await decodeFigcraft(await e.nativeSnapshot())).document.nodes[joined]).toMatchObject({kind:"vector"});
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  }
});

it("both split orders and both delete/heal and delete/connect produce the rounded chamfer", () => {
  for (const segments of [[0,1],[1,0]]) for (const heal of [false,true]) {
    const e = new EditorEngine(), id = String(e.execute("shape.rectangle",{x:0,y:0,width:100,height:100}).id);
    e.execute("vector.edit.begin");
    for (const segment of segments) e.execute("vector.edit.addVertex",{segment,t:.5});
    const find = (x: number,y: number) => shape(e,id).vertices.findIndex(v=>v.x===x && v.y===y);
    e.execute("vector.edit.select",{vertices:[find(100,0)]});
    e.execute(heal ? "vector.deleteHeal" : "vector.edit.delete");
    if (!heal) {
      expect(shape(e,id).regions[0].loops[0]).toHaveLength(4);
      e.execute("vector.edit.connect",{a:find(50,0),b:find(100,50)});
    }
    const pentagon = shape(e,id); expect(pentagon.regions[0].loops[0]).toHaveLength(5);
    e.execute("vector.edit.cornerRadius",{vertices:[0,1,2,3,4],radius:43});
    const rounded = shape(e,id), fill = measurePath(vectorFillPath(rounded),40000,.01)!, stroke = measurePath(vectorStrokePath(rounded),40000,.01)!;
    expect(polylineLength(fill[0])).toBeCloseTo(polylineLength(stroke[0]),6);
    for (const corner of pentagon.vertices) expect(nearestOnPolylines(fill,corner)!.distance).toBeGreaterThan(2);
  }
});

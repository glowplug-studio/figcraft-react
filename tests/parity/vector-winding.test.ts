import { describe, expect, it } from "vitest";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { vectorLine, vectorVertex, type VectorNetwork } from "../../src/engine/vector-network";
import { pathWinding, vectorFillContains, vectorRegionContains, vectorRegionPath } from "../../src/engine/vector-path";

const centre = { x: 50, y: 50 };
const ring = "M0 0H100V100H0Z M25 25H75V75H25Z";
function session() {
  const engine = new EditorEngine();
  const id = String(engine.execute("vector.create", { path: ring }).id);
  const document = () => engine.getSnapshot().document;
  const network = () => (document().nodes[id] as VectorNode).network;
  return { engine, id, document, network };
}
const region = (edges: number[]) => ({ loops: [edges], winding: "nonZero" as const });
const lenses: VectorNetwork = {
  vertices: [vectorVertex(0, 0), vectorVertex(100, 0)],
  segments: [vectorLine(0, 1), { a: 1, b: 0, ta: [0,-50], tb: [0,-50] }, { a: 0, b: 1, ta: [0,50], tb: [0,50] }],
  regions: [region([0,1]), region([2,0])],
};
async function loadNetworks(s: ReturnType<typeof session>, networks: VectorNetwork[]) {
  const ids = networks.map((_, i) => i ? String(s.engine.execute("vector.create", { path: ring }).id) : s.id);
  const doc = s.document(), nodes = { ...doc.nodes };
  for (const [i,id] of ids.entries()) nodes[id] = { ...(nodes[id] as VectorNode), network: networks[i] };
  await s.engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...doc, nodes })) });
  return ids;
}
describe("upstream vector fill rule and reverse loop", () => {
  it("uses non-zero winding to make and unmake a hole without disturbing the band or segment storage", () => {
    const s = session(), before = s.document(), net = s.network();
    expect(vectorRegionContains(net, 0, centre)).toBe(true);
    expect(s.engine.execute("vector.reverseLoop", { region: 0, loop: 1 })).toEqual({ reversed: true });
    expect(vectorFillContains(s.network(), centre)).toBe(false);
    expect(vectorRegionContains(s.network(), 0, { x: 10, y: 50 })).toBe(true);
    expect(s.network().segments).toEqual(net.segments);
    s.engine.execute("edit.undo"); expect(s.document()).toBe(before);
    for (const rule of ["evenOdd"," EVENODD ","evenodd","nonzero","NONZERO","nonZero"]) {
      const odd = rule.trim().toLowerCase() === "evenodd";
      expect(s.engine.execute("vector.fillRule", { id: s.id, region: null, rule })).toEqual({ regions: 1, rule: odd ? "evenOdd" : "nonZero" });
      expect(vectorFillContains(s.network(), centre)).toBe(!odd);
    }
  });
  it("targets one or all areas across eligible layers, preserving independent paints", async () => {
    const s = session(), marked = { ...lenses, regions: lenses.regions.map(r => ({ ...r, fills: [] })) };
    const ids = await loadNetworks(s,[marked,marked]);
    const rectangle = s.engine.execute("shape.rectangle").id;
    expect(s.engine.execute("vector.fillRule", { ids: [rectangle,...ids], region: "1", rule: "evenOdd" })).toEqual({ regions: 2, rule: "evenOdd" });
    expect(s.network().regions.map(r => r.winding)).toEqual(["nonZero","evenOdd"]);
    expect(s.engine.execute("vector.fillRule", { ids, rule: "evenOdd" }).regions).toBe(4);
    expect(s.network().regions.every(r => r.winding === "evenOdd" && r.fills?.length === 0)).toBe(true);
    const depth = s.engine.getUndoDepth();
    s.engine.execute("vector.fillRule", { ids, rule: "evenOdd" });
    expect(s.engine.getUndoDepth()).toBe(depth);
  });
  it("reverses a long loop while the adjoining square keeps its shared edge and winding", async () => {
    const s = session();
    const squares = {
      vertices: [[0,0],[50,0],[100,0],[100,100],[50,100],[0,100]].map(([x,y]) => vectorVertex(x,y)),
      segments: [[0,1],[1,4],[4,5],[5,0],[1,2],[2,3],[3,4]].map(([a,b]) => vectorLine(a,b)),
      regions: [region([0,1,2,3]),region([4,5,6,1])],
    };
    await loadNetworks(s,[squares]);
    const winds = () => [25,75].map((x,i) => pathWinding(vectorRegionPath(s.network(), i)!, { x, y: 50 }));
    const [left,right] = winds();
    expect(Math.abs(left)).toBe(1); expect(Math.abs(right)).toBe(1);
    s.engine.execute("vector.reverseLoop", { id: s.id, region: 0, loop: 0 });
    expect(winds()).toEqual([-left,right]); expect(s.network().segments).toEqual(squares.segments);
  });
  it("turns either two-segment lens without changing the shared edge or neighbouring winding", async () => {
    const s = session(); await loadNetworks(s,[lenses]);
    const wind = () => [-25,25].map((y,i) => pathWinding(vectorRegionPath(s.network(), i)!, { x: 50, y }));
    const [above, below] = wind(); expect(Math.abs(above)).toBe(1); expect(Math.abs(below)).toBe(1);
    for (const i of [0,1]) {
      s.engine.execute("vector.reverseLoop",{ id: s.id, region: i, loop: 0 });
      expect(s.network().segments[0]).toEqual(lenses.segments[0]);
      expect(wind()).toEqual([-above, i === 0 ? below : -below]);
    }
    s.engine.execute("edit.undo"); expect(wind()).toEqual([-above,below]);
  });
  it("reverses a one-edge area and atomically refuses a shared short loop on a later target", async () => {
    const s = session(), curved = { ...lenses, segments: [lenses.segments[1]], regions: [region([0])] };
    const ids = await loadNetworks(s,[curved,{ ...curved, regions: [region([0]),region([0])] }]);
    const before = s.document(), depth = s.engine.getUndoDepth();
    expect(() => s.engine.execute("vector.reverseLoop", { ids, region: 0, loop: 0 })).toThrow("shares its segments");
    expect(s.document()).toBe(before); expect(s.engine.getUndoDepth()).toBe(depth);
    const point = { x: 50, y: -25 }, wind = () => pathWinding(vectorRegionPath(s.network(), 0)!, point), original = wind();
    s.engine.execute("vector.reverseLoop", { id: ids[0], region: 0, loop: 0 });
    expect(Math.abs(original)).toBe(1); expect(wind()).toBe(-original);
  });
  it("rejects malformed rules, missing indices, unknown targets and denied editing without changing geometry", () => {
    const s = session(), rect = s.engine.execute("shape.rectangle").id, before = s.document(), depth = s.engine.getUndoDepth();
    for (const p of [{ rule: 7 },{ rule: "EvenOdd" },{},{ rule: "nonZero", region: -1 },{ rule: "nonZero", region: 1.5 },{ rule: "nonZero", region: "x" },{ rule: "nonZero", region: 99 },{ rule: "evenOdd", ids: [s.id, "999"] },{ rule: "evenOdd", ids: [rect] }]) {
      expect(() => s.engine.execute("vector.fillRule", { id: s.id, ...p })).toThrow();
    }
    for (const p of [{},{ region: 0 },{ region: 0, loop: 99 },{ region: 1e9, loop: 0 }]) expect(() => s.engine.execute("vector.reverseLoop", { id: s.id, ...p })).toThrow();
    expect(s.document()).toBe(before); expect(s.engine.getUndoDepth()).toBe(depth);
    s.engine.setEditable(false);
    expect(() => s.engine.execute("vector.fillRule", { id: s.id, rule: "evenOdd" })).toThrow("Sign in");
  });
});

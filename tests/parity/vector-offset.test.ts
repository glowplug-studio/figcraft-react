import { describe, expect, it } from "vitest";
import { identity, inverse, multiply, transformPoint } from "../../src/engine/affine";
import { fromRgba8 } from "../../src/engine/colour";
import { type LayerNode, type VectorNode, type BooleanNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft, decodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { solidPaint } from "../../src/engine/solid-paint";
import { measurePath, polylineLength } from "../../src/engine/path-measure";
import { cornerPath } from "../../src/engine/corners";
import { vectorFillContains, vectorFillPath } from "../../src/engine/vector-path";

function worldHit(e: EditorEngine, id: string, x: number, y: number) {
  const doc = e.getSnapshot().document;
  return vectorFillContains((doc.nodes[id] as VectorNode).network, transformPoint(inverse(worldTransform(doc,id)), { x, y }));
}
describe("native Offset path", () => {
  it("grows a plain rectangle with round corners, retains its ID and undoes all selected targets together", () => {
    const e = new EditorEngine();
    const create = (x: number) => String(e.execute("shape.rectangle", { x, y: 50, width: 50, height: 40, props: { fill: "blue" } }).id);
    const ids = [create(50), create(200)];
    e.execute("select.set", { ids });
    const before = e.getSnapshot();
    expect(e.execute("vector.offset", { offset: 10 })).toEqual({ ok:true });
    for (const [i,id] of ids.entries()) {
      const x = i ? 200 : 50, d=e.getSnapshot().document;
      expect(d.nodes[id]).toMatchObject({ kind: "vector", x: expect.closeTo(x-10,3), y: expect.closeTo(40,3), width: expect.closeTo(70,3), height: expect.closeTo(60,3), fill: "#0000ff" });
      expect(worldHit(e,id,x-7,68)).toBe(true);
      expect(worldHit(e,id,x-9,41)).toBe(false);
    }
    expect(e.getSnapshot().selection).toEqual(ids);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before.document);
  });
  it("skips populated containers, preserves zero-distance geometry and collapses an eroded region", () => {
    const e = new EditorEngine(), id = String(e.execute("shape.rectangle", { x:5, y:10, width:20, height:20 }).id);
    const group = String(e.execute("object.group", {id}).id), before = e.getSnapshot().document;
    e.execute("vector.offset", { id:group, offset:8 });
    e.execute("vector.offset", { id, offset:0 });
    expect(e.getSnapshot().document).toBe(before);
    e.execute("vector.offset", { id, offset:-4 });
    expect((e.getSnapshot().document.nodes[id] as LayerNode).width).toBeCloseTo(12);
    e.execute("vector.offset", { id, offset:-20 });
    expect(e.getSnapshot().document.nodes[id]).toMatchObject({ kind:"vector", width:0, height:0, network:{ vertices:[], segments:[], regions:[] } });
    expect((e.getSnapshot().document.nodes[group] as BooleanNode).children).toEqual([id]);
    expect(()=>e.execute("vector.offset", {id,offset:"bad"})).toThrow("number");
  });
  it("preserves legacy even-odd holes and world paint space through rebasing and native files", async () => {
    const e = new EditorEngine(), id = String(e.execute("vector.create", { x:40,y:90,path:"M0 0H100V100H0Z M25 25H75V75H25Z" }).id);
    e.execute("vector.fillRule", { id, rule:"evenOdd" });
    const baseline = worldTransform(e.getSnapshot().document,id);
    e.execute("vector.offset", { id, offset:5 });
    expect(worldHit(e,id,90,140)).toBe(false);
    expect(worldHit(e,id,66,135)).toBe(true);
    expect(worldHit(e,id,36,140)).toBe(true);
    const doc = (await decodeFigcraft(await e.nativeSnapshot())).document;
    const layer = doc.nodes[id] as VectorNode, frame = layer.network.regions[0].paintSpace!;
    expect(frame).toMatchObject({width:100,height:100});
    expect(multiply(worldTransform(doc,id),frame.transform)).toEqual(baseline);
    expect(layer.network.regions[0].winding).toBe("evenOdd");
  });
  it("offsets each painted region independently and retains empty versus inherited fills", async () => {
    const e = new EditorEngine(), id = String(e.execute("vector.create", { x:0,y:0,path:"M0 0H40V40H0Z M60 0H90V30H60Z M110 0H112V2H110Z" }).id);
    const initial = e.getSnapshot().document, node = initial.nodes[id] as VectorNode, loops = node.network.regions[0].loops;
    const regions = loops.map((loop,i) => ({ loops:[loop], winding:"evenOdd" as const,
      ...(i===0 ? { fills:[] } : i===2 ? { fills:[solidPaint(fromRgba8(255,0,0))] } : {}),
      paintSpace:{width:200,height:150,transform:identity} }));
    const data = await encodeFigcraft({...initial,nodes:{...initial.nodes,[id]:{...node,network:{...node.network,regions}}}});
    await e.executeAsync("file.open",{ data:Buffer.from(data).toString("base64") });
    e.execute("vector.offset", {id,offset:-3});
    const v=e.getSnapshot().document.nodes[id] as VectorNode;
    expect(v.network.regions).toHaveLength(2);
    expect(v.network.regions[0].fills).toEqual([]);
    expect(v.network.regions[1].fills).toBeUndefined();
    for(const region of v.network.regions) {
      expect(region.paintSpace).toMatchObject({width:200,height:150});
      expect(multiply(worldTransform(e.getSnapshot().document,id),region.paintSpace!.transform)).toEqual(identity);
    }
  });
  it("keeps the drawn corner curvature for both inherited and painted regions", async () => {
    function area(points: readonly { x:number; y:number }[]) {
      let sum=0;
      for (let i=0; i<points.length; i++) {
        const a=points[i], b=points[(i+1)%points.length];
        sum += a.x*b.y-b.x*a.y;
      }
      return Math.abs(sum/2);
    }
    for (const painted of [false,true]) {
      const e=new EditorEngine(), id=String(e.execute("vector.create", { path:"M0 0H100V100H0Z" }).id);
      e.execute("node.set",{id,props:{cornerRadius:20, cornerSmoothing:0.6}});
      const doc=e.getSnapshot().document, node=doc.nodes[id] as VectorNode;
      const reference=measurePath(cornerPath({ ...node, corners:{radii:[20,20,20,20],smoothing:0.6} }),40000,0.0005)![0];
      const grown=area(reference.points)+2*polylineLength(reference)+4*Math.PI;
      if (painted) {
        const regions=node.network.regions.map(r=>({...r,fills:[solidPaint(fromRgba8(1,2,3))]}));
        const data=await encodeFigcraft({...doc,nodes:{...doc.nodes,[id]:{...node,network:{...node.network,regions}}}});
        await e.executeAsync("file.open",{data:Buffer.from(data).toString("base64")});
      }
      e.execute("vector.offset",{id,offset:2});
      const v=e.getSnapshot().document.nodes[id] as VectorNode;
      const outline=measurePath(vectorFillPath(v.network),40000,0.0005)!;
      expect(outline).toHaveLength(1);
      expect(Math.abs(area(outline[0].points)-grown)).toBeLessThan(4);
    }
  });
  it("rolls back earlier targets if the contour budget refuses a later one", () => {
    const e=new EditorEngine(), first=String(e.execute("shape.rectangle").id);
    const bars=Array.from({length:750},(_,i)=>`M0 ${4*i}h3000v2h-3000z M${4*i} 0h2v3000h-2z`).join(" ");
    const dense=String(e.execute("vector.create",{path:bars}).id);
    const before=e.getSnapshot(), depth=e.getUndoDepth();
    expect(()=>e.execute("vector.offset",{ids:[first,dense],offset:1})).toThrow("too complex");
    expect(e.getSnapshot()).toBe(before);
    expect(e.getUndoDepth()).toBe(depth);
  });
});

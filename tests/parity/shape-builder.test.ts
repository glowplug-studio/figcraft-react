import { describe, expect, it } from "vitest";
import { identity, multiply, type Affine } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { fromRgba8 } from "../../src/engine/colour";
import { solidPaint } from "../../src/engine/solid-paint";
import { encodeFigcraft } from "../../src/engine/file-format";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { builderArrangement, builderRegionAt } from "../../src/engine/shape-builder";
import { ShapeBuilderInteraction } from "../../src/engine/shape-builder-interaction";
import { parseSvgPath } from "../../src/engine/svg-path";
import { pathWinding } from "../../src/engine/vector-path";

function squares() {
  const engine = new EditorEngine();
  const rectangle = (x: number, y: number, fill: string) =>
    String(engine.execute("shape.rectangle", { x, y, width: 10, height: 10, props: { fill } }).id);
  const a = rectangle(0, 0, "#ff0000"), b = rectangle(5, 5, "#0000ff");
  return { engine, a, b, ids: [a,b] };
}

describe("Shape Builder native commands", () => {
  it("reports page-space paths, inside points and top-most sources with a versioned cache", () => {
    const {engine, a, b, ids} = squares();
    const doc = engine.getSnapshot().document, arrangement = builderArrangement(doc, ids);
    const wire = engine.execute("shapeBuilder.regions", {ids});
    expect(wire.sources).toEqual([a,b]);
    expect(wire.regions).toHaveLength(3);
    expect(wire.regions[builderRegionAt(arrangement, {x:7,y:7})].parts).toEqual([{id:b,stroke:false},{id:a,stroke:false}]);
    for (const region of wire.regions) {
      const [x,y] = region.point!;
      expect(builderRegionAt(arrangement,{x,y})).toBe(region.index);
      expect(pathWinding(parseSvgPath(region.path), {x,y})).not.toBe(0);
    }
    expect(builderArrangement(doc,[a,b])).toBe(arrangement);
    engine.execute("node.set",{id:b,props:{x:30}});
    expect(builderArrangement(engine.getSnapshot().document,ids).regions).toHaveLength(2);
  });
  it("merges an overlap with the top-most style and restores both rectangles in one undo", () => {
    const {engine,a,b,ids} = squares(), before = engine.getSnapshot().document, depth = engine.getUndoDepth();
    const result = engine.execute("shapeBuilder.merge", {ids,points:[[7,7],[7,7],[NaN,3]]});
    const id = String(result.id), doc = engine.getSnapshot().document;
    expect(result).toEqual({id,changed:[a,b],removed:[],outlines:[],regions:[1]});
    expect(doc.nodes[id]).toMatchObject({kind:"vector",fill:"#0000ff",width:5,height:5,x:5,y:5});
    expect(doc.nodes[a]).toMatchObject({kind:"vector",fill:"#ff0000"});
    expect(doc.nodes[b]).toMatchObject({kind:"vector",fill:"#0000ff"});
    expect(engine.getSnapshot().selection).toEqual([a,b,id]);
    expect(engine.getUndoDepth()).toBe(depth+1);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(before);
  });
  it("dissolves all shared edges, removes exhausted sources and preserves the native whole-shape no-op", () => {
    const {engine,a,b,ids} = squares();
    const result = engine.execute("shapeBuilder.merge", {ids,regions:[0,1,2]});
    const id = String(result.id), doc = engine.getSnapshot().document;
    expect(result.removed).toEqual([a,b]);
    expect(engine.getSnapshot().selection).toEqual([id]);
    const [r] = engine.execute("shapeBuilder.regions").regions;
    expect(parseSvgPath(r.path).filter(c => c[0] === "M")).toHaveLength(1);
    expect(engine.execute("shapeBuilder.merge", {regions:[0]})).toEqual({id:null,changed:[],removed:[],outlines:[],regions:[0]});
    expect(engine.getSnapshot().document).toBe(doc);
  });
  it("removes just the picked regions and refuses an empty or invalid pick atomically", () => {
    const {engine,a,b,ids} = squares();
    expect(engine.execute("shapeBuilder.remove", {ids,points:[[7,7],[12,12]]})).toMatchObject({id:null,changed:[a],removed:[b]});
    expect(engine.getSnapshot().selection).toEqual([a]);
    const before = engine.getSnapshot();
    expect(() => engine.execute("shapeBuilder.remove",{regions:[-1,1.5,Infinity],points:[[],[100,100]]})).toThrow("no region picked");
    expect(engine.getSnapshot()).toBe(before);
  });
  it("splits an open stroke into independently painted regions and outlines the two retained ends", () => {
    const engine = new EditorEngine();
    const square = String(engine.execute("shape.rectangle",{x:0,y:0,width:100,height:100,props:{fill:"red"}}).id);
    const line = String(engine.execute("vector.create",{x:-20,y:50,path:"M0 0H140"}).id);
    engine.execute("node.set",{id:line,props:{strokes:["black"],strokeWeight:10,strokeAlign:"center"}});
    const ids = [square,line], before = engine.getSnapshot().document, a = builderArrangement(before,ids);
    expect(a.regions).toHaveLength(5);
    const hit = builderRegionAt(a,{x:50,y:50});
    expect(a.regions[hit].parts.map(p => [p.id,p.stroke])).toEqual([[line,true],[square,false]]);
    const result = engine.execute("shapeBuilder.merge",{ids,regions:[hit]});
    expect(result.changed).toEqual([square]);
    expect(result.removed).toEqual([line]);
    expect(result.outlines).toHaveLength(1);
    const doc = engine.getSnapshot().document, created = doc.nodes[String(result.id)];
    expect(created).toMatchObject({kind:"vector",fill:"#000000",width:100,height:10});
    const outline = (result.outlines as string[])[0];
    expect(builderArrangement(doc,[outline]).regions).toHaveLength(2);
    expect(engine.getSnapshot().selection).toEqual([square,outline,result.id]);
  });
  it("preserves distinct regional paints, including empty fills, and transformed source frames", async () => {
    const engine = new EditorEngine();
    const id = String(engine.execute("vector.create",{path:"M0 0H50V100H0Z M50 0H100V100H50Z"}).id);
    const doc = engine.getSnapshot().document, vector = doc.nodes[id] as VectorNode;
    const transform: Affine = [1,0.25,-0.1,1,120,80], blue = solidPaint(fromRgba8(0,0,255));
    const regions = vector.network.regions[0].loops.map((loop,i) => ({
      loops:[loop], winding:"nonZero" as const, fills:i ? [blue] : [], paintSpace:{width:220,height:180,transform:identity},
    }));
    const data = await encodeFigcraft({...doc,nodes:{...doc.nodes,[id]:{...vector,x:120,y:80,transform,network:{...vector.network,regions}}}});
    await engine.executeAsync("file.open",{data:Buffer.from(data).toString("base64")});
    const wire = engine.execute("shapeBuilder.regions",{id});
    expect(wire.regions).toHaveLength(2);
    const result = engine.execute("shapeBuilder.merge",{id,points:[wire.regions[1].point]});
    const merged = String(result.id), updated = engine.getSnapshot().document;
    for (const [key,expected] of [[id,[]],[merged,[blue]]] as const) {
      const v = updated.nodes[key] as VectorNode, r = v.network.regions[0];
      expect(r.fills).toEqual(expected);
      expect(r.paintSpace).toMatchObject({width:220,height:180});
      const frame = multiply(worldTransform(updated,key),r.paintSpace!.transform);
      frame.forEach((value,i) => expect(value).toBeCloseTo(transform[i],10));
    }
    engine.execute("edit.undo");
    const all = engine.execute("shapeBuilder.merge",{id,points:[wire.regions[1].point,wire.regions[0].point]});
    expect(all.removed).toEqual([id]);
    expect((engine.getSnapshot().document.nodes[String(all.id)] as VectorNode).network.regions[0].fills).toEqual([blue]);
  });
  it("deduplicates groups and excludes frames, locked shapes and boolean children", () => {
    const {engine,a,b,ids} = squares();
    const group = String(engine.execute("object.group",{ids}).id);
    expect(engine.execute("shapeBuilder.regions",{ids:[group,group,a,b]}).sources).toEqual([a,b]);
    engine.execute("node.set",{id:a,props:{locked:true}});
    expect(engine.execute("shapeBuilder.regions",{id:group}).sources).toEqual([b]);
    const frame = String(engine.execute("frame.create",{x:50,y:50,width:40,height:40}).id);
    expect(engine.execute("shapeBuilder.regions",{id:frame}).regions).toEqual([]);
    engine.execute("node.set",{id:a,props:{locked:false}});
    const boolean = String(engine.execute("bool.union",{ids}).id);
    expect(engine.execute("shapeBuilder.regions",{ids:[a,b]}).sources).toEqual([]);
    expect(engine.execute("shapeBuilder.regions",{id:boolean}).sources).toEqual([boolean]);
  });

  it("inverts the starting mode with Alt and samples every crossed region of a fast drag", () => {
    const {engine,a,b,ids} = squares();
    const controls = {altKey:true,shiftKey:false,ctrlKey:false,metaKey:false};
    engine.execute("tool.shapeBuilder");
    engine.execute("select.set",{ids});
    const tool = new ShapeBuilderInteraction(engine);
    tool.down({x:2,y:2},controls);
    tool.move({x:13,y:13},false);
    tool.up({x:13,y:13},{...controls,altKey:false});
    expect(engine.getSnapshot().document.nodes[a]).toBeUndefined();
    expect(engine.getSnapshot().document.nodes[b]).toBeUndefined();
    engine.execute("edit.undo");
    engine.execute("shapeBuilder.mode",{mode:"remove"});
    tool.down({x:7,y:7},controls);
    tool.up({x:7,y:7},controls);
    expect(engine.getSnapshot().selection).toHaveLength(3);
    expect(() => engine.execute("shapeBuilder.mode",{mode:"invalid"})).toThrow("merge or remove");
  });
  it("selects outside current regions and Shift adds the layer under the pointer", () => {
    const {engine,a,b} = squares();
    engine.execute("tool.shapeBuilder");
    engine.execute("select.none");
    const tool = new ShapeBuilderInteraction(engine);
    for (const [x,y,shift] of [[2,2,false],[12,12,true]] as const) {
      const ev = {altKey:false,shiftKey:shift,ctrlKey:false,metaKey:false};
      tool.down({x,y},ev);
      tool.up({x,y},ev);
    }
    expect(engine.getSnapshot().selection).toEqual([a,b]);
  });
  it("rejects a 257th paint part without dropping the source or adding history", async () => {
    const engine = new EditorEngine();
    const path = Array.from({length:257}, (_,i) => `M${i*4} 0h2v2h-2Z`).join(" ");
    const id = String(engine.execute("vector.create",{path}).id);
    const doc = engine.getSnapshot().document, v = doc.nodes[id] as VectorNode;
    const regions = v.network.regions[0].loops.map(loop => ({loops:[loop],winding:"evenOdd" as const,fills:[]}));
    const data = await encodeFigcraft({...doc,nodes:{...doc.nodes,[id]:{...v,network:{...v.network,regions}}}});
    await engine.executeAsync("file.open",{data:Buffer.from(data).toString("base64")});
    const before = engine.getSnapshot(), depth = engine.getUndoDepth();
    for (const command of ["shapeBuilder.regions","shapeBuilder.remove"]) {
      expect(() => engine.execute(command,{id,regions:[0]})).toThrow("too many fill regions");
    }
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.getUndoDepth()).toBe(depth);
  });

});

import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { rectanglePaints, type VectorNode, type LayerNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { readPaint } from "../../src/engine/solid-paint";

const short = { type:"linearGradient", stops:["red","blue"], from:[0,.5], to:[1,.5] };
const long = { type:"gradient", kind:"linear", stops:[
  { position:0, color:{ r:1,g:0,b:0,a:1 } }, { position:1, color:{ r:0,g:0,b:1,a:1 } },
], from:[0,.5], to:[1,.5], width:[0,1.5] };
describe("native gradient command and document routes", () => {
  it("uses the same paint in creation, property edits, stack edits, inspection and native archives", async () => {
    const engine = new EditorEngine(), expected = readPaint(long);
    const id = String(engine.execute("node.create", { type:"rectangle", props:{ fills:[short] } }).id);
    const node = () => engine.getSnapshot().document.nodes[id] as LayerNode;
    expect(rectanglePaints(node())).toEqual([expected]);
    engine.execute("fill.add", {id,paint:long});
    engine.execute("stroke.add", {id,paint:short});
    engine.execute("node.set", {id,props:{strokes:[long],fills:[long, short]}});
    expect(rectanglePaints(node())).toEqual([expected,expected]);
    expect(node().strokes).toEqual([expected]);
    expect(engine.execute("node.get", {id,fields:["fills","strokes"]})).toMatchObject({fills:[long,long],strokes:[long]});
    const archive = await engine.nativeSnapshot(), wire = JSON.parse(strFromU8(unzipSync(archive)["document.json"]));
    expect(wire.nodes[id].strokes).toMatchObject([long]);
    const restored = (await decodeFigcraft(archive)).document.nodes[id] as LayerNode;
    expect(rectanglePaints(restored)).toEqual(rectanglePaints(node()));
    expect(restored.strokes).toEqual(node().strokes);
    engine.execute("fill.set", {id,index:1,paint:short,opacity:.5,visible:false,blend:"passThrough"});
    expect(rectanglePaints(node())[1]).toEqual({...expected,opacity:.5,visible:false,blend:"passThrough"});
    engine.execute("edit.undo");
    expect(rectanglePaints(node())[1]).toEqual(expected);
  });
  it("preserves raw stop order, duplicate positions and source frames in regional copy/paste and reopen", async () => {
    const engine = new EditorEngine();
    const left = engine.execute("shape.rectangle",{width:50,height:50,props:{fills:[short]}}).id;
    const right = engine.execute("shape.rectangle",{x:80,width:40,height:60}).id;
    const id = String(engine.execute("vector.flatten",{ids:[left,right]}).id);
    const node = () => engine.getSnapshot().document.nodes[id] as VectorNode;
    const paint = {...long,kind:"diamond",width:[.3,1.5],stops:[long.stops[1],{...long.stops[0],position:1},{...long.stops[0],position:-1}]};
    engine.execute("vector.edit.begin",{id});
    engine.execute("vector.edit.select",{regions:[1]});
    engine.execute("fill.set",{paint});
    const value = engine.execute("fill.copy");
    expect(value).toMatchObject(paint);
    engine.execute("fill.paste",{regions:[0],index:0});
    expect(node().network.regions.map(region => region.fills)).toEqual([[value],[value]]);
    const original = node(), bytes = await engine.nativeSnapshot();
    await engine.executeAsync("file.open",{data:base64Bytes(bytes)});
    expect(node().network.regions).toEqual(original.network.regions);
  });
  it("refuses malformed handles atomically in a multi-layer edit and when opening a native file", async () => {
    const engine = new EditorEngine();
    const a = engine.execute("shape.rectangle").id, b = engine.execute("shape.rectangle").id;
    const before = engine.getSnapshot(), depth = engine.getUndoDepth();
    expect(()=>engine.execute("node.set",{ids:[a,b],props:{fills:[short,{...short,from:"left"}]}})).toThrow();
    const wire = JSON.parse(strFromU8(unzipSync(await engine.nativeSnapshot())["document.json"]));
    wire.nodes[String(a)].fills = [short];
    await expect(engine.executeAsync("file.open",{data:base64Bytes(new TextEncoder().encode(JSON.stringify(wire)))})).rejects.toThrow();
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.getUndoDepth()).toBe(depth);
  });
});

it("previews only selected region fills and cancels without mutating committed state",()=>{
  const engine=new EditorEngine();
  const id=String(engine.execute("vector.create",{path:"M0 0H60V80H0Z",props:{fills:[short]}}).id);
  engine.execute("vector.edit.begin",{id}); engine.execute("vector.edit.select",{regions:[0]});
  const picker={list:"fill" as const,index:0,stop:0}; engine.setPaintPicker(picker);
  const base=engine.getSnapshot().document, depth=engine.getUndoDepth();
  engine.beginInteraction();
  engine.previewPaint(picker,readPaint({...long,kind:"angular"}));
  expect(engine.getSnapshot().document).toBe(base);
  expect(engine.pickedGradient()?.paint.kind).toBe("angular");
  expect(rectanglePaints(engine.getRenderDocument().nodes[id] as VectorNode)[0]).toMatchObject(long);
  engine.cancelInteraction();
  expect(engine.getRenderDocument()).toBe(base); expect(engine.getUndoDepth()).toBe(depth);
  engine.beginInteraction(); engine.previewPaint(picker,readPaint({...long,kind:"radial"})); engine.commitInteraction();
  expect(engine.pickedGradient()?.paint.kind).toBe("radial");
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(base);
  engine.setEditable(false);
  expect(engine.getSnapshot().paintPicker).toBeUndefined();
  expect(engine.pickedGradient()).toBeUndefined();
});

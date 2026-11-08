import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rectanglePaints, type LayerNode } from "../../src/engine/document";
import { decodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import type { ImagePaint } from "../../src/engine/solid-paint";

const image = (key: string) => ({type:"image", image:key, scale_mode:"crop", scale:2, rotation:1, crop:[1,0,0,1,.2,.3], opacity:.5, visible:false, filters:{contrast:.75}});
const bytes = base64Bytes(readFileSync(new URL("../fixtures/images/six-pixels.png", import.meta.url)));
const mockBitmap = () => vi.stubGlobal("createImageBitmap", async () => ({width:3,height:2,close() {}}));
function layer(engine: EditorEngine, key: string) {
  const id = String(engine.execute("shape.rectangle").id);
  engine.execute("fill.add", {id, paint:image(key)});
  return id;
}
function fills(engine: EditorEngine, id: string) {
  return rectanglePaints(engine.getSnapshot().document.nodes[id] as LayerNode);
}
afterEach(() => vi.unstubAllGlobals());
describe("native image commands", () => {
  it("adjusts all matching hidden and visible image paints in one undo and preserves indexed stroke isolation", () => {
    const engine = new EditorEngine(), a = layer(engine,"a"), b = layer(engine,"b");
    engine.execute("fill.add",{id:a,paint:{...image("c"),visible:true}});
    engine.execute("stroke.add",{id:a,paint:image("s")});
    const before = engine.getSnapshot().document;
    expect(engine.execute("image.adjust",{ids:[a,b],preset:"BLACK & white",filters:{saturation:"0.5",highlights:9,exposure:1e90}})).toEqual({changed:3});
    const after = engine.getSnapshot().document;
    for (const id of [a,b]) for (const paint of fills(engine,id).slice(1)) {
      expect(paint).toMatchObject({scale_mode:"crop",filters:{saturation:.5,contrast:Math.fround(.15),highlights:1,exposure:0}});
    }
    expect(engine.execute("image.adjust",{id:a,target:"strokes",index:0,filters:{temperature:-3}})).toEqual({changed:1});
    expect((engine.getSnapshot().document.nodes[a] as LayerNode).strokes![0]).toMatchObject({filters:{temperature:-1,contrast:.75}});
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(after);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    for (const parameters of [{ids:[a,"bad"]},{ids:[a,"99999"]},{ids:[a],filters:{bad:2}},{id:a,index:0},{id:a,target:"strk"}]) {
      expect(() => engine.execute("image.adjust",{preset:"warm",...parameters})).toThrow();
      expect(engine.getSnapshot().document).toBe(before);
    }
  });

  it("captures a selected paint, allows exact saved overrides, normalises names and restores deleted presets", async () => {
    const engine = new EditorEngine(), id = layer(engine,"a");
    const warm = engine.execute("image.savePreset",{name:"  wa\u0000rm  ",ids:["bogus",id],index:1.5});
    expect(warm).toMatchObject({name:"warm",filters:{contrast:.75}});
    const longName = "🖼".repeat(101);
    const long = engine.execute("image.savePreset",{name:longName,filters:{contrast:2}});
    expect(Array.from(String(long.name))).toHaveLength(100);
    engine.execute("image.savePreset",{name:"warm",filters:{exposure:1}});
    expect(engine.execute("image.presets").saved.map(p=>p.name)).toEqual(["warm",long.name]);
    engine.execute("image.adjust",{id,preset:"warm"});
    expect((fills(engine,id)[1] as ImagePaint).filters).toMatchObject({exposure:1,temperature:0});
    engine.execute("image.adjust",{id,preset:"WARM"});
    expect((fills(engine,id)[1] as ImagePaint).filters).toMatchObject({exposure:0,temperature:.5});
    expect(engine.execute("image.deletePreset",{name:"warm"})).toEqual({ok:true});
    const before = engine.getSnapshot().document;
    expect(() => engine.execute("image.deletePreset",{name:"warm"})).toThrow();
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.undo");
    expect((await decodeFigcraft(await engine.nativeSnapshot())).document.imagePresets).toEqual(engine.execute("image.presets").saved);
  });

  it("limits new presets at 500 while allowing replacement at capacity", () => {
    const engine = new EditorEngine();
    for (let i=0;i<500;i++) engine.execute("image.savePreset",{name:i,filters:{}});
    const before = engine.getSnapshot().document;
    expect(() => engine.execute("image.savePreset",{name:"extra",filters:{}})).toThrow(/500/);
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("image.savePreset",{name:"499",filters:{tint:true}});
    expect(engine.execute("image.presets").saved[499].filters.tint).toBe(1);
  });

  it("replaces the top image on each target, retains its appearance and converts an explicit solid stroke", async () => {
    mockBitmap();
    const engine = new EditorEngine(), a = layer(engine,"a"), b = layer(engine,"b");
    engine.execute("fill.add",{id:a,paint:image("top")});
    engine.execute("stroke.add",{id:a,paint:{type:"solid",color:"#123456",opacity:.25,visible:false}});
    const before = engine.getSnapshot().document;
    const next = await engine.executeAsync("image.replace",{ids:[a,b],data:bytes});
    expect(next).toMatchObject({changed:2,width:3,height:2});
    expect(fills(engine,a)[1]).toEqual(rectanglePaints(before.nodes[a] as LayerNode)[1]);
    expect(fills(engine,a)[2]).toEqual({...rectanglePaints(before.nodes[a] as LayerNode)[2],image:next.image});
    expect(fills(engine,b)[1]).toMatchObject({image:next.image});
    const mapped = engine.getSnapshot().document;
    await engine.executeAsync("image.replace",{id:a,index:0,target:"stroke",data:bytes});
    expect((engine.getSnapshot().document.nodes[a] as LayerNode).strokes![0]).toMatchObject({type:"image",image:next.image,scale_mode:"fill",opacity:.25,visible:false});
    expect(engine.getSnapshot().document.images).toBe(mapped.images);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(mapped);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    await expect(engine.executeAsync("image.replace",{id:a,index:900,data:bytes})).rejects.toThrow();
    expect(engine.getSnapshot().document).toBe(before);
  });
});

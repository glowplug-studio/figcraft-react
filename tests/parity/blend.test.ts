import { expect, it } from "vitest";
import { blendFromName, blendLabel, blendModes, plusDarkerPixels } from "../../src/engine/blend";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";

it("sets every labelled blend on a layer, round-trips native tags, and rejects unknown modes atomically",async()=>{
  const e=new EditorEngine(), id=String(e.execute("shape.rectangle").id);
  expect(blendFromName("Normal")).toBe("normal");
  expect(blendFromName("PASS_THROUGH")).toBe("passThrough");
  for (const mode of blendModes) {
    const label=blendLabel(mode);
    expect(blendFromName(label)).toBe(mode);
    e.execute("node.set",{id,props:{blendMode:label.toUpperCase().replaceAll(" ","-")}});
    const opened=await decodeFigcraft(await encodeFigcraft(e.getSnapshot().document));
    const node=opened.document.nodes[id];
    expect(node).toEqual(e.getSnapshot().document.nodes[id]);
    expect(node.kind!=="page" && (node.blend ?? "normal")).toBe(mode);
  }
  const before=e.getSnapshot().document;
  expect(()=>e.execute("node.set",{id,props:{opacity:.5,blend:"future"}})).toThrow(/unknown blend/i);
  expect(e.getSnapshot().document).toBe(before);
});

it("composites linear burn with straight RGBA input, partial alpha and independent opacity",()=>{
  const run=(dst:number[],src:number[],opacity=1)=>{
    const pixels=Uint8ClampedArray.from(dst);
    plusDarkerPixels(pixels,Uint8ClampedArray.from(src),opacity);
    return [...pixels];
  };
  expect(run([204,102,51,255],[102,204,238,255])).toEqual([51,51,34,255]);
  expect(run([255,0,0,128],[0,0,255,128])).toEqual([85,0,85,192]);
  expect(run([204,102,51,255],[102,204,238,255],.5)).toEqual([128,77,43,255]);
  expect(run([1,22,250,0],[22,37,49,128])).toEqual([22,37,49,128]);
  expect(run([2,5,12,0],[1,255,100,255],NaN)).toEqual([2,5,12,0]);
});

it("preserves independent fill and stroke modes through commands, paint copy, undo and native files",async()=>{
  const engine=new EditorEngine();
  const source=String(engine.execute("shape.rectangle",{props:{fills:["red","blue"],strokes:["white","black"]}}).id);
  const target=String(engine.execute("shape.rectangle",{props:{fills:["green"],strokes:["green"]}}).id);
  for (const [i,mode] of blendModes.entries()) {
    const strokeMode=blendModes[blendModes.length-1-i];
    engine.execute("fill.set",{id:source,index:1,blend:blendLabel(mode)});
    engine.execute("stroke.set",{id:source,index:1,blend:blendLabel(strokeMode)});
    for (const list of ["fill","stroke"]) {
      engine.execute(list+".copy",{id:source,index:1});
      engine.execute(list+".paste",{id:target,index:0});
    }
    const doc=engine.getSnapshot().document;
    const restored=(await decodeFigcraft(await encodeFigcraft(doc))).document;
    const from=restored.nodes[source],to=restored.nodes[target];
    expect(from.kind!=="page" && from.fills?.map(p=>p.blend)).toEqual(["normal",mode]);
    expect(from.kind!=="page" && from.strokes?.map(p=>p.blend)).toEqual(["normal",strokeMode]);
    expect(to.kind!=="page" && to.strokes?.[0].blend).toBe(strokeMode);
    // Simple opaque normal fills may use their compact legacy representation.
    expect(to.kind!=="page" && (to.fills?.[0].blend??"normal")).toBe(mode);
  }
  const before=engine.getSnapshot().document;
  engine.execute("fill.set",{id:source,blend:"future"});
  expect(engine.getSnapshot().document).toBe(before);
  expect(()=>engine.execute("fill.set",{id:source,paint:{type:"solid",color:"red",blend:"Plus darker"}})).toThrow();
  expect(engine.getSnapshot().document).toBe(before);
  engine.execute("fill.set",{id:source,blend:"difference"});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
});

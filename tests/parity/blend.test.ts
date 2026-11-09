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

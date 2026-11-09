import { readFile } from "node:fs/promises";
import { expect,it } from "vitest";
import { ShapingFace } from "../../src/engine/shaping-face";
import { FontColourTables } from "../../src/engine/font-colour";
import reference from "../fixtures/colour-layers.json" with {type:"json"};

const input=await readFile(new URL("../fixtures/colour-reference.ttf",import.meta.url));
it("reads native palette zero, foreground fallback and COLR glyph IDs from shared font bytes",()=>{
  const buffer=new Uint8Array(input.length+23);
  buffer.set(input,23);
  const [face]=ShapingFace.read(buffer.subarray(23));
  buffer.fill(0);
  expect(face.hasColour).toBe(true);
  for (const [id,layers] of Object.entries(reference)) expect(face.colourLayers(Number(id)) ?? null).toEqual(layers);
  expect(face.colourLayers(2)).toBe(face.colourLayers(2));
  const layers=face.colourLayers(7)!;
  expect(layers).toHaveLength(256);
  layers.forEach((layer,i)=>expect(layer).toEqual({id:reference["2"][i%2].id,rgba:reference["2"][1-i%2].rgba}));
});
it("bounds invalid table offsets and missing palettes",()=>{
  const colr=new DataView(new ArrayBuffer(24));
  colr.setUint16(2,1); colr.setUint32(4,14); colr.setUint32(8,20); colr.setUint16(12,1);
  colr.setUint16(14,4); colr.setUint16(18,1);colr.setUint16(20,9);
  const make=()=>new FontColourTables(tag=>tag==="COLR" ? colr : undefined);
  expect(make().layers(4)).toEqual([{id:9,rgba:[0,0,0,255]}]);
  colr.setUint32(8,21);
  expect(make().layers(4)).toBeUndefined();
  colr.setUint32(4,0xffffffff);
  expect(make().layers(4)).toBeUndefined();
});

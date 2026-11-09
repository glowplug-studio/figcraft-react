import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { ShapingFace } from "../../src/engine/shaping-face";
import reference from "../fixtures/text-shaping.json" with { type:"json" };

type Fixture = {file:string; text:string; rtl:boolean; features:Record<string,boolean>; axes:Record<string,number>; glyphs:number[][]};
const cases = reference as Fixture[];
const scalars = (s: string) => Array.from(s,(c,source) => ({codePoint:c.codePointAt(0)!,source}));
const read = async (file: string) => ShapingFace.read(await readFile(new URL("../../fonts/" + file,import.meta.url)))[0];

it.each(cases)("matches native glyphs, scalar clusters and positions for $text with $features", async c => {
  const face = await read(c.file);
  expect(face.shape(scalars(c.text),c.rtl,c.features,c.axes).map(g => [g.id,g.cluster,g.advance,g.offsetX,g.offsetY])).toEqual(c.glyphs);
});

it("reuses one face across requests, restores default axes and accepts repeated source offsets after case expansion", async () => {
  const georgian = await read("noto-sans-georgian/NotoSansGeorgian.ttf");
  expect(georgian.axes.wdth).toMatchObject({min:62.5,default:100,max:100});
  expect(georgian.shape(scalars("ა"),false,{}, {wght:2000})[0].advance).toBe(608);
  expect(georgian.shape(scalars("ა"),false,{}, {})[0].advance).toBe(549);
  const inter = await read("inter/Inter-Regular.ttf");
  expect([inter.family,inter.style,inter.postscript,inter.upem,inter.ascent,inter.descent,inter.lineGap])
    .toEqual(["Inter","Regular","Inter-Regular",2048,1984,494,0]);
  expect(inter.features).toContain("sups");
  expect(inter.glyphFor(0x41)).toBe(2);
  expect(inter.shape([{codePoint:83,source:5},{codePoint:83,source:5}],false,{},{}).map(g=>g.cluster)).toEqual([5,5]);
});

it("rejects malformed headers, truncated collections and nameless records", () => {
  expect(ShapingFace.read(new Uint8Array(8))).toEqual([]);
  expect(ShapingFace.read(Uint8Array.of(0x74,0x74,0x63,0x66,0,1,0,0,255,255,255,255))).toEqual([]);
  expect(ShapingFace.read(Uint8Array.of(0,1,0,0,0,0,0,0,0,0,0,0))).toEqual([]);
});

it("opens both indexed faces of a TrueType collection with file-relative table offsets", async () => {
  const inputs = await Promise.all(["Regular","Bold"].map(style =>
    readFile(new URL("../../fonts/inter/Inter-"+style+".ttf",import.meta.url))));
  const headerSize = 12 + inputs.length*4;
  const size = inputs.reduce((sum,bytes) => sum + Math.ceil(bytes.length/4)*4,headerSize);
  const collection = Buffer.alloc(size);
  collection.write("ttcf");
  collection.writeUInt32BE(0x00010000,4);
  collection.writeUInt32BE(inputs.length,8);
  let offset = headerSize;
  for (const [index,font] of inputs.entries()) {
    collection.writeUInt32BE(offset,12+4*index);
    font.copy(collection,offset);
    for (let table=0; table<font.readUInt16BE(4); table++) {
      const field = 12+table*16+8;
      collection.writeUInt32BE(font.readUInt32BE(field)+offset,offset+field);
    }
    offset += Math.ceil(font.length/4)*4;
  }
  const loaded = ShapingFace.read(collection);
  expect(loaded.map(f=>f.postscript)).toEqual(["Inter-Regular","Inter-Bold"]);
  expect(loaded.map(f=>f.shape(scalars("A"),false,{},{} )[0].advance)).toEqual([1413,1529]);
});

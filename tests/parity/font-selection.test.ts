import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { ShapingFace } from "../../src/engine/shaping-face";
import { FontLibrary } from "../../src/engine/font-library";
import { fontSegments } from "../../src/engine/font-segments";
import { TextGraphemes } from "../../src/engine/text-graphemes";
import { fontVariations } from "../../src/engine/font-tables";
import reference from "../fixtures/font-selection.json" with {type:"json"};

const read = async (file: string) => ShapingFace.read(await readFile(new URL("../../fonts/"+file,import.meta.url)))[0];
const inter = await read("inter/Inter-Regular.ttf");
const georgian = await read("noto-sans-georgian/NotoSansGeorgian.ttf");
const library = new FontLibrary();
for (const name of ["Bold","Italic","Regular","SemiBold"]) library.add(await read("inter/Inter-"+name+".ttf"));
library.add(georgian);

it("selects the native loaded face for legacy family, weight, slope and default requests", () => {
  for (const [family,style,name,defaultName] of reference.requests) {
    expect(library.find(family!,style!)?.postscript ?? null).toBe(name);
    expect(library.defaultFace()?.postscript).toBe(defaultName);
  }
});

const coordinates = (v: Readonly<Record<string,number>>) => [v.wght,v.wdth];

it("matches native named instances, style hints and clamped explicit values", () => {
  expect(georgian.instances.map(i=>[i.name,coordinates(i.coordinates)])).toEqual(reference.instances);
  for (const [fontStyle,variations,expected] of reference.settings as [string,Record<string,number>,number[]][]) {
    expect(coordinates(georgian.axisValues({fontStyle,fontSize:17,variations}))).toEqual(expected);
  }
  expect(inter.instances).toEqual([]);
  expect(inter.axisValues({fontStyle:"Black",fontSize:40,variations:{wght:900}})).toEqual({});
});

it.each(reference.runs)("shapes $text with the same face, source clusters and glyphs as native layout", ({text,glyphs}) => {
  const chars = Array.from(text);
  const runs = library.segments(chars,new TextGraphemes(text),0,chars.length,"Inter","Regular");
  const actual = Array.from(runs).flatMap(({face,start,end,level}) => {
    const scalars = chars.slice(start,end).map((c,i)=>({codePoint:c.codePointAt(0)!,source:start+i}));
    return face.shape(scalars,level%2===1,{},{}).map(g=>[face.postscript,g.cluster,g.id]);
  });
  expect(actual).toEqual(glyphs);
});

const fake = (name: string, glyphs: string, hasColour=false) => ({
  name,hasColour,glyphFor:(cp: number)=>glyphs.includes(String.fromCodePoint(cp)) ? 1 : 0,
});
it("selects marks and emoji as clusters, retaining separate hard breaks and clipped spans", () => {
  const base = fake("base","A☀🎨"), accent = fake("accent","A\u0301☀🎨"), emoji = fake("emoji","🎨☀🇬",true);
  const text = "A\u0301☀️🎨\n\u2028🇬🇧", chars = Array.from(text), boundaries = new TextGraphemes(text);
  const segments = (start: number,end: number, levels?: number[]) => Array.from(
    fontSegments(chars,boundaries,start,end,base,[emoji],[accent],levels),r=>[r.start,r.end,r.face.name,r.level]);
  expect(segments(0,chars.length)).toEqual([[0,2,"accent",0],[2,4,"base",0],[4,5,"emoji",0],
    [5,6,"base",0],[6,7,"base",0],[7,9,"emoji",0]]);
  expect(segments(0,1)).toEqual([[0,1,"base",0]]);
  expect(segments(1,2)).toEqual([[1,2,"accent",0]]);
  expect(segments(0,2,[0,1])).toEqual([[0,1,"accent",0],[1,2,"accent",1]]);
});

it("bounds malformed and truncated variable font records", () => {
  const table = new DataView(new ArrayBuffer(44));
  table.setUint16(0,1); table.setUint16(4,16); table.setUint16(8,1);
  table.setUint16(10,20); table.setUint16(12,65535); table.setUint16(14,8);
  table.setUint32(16,0x77676874); table.setInt32(28,65536);
  expect(fontVariations(table,()=>"One").instances).toEqual([{name:"One",coordinates:{wght:0}}]);
  table.setUint16(14,2);
  expect(fontVariations(table,()=>"One").instances).toEqual([]);
  table.setUint16(8,65535);
  expect(fontVariations(table,()=>"One").axes).toEqual({});
});

it("updates fallback lists when font data arrives and keeps unrelated editor libraries separate", () => {
  const local = new FontLibrary(), chars = ["ა"], bounds = new TextGraphemes("ა");
  const selected = () => Array.from(local.segments(chars,bounds,0,1,"Inter","Regular"),r=>r.face.postscript);
  expect(selected()).toEqual([]);
  local.add(inter);
  expect(selected()).toEqual(["Inter-Regular"]);
  local.add(georgian);
  expect(selected()).toEqual(["NotoSansGeorgian-Regular"]);
});

import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { readTextData } from "../../src/engine/text-data";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { layoutTextFlow } from "../../src/engine/text-flow";
import reference from "../fixtures/text-flow.json" with {type:"json"};

const fonts=new FontLibrary();
for (const file of ["inter/Inter-Regular","inter/Inter-Bold","noto-sans-georgian/NotoSansGeorgian"]) {
  for (const face of ShapingFace.read(await readFile(new URL("../../fonts/"+file+".ttf",import.meta.url)))) fonts.add(face);
}
it.each(reference)("lays out native lines and glyphs for $input.characters",({input,savedBreaks,boxWidth,boxHeight,width,height,lines,glyphs,truncated})=>{
  const text=readTextData(input);
  const actual=layoutTextFlow(savedBreaks ? {...text,savedBreaks} : text,fonts,{width:boxWidth ?? undefined,height:boxHeight ?? undefined},[]);
  expect(actual.lines).toEqual(lines);
  expect(actual.truncated).toBe(truncated);
  expect([actual.width,actual.height]).toEqual([width,height]);
  expect(actual.glyphs.map(g=>[g.face.postscript,g.id,g.start,g.end,g.x,g.y,g.advance,g.size,g.rtl])).toEqual(glyphs);
});

import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { readTextData } from "../../src/engine/text-data";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { styledGlyphs } from "../../src/engine/styled-glyphs";
import reference from "../fixtures/styled-glyphs.json" with {type:"json"};

const fonts = new FontLibrary();
for (const file of ["inter/Inter-Regular","inter/Inter-Bold","noto-sans-georgian/NotoSansGeorgian"]) {
  for (const face of ShapingFace.read(await readFile(new URL("../../fonts/"+file+".ttf",import.meta.url)))) fonts.add(face);
}
it.each(reference)("matches native styled glyph sizes, positions and advances for $input.characters", ({input,glyphs,width,baseline})=>{
  const items = [...styledGlyphs(readTextData(input),fonts,undefined)];
  let x=0;
  const rows = items.map(item=>{
    const row = [item.face.postscript,item.id,item.start,item.end,x+item.offsetX,baseline-item.offsetY,item.size,item.advance];
    x+=item.advance;
    return row;
  });
  expect(rows).toEqual(glyphs);
  expect(x-(items.at(-1)?.spacing ?? 0)).toEqual(width);
});

it("keeps hard breaks at zero advance and preserves supplied scalar bidi levels", () => {
  const items = [...styledGlyphs(readTextData({characters:"A\n\u2028()"}),fonts,[0,0,0,1,1])];
  expect(items.slice(1,3).map(g=>[g.start,g.end,g.id,g.advance,g.offsetX,g.offsetY]))
    .toEqual([[1,2,0,0,0,0],[2,3,0,0,0,0]]);
  const inter = fonts.find("Inter","Regular")!;
  expect(items.slice(3).map(g=>[g.start,g.id,g.level])).toEqual([[3,inter.glyphFor(41),1],[4,inter.glyphFor(40),1]]);
});

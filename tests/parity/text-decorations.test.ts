import { readFile } from "node:fs/promises";
import { expect,it } from "vitest";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { readTextData } from "../../src/engine/text-data";
import { decorationPath,textInkBounds,textToPath } from "../../src/engine/text-decorations";
import { glyphPath } from "../../src/engine/text-glyph-path";
import { layoutText } from "../../src/engine/text-flow";
import rows from "../fixtures/text-decorations.json" with {type:"json"};

const fonts=new FontLibrary();
for (const file of ["inter/Inter-Regular","inter/Inter-Bold","noto-sans-georgian/NotoSansGeorgian"]) {
  for (const face of ShapingFace.read(await readFile(new URL("../../fonts/"+file+".ttf",import.meta.url)))) fonts.add(face);
}
it.each(rows)("matches native decoration contours, paints and ink bounds for $input.characters",async ({input,width,height,decos,ink})=>{
  const layout=await layoutText(readTextData(input),fonts,{width:width ?? undefined,height:height ?? undefined});
  const r=textInkBounds(layout);
  const bounds=r ? [r.x,r.y,r.width,r.height] : null;
  expect(bounds).toEqual(ink?.map(v=>expect.closeTo(v,8)) ?? null);
  expect(layout.decorations).toHaveLength(decos.length);
  layout.decorations.forEach((d,i)=>{
    const expected=decos[i];
    expect(d.kind).toBe(expected.kind); expect(d.thickness).toBeCloseTo(expected.thickness,8);
    expect([d.rect.x,d.rect.y,d.rect.width,d.rect.height]).toEqual(expected.rect.map(v=>expect.closeTo(v,8)));
    expect(d.style.fills ?? null).toEqual(expected.fills?.map(p=>({...p,colorAlpha:1,...("colorAlpha" in p && {colorAlpha:p.colorAlpha})})) ?? null);
    expect(decorationPath(d)).toEqual(expected.path.map(el=>el.map(v=>typeof v==="number" ? expect.closeTo(v,8) : v)));
  });
});
it("bounds wave sampling and dot repetition on a long underline",()=>{
  const style=readTextData({}).style,rect={x:0,y:0,width:1e9,height:1};
  expect(decorationPath({style,rect,kind:"wavy",thickness:1})).toHaveLength(5003);
  expect(decorationPath({style,rect,kind:"dotted",thickness:1})).toHaveLength(2500*6);
});

it("retains dots and contours after the glyphs when text becomes a vector path",async ()=>{
  const l=await layoutText(readTextData({characters:"J",style:{decoration:"underline",decoration_look:{style:"dotted"}}}),fonts);
  expect(l.decorations).toHaveLength(1);
  const glyph=glyphPath(l.glyphs[0]), dots=decorationPath(l.decorations[0]), combined=textToPath(l);
  expect(combined.slice(0,glyph.length)).toEqual(glyph);
  expect(combined.slice(glyph.length)).toEqual(dots);
});

import { readFile } from "node:fs/promises";
import { expect,it } from "vitest";
import * as caret from "../../src/engine/text-caret";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { readTextData } from "../../src/engine/text-data";
import { layoutText } from "../../src/engine/text-flow";
import { caretProbes } from "../fixtures/text-caret-probes";
import rows from "../fixtures/text-caret.json" with {type:"json"};

const fonts=new FontLibrary();
for (const file of ["inter/Inter-Regular","inter/Inter-Bold","noto-sans-georgian/NotoSansGeorgian"]) {
  for (const face of ShapingFace.read(await readFile(new URL("../../fonts/"+file+".ttf",import.meta.url)))) fonts.add(face);
}
it.each(rows)("matches upstream text selection and caret positions for $input.characters",async ({input,width,height,carets,steps,hits,selections})=>{
  const t=readTextData(input),layout=await layoutText(t,fonts,{width:width ?? undefined,height:height ?? undefined});
  expect(caretProbes(caret,layout,Array.from(t.characters).length)).toEqual({carets,steps,hits,selections});
});

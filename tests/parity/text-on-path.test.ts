import { readFile } from "node:fs/promises";
import { expect,it } from "vitest";
import { readTextData } from "../../src/engine/text-data";
import { FontLibrary } from "../../src/engine/font-library";
import { ShapingFace } from "../../src/engine/shaping-face";
import { layoutTextFlow } from "../../src/engine/text-flow";
import { TextOnPath,textWarpPoint } from "../../src/engine/text-on-path";
import reference from "../fixtures/text-on-path.json" with {type:"json"};

const fonts=new FontLibrary();
for (const face of ShapingFace.read(await readFile(new URL("../../fonts/inter/Inter-Regular.ttf",import.meta.url)))) fonts.add(face);
const points=[[-22,0],[0,7],[16.25,9],[40,20],[63,50],[111,17],[34,150]];
it.each(reference)("places glyphs and layout points on native path $input.path.d",({input,width,height,warps,probes})=>{
  const out=layoutTextFlow(readTextData(input),fonts,{width:width ?? undefined,height:height ?? undefined},[]);
  expect(out.glyphs).toHaveLength(warps.length);
  out.glyphs.forEach((g,i)=>g.warp!.forEach((v,j)=>expect(v).toBeCloseTo(warps[i][j],8)));
  points.forEach(([x,y],i)=>{
    const p=textWarpPoint(out,x,y);
    expect(p.x).toBeCloseTo(probes[i][0],8);
    expect(p.y).toBeCloseTo(probes[i][1],8);
  });
});
it("applies the command budget across every subpath",()=>{
  const path={d:"M0 0h1"+"l1 0".repeat(19998),start:0,flip:false};
  expect(TextOnPath.from(path,0,5)).toBeDefined();
  expect(TextOnPath.from({...path,d:path.d+"M0 0"},0,5)).toBeUndefined();
});

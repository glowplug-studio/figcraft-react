import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { gradientPixels } from "../fixtures/gradient-rendering";

test("gradient handle frames, colour stops, transparency and strokes match native pixel fixtures", async ({page}) => {
  const bundle = await build({configFile:false, logLevel:"silent", build:{write:false, lib:{entry:"tests/fixtures/gradient-rendering.ts", name:"FigcraftGradients", formats:["iife"]}}});
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output:{type:string;code?:string}[] };
  const code = output.output.find(chunk=>chunk.type === "chunk")?.code;
  if (!code) throw new Error("Gradient fixture did not build");
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({content:code});
  const pixels = await page.evaluate(() => (window as unknown as {FigcraftGradients:{gradientPixels:typeof gradientPixels}}).FigcraftGradients.gradientPixels(document.querySelector("canvas")!));
  await test.info().attach("gradient-pixels",{body:JSON.stringify(pixels),contentType:"application/json"});
  function near(actual:number[], expected:number[], label:string, tolerance=3) {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v,i)=>expect(Math.abs(v-expected[i]), label+" channel "+i+" "+actual).toBeLessThanOrEqual(tolerance));
  }
  for (const {kind,x,y,pixel,t} of pixels.handles) {
    const grey=Math.round(255*t);
    near(pixel,[grey,grey,grey,255],kind+" at "+x+","+y,4);
  }
  near(pixels.middle,[128,0,127,255],"red to blue");
  near(pixels.fade,[191,126,190,255],"straight RGB interpolation over white");
  near(pixels.opacity,[128,128,128,255],"paint opacity");
  near(pixels.hard[0],[255,0,0,255],"left of duplicate stops");
  near(pixels.hard[1],[0,0,255,255],"right of duplicate stops");
  expect(pixels.largestSeam).toBeLessThanOrEqual(1);
  pixels.beforeFlatten.forEach((before,i)=>{
    expect(before[1]).toBe(0);
    expect(before[0]).toBeGreaterThan(0);
    expect(before[2]).toBeGreaterThan(0);
    near(pixels.afterFlatten[i],before,"Flatten preserves source paint frame",2);
  });
  for (const {band,centre} of pixels.strokes) {
    near(band,[129,0,126,255],"stroke band");
    near(centre,[255,255,255,255],"stroke interior");
  }
});

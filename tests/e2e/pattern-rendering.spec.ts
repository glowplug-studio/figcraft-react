import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as PatternFixture from "../fixtures/pattern-rendering";

test("live patterns repeat layer pixels through hex cells, strokes and bounded nested sources", async ({page}) => {
  const bundle = await build({configFile:false,logLevel:"silent",build:{write:false,lib:{entry:"tests/fixtures/pattern-rendering.ts",name:"FigcraftPatterns",formats:["iife"]}}});
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as {output:{type:string;code?:string}[]};
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({content:output.output.find(chunk => chunk.type === "chunk")!.code!});
  const {pixels,depth,image,frames} = await page.evaluate(async () => {
    const fixture=(window as unknown as {FigcraftPatterns:typeof PatternFixture}).FigcraftPatterns;
    const canvas=document.querySelector("canvas")!;
    return {pixels:fixture.patternPixels(canvas),depth:fixture.depthPixels(canvas),image:await fixture.imagePattern(canvas),frames:await fixture.patternFrames(canvas)};
  });
  await test.info().attach("pattern-pixels",{body:JSON.stringify({pixels,depth,image,frames}),contentType:"application/json"});
  const white = [255,255,255,255], red = [255,0,0,255], blue = [0,0,255,255];
  expect(frames).toMatchObject({coarse:red,dimensions:[[2048,5],[30,40]],released:true,frames:60});
  expect(frames.p95).toBeLessThan(16.7);
  expect(depth).toEqual([red,white,red]);
  expect(image[0]).toEqual(white); expect(image[4]).toEqual(white);
  expect(image[1]).toEqual([255,127,127,255]); expect(image[5]).toEqual(image[1]);
  expect(image[3][2]).toBeGreaterThan(245);
  expect(image[2][0]).toBeGreaterThan(140); expect(image[2][2]).toBeGreaterThan(140);
  const {beforeFlatten,afterFlatten,...tiles} = pixels;
  expect(beforeFlatten).toContainEqual(blue); expect(beforeFlatten).toContainEqual(white);
  for(const [i,rgba] of afterFlatten.entries()) rgba.forEach((channel,j)=>expect(Math.abs(channel-beforeFlatten[i][j])).toBeLessThanOrEqual(2));
  expect(tiles).toEqual({missing:[red],alpha:[[127,0,128,255],red],grid:[red,white,red], live:[blue], horizontal:[blue,white], vertical:[blue,white],
    aligned:[blue,white], nested:[blue,white], capped:[white], cycle:[white], strokes:[[blue,white,white],[blue,white,white]]});
});

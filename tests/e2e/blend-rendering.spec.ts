import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import type * as BlendFixture from "../fixtures/blend-rendering";

declare global { interface Window { FigcraftBlend: typeof BlendFixture } }

async function loadFixture(page: Page) {
  const buildResult=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{entry:"tests/fixtures/blend-rendering.ts",name:"FigcraftBlend",formats:["iife"]}}});
  const output=(Array.isArray(buildResult)?buildResult[0]:buildResult) as {output:{type:string;code?:string}[]};
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({content:output.output.find(c=>c.type==="chunk")!.code!});
}

  // Independent evaluations of blend_ref in paint_behaviour_tests.rs on #CC6633 and #66CCEE.
  const colours=[[102,204,238],[102,204,238],[102,102,51],[82,82,48],[51,51,34],[128,64,36],[204,204,238],
    [224,224,241],[255,255,255],[255,255,255],[194,163,95],[196,138,106],[163,194,228],[102,102,187],
    [143,143,194],[42,157,195],[195,105,59],[52,154,188],[254,152,101]];
function expectPixel(actual:number[], expected:number[], label:string, tolerance=3) {
  expect(actual).toHaveLength(4);
  actual.forEach((v,c)=>expect(Math.abs(v-(expected[c]??255)),label+" "+actual).toBeLessThanOrEqual(tolerance));
}

test("all 19 layer blend modes match native colours and preserve group isolation under frame clips", async({page})=>{
  await loadFixture(page);
  const result=await page.evaluate(()=>window.FigcraftBlend.layerBlendPixels(document.querySelector("canvas")!));
  expect(result.layers).toHaveLength(colours.length);
  result.layers.forEach((rgba,i)=>expectPixel(rgba,colours[i],"layer "+i));
  expect(result.pass).toEqual([[0,255,0,255],[255,255,0,255],[255,255,0,255]]);
  expect(result.isolated).toEqual([0,255,255,255]);
  await test.info().attach("layer blend pixels",{body:JSON.stringify(result),contentType:"application/json"});
});

test("fill stacks, filled strokes and dashed masks match all 19 native blend colours",async({page})=>{
  await loadFixture(page);
  const result=await page.evaluate(()=>window.FigcraftBlend.paintBlendPixels(document.querySelector("canvas")!));
  for (const kind of ["fills","strokes","dashed"] as const) {
    expect(result[kind]).toHaveLength(colours.length);
    result[kind].forEach((rgba,i)=>expectPixel(rgba,colours[i],kind+" "+i));
  }
  expect(result.repeated).toEqual(result.mask);
  expectPixel(result.mask[0],colours[4],"reused plus darker mask");
  expect(result.mask.slice(1)).toEqual([[255,255,255,255],[255,255,255,255]]);
  expectPixel(result.isolation[0],colours[3],"unisolated");
  expectPixel(result.isolation[1],colours[3],"native opacity threshold");
  expectPixel(result.isolation[2],[153,153,145],"isolated half-opacity leaf");
  expectPixel(result.partial,[51,0,153,159],"quarter red and half blue on transparent");
  await test.info().attach("paint blend pixels",{body:JSON.stringify(result),contentType:"application/json"});
});

test("gradients, images and patterns blend through clipped fills, strokes and flattened regions",async({page})=>{
  await loadFixture(page);
  const result=await page.evaluate(()=>window.FigcraftBlend.paintSourcePixels(document.querySelector("canvas")!));
  expect(result.sets).toHaveLength(18);
  const backdrop=[204,102,51,255];
  for (const item of result.sets) {
    const label=item.paint+" "+item.blend+" "+item.contour;
    expectPixel(item.inside,colours[item.blend==="multiply"?3:4],label);
    expect(item.corner,label).toEqual(backdrop);
    expect(item.outside,label).toEqual(backdrop);
    if (item.contour!=="fill") expect(item.middle,label).toEqual(backdrop);
  }
  expectPixel(result.before[0],colours[4],"rotated pattern");
  expect(result.after).toEqual(result.before);
  await test.info().attach("paint source pixels",{body:JSON.stringify(result),contentType:"application/json"});
});

test("mixed blend preview and drawing stay within the frame budget with bounded readback",async({page})=>{
  await loadFixture(page);
  const measurement=await page.evaluate(()=>window.FigcraftBlend.blendFrames(document.querySelector("canvas")!));
  await test.info().attach("blend frame timings",{body:JSON.stringify(measurement),contentType:"application/json"});
  expect(measurement.frames).toBe(60);
  expect(measurement.published).toBe(0);
  expect(measurement.largestRead).toBeGreaterThan(0);
  expect(measurement.largestRead).toBeLessThan(100*100);
  expect(measurement.preview.p95).toBeLessThan(4);
  expect(measurement.draw.p95).toBeLessThan(16.7);
});

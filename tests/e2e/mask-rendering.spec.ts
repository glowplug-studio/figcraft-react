import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/mask-rendering";

declare global {interface Window { FigcraftMasks:typeof Fixture }}
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"tests/fixtures/mask-rendering.ts",name:"FigcraftMasks",formats:["iife"]}}});
  const {output}=(Array.isArray(result)?result[0]:result) as {output:{type:string;code:string}[]};
  bundle=output.find(chunk=>chunk.type==="chunk")!.code;
});
test.beforeEach(async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:bundle});
});
const grey=[245,245,245,255],black=[0,0,0,255],blue=[0,0,255,255],clear=[0,0,0,0];

test("page masks bound successive sibling runs including a hidden or offscreen mask",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.siblingPixels(document.querySelector("canvas")!));
  expect(r.opaque).toEqual([black,grey,grey,blue,grey]);
  expect(r.vector).toEqual(r.opaque);
  expect(r.transparent).toEqual([grey,grey,grey,blue,grey]);
  expect(r.hidden).toEqual([grey,grey,blue,blue,blue]);
  expect(r.offscreen).toEqual(Array(5).fill(grey));
});
test("encoded luminance weights, gradient and painted alpha apply once to overlapping siblings",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.luminancePixels(document.querySelector("canvas")!));
  expect(r.bytes).toEqual([blue,clear,[0,0,255,55],[0,0,255,183],[0,0,255,19],[0,0,255,128]]);
  expect(r.halfRed).toEqual([0,0,255,28]);
  expect(r.halfAlpha).toEqual([[255,0,0,128],[0,0,255,128],clear]);
  expect(r.gradient).toEqual([blue,clear]);
});
test("nested frame clips and separated group outlines retain their own coordinate spaces",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.nestedPixels(document.querySelector("canvas")!));
  expect(r.alpha).toEqual([clear,[0,0,255,64],clear,[0,0,255,64],clear]);
  expect(r.vector).toEqual([clear,[0,0,255,128],clear,[0,0,255,128],clear]);
  expect(r.hiddenChild).toEqual([clear,clear,clear,[0,0,255,128],clear]);
});
test("bounded mask surfaces on a 3000 by 2000 page match a full-view render byte for byte",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.boundedPixels(document.querySelector("canvas")!));
  expect(r.sizes).toEqual([[62,62],[62,62]]);
  expect(r.different).toBe(0);expect(r.released).toBe(true);
});
test("image mask decode resumes in order and returns its layer budget when superseded",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.imageMask(document.querySelector("canvas")!));
  expect(r).toEqual({heldDuringDecode:true,releasedOnCancel:true,releasedOnDraw:true,pixels:[blue,clear,clear]});
});

test("vector mask outlines retain winding holes and boolean subtraction independently of paint",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.outlinePixels(document.querySelector("canvas")!));
  expect(r.solid).toEqual([blue,blue,blue]);
  expect(r.hole).toEqual([blue,clear,blue]);
  expect(r.subtraction).toEqual([blue,clear,clear]);
  expect(r.booleanAlpha).toEqual(r.subtraction);
  expect(r.painted && r.strokeGaps).toBe(true);expect(r.strokeInterior).toEqual(blue);
});

test("repeated masked drawing and layer inspection stay inside the local frame budget",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.maskFrames(document.querySelector("canvas")!));
  await test.info().attach("mask frame timings",{body:JSON.stringify(r),contentType:"application/json"});
  expect(r.frames).toBe(60);expect(r.changes).toBe(0);
  expect(r.hitP95).toBeLessThan(4);expect(r.drawP95).toBeLessThan(16.7);
});

test("a masked run and nested opacity layer share the live byte budget",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.nestedBudget(document.querySelector("canvas")!));
  expect(r.unrestricted).toEqual([127,0,128,255]);
  expect(r.limited).toEqual([255,0,0,255]);
  expect(r.restored).toEqual(r.unrestricted);
});

test("fixed Chromium reference for nested luminance and vector coverage",async({page})=>{
  await page.evaluate(()=>window.FigcraftMasks.nestedPixels(document.querySelector("canvas")!));
  await expect(page.locator("canvas")).toHaveScreenshot("nested-vector-luminance-mask.png");
});

test("rotated styled vector masks inherit layer paint for paint-space regions and omit empty regions",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftMasks.styledVectorPixels(document.querySelector("canvas")!));
  expect(r).toEqual([blue,clear,clear,clear]);
});

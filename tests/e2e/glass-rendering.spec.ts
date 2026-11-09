import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/glass-rendering";

declare global {interface Window { FigcraftGlass:typeof Fixture }}
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"tests/fixtures/glass-rendering.ts",name:"FigcraftGlass",formats:["iife"]}}});
  const {output}=(Array.isArray(result)?result[0]:result) as {output:{type:string;code:string}[]};
  bundle=output.find(chunk=>chunk.type==="chunk")!.code;
});
test.beforeEach(async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:bundle});
});
test("glass refracts the backdrop, lights the bevel and retains effect stack order", async ({page}) => {
  const r = await page.evaluate(() => window.FigcraftGlass.rectangularPane(document.querySelector("canvas")!));
  expect(r.hidden).toEqual(r.baseline);
  expect(r.clear.map(p => p[0])).toEqual([0,0,255,255,255,255]);
  expect(r.frost[2][0]).toBeGreaterThan(100); expect(r.frost[2][0]).toBeLessThan(255);
  expect(r.glassLast).toEqual(r.clear);
  expect(r.blurLast).not.toEqual(r.clear);
  expect(r.lit[1][0]).toBeGreaterThan(100);
  expect(r.lit[0][0]).toBe(0);
});
test("arbitrary glass coverage survives cache reuse, integer panning and memory pressure", async ({page}) => {
  const r = await page.evaluate(() => window.FigcraftGlass.ellipsePane(document.querySelector("canvas")!));
  expect(r.changes).toBeGreaterThan(1000);
  expect(r.cacheDrift).toBe(0); expect(r.panDrift).toBe(0);
  expect(r.corner).toEqual([0,0,0,255]);
  expect(r.reserved).toBe(true);
  expect(r.refused).not.toEqual(r.expected);
  expect(r.recovered).toEqual(r.expected);
});
test("a moving glass ellipse reuses its fields within a frame", async ({page}) => {
  const r = await page.evaluate(() => window.FigcraftGlass.glassFrames(document.querySelector("canvas")!));
  await test.info().attach("glass frame timings", {body: JSON.stringify(r), contentType:"application/json"});
  expect(r.frames).toBe(40); expect(r.p95).toBeLessThan(16.7);
});

import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import type { imagePixels, largeImagePaints } from "../fixtures/image-rendering";

async function loadImages(page:Page) {
  const bundle = await build({ configFile:false, logLevel:"silent", build:{ write:false, lib:{ entry:"tests/fixtures/image-rendering.ts", name:"FigcraftImages", formats:["iife"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output:{type:string;code?:string}[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Image fixture did not build");
  // Content hashing requires a secure context, including loopback.
  await page.goto("/login");
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({ content:code });
}

test("raster fill, fit, crop, rotated tiles, stroke padding and vector paint spaces sample the native image frame", async ({ page }) => {
  await loadImages(page);
  const result = await page.evaluate(() => (window as unknown as {FigcraftImages:{ imagePixels:typeof imagePixels }}).FigcraftImages.imagePixels(document.querySelector("canvas")!));
  await test.info().attach("image-pixels", { body: JSON.stringify(result), contentType: "application/json" });
  const white=[255,255,255,255], red=[255,0,0,255], blue=[0,0,255,255], green=[0,255,0,255];
  expect(result.fit).toEqual([white,red,red]);
  expect(result.fill).toEqual([[255,127,127,255],[127,127,255,255],[127,255,127,255]]);
  expect(result.crop).toEqual([white,red]);
  expect(result.tile).toEqual([blue,red,blue,green]);
  expect(result.stroke).toEqual([red,red,white]);
  expect(result.maskedStroke).toEqual([red,white]);
  expect(result.beforeFlatten).toContainEqual(red);
  expect(result.afterFlatten).toEqual(result.beforeFlatten);
});

test("two large images reuse preview copies and retain individual texels at double magnification",async({page})=>{
  await loadImages(page);
  const result=await page.evaluate(()=>(window as unknown as {FigcraftImages:{largeImagePaints:typeof largeImagePaints}}).FigcraftImages.largeImagePaints(document.querySelector("canvas")!));
  await test.info().attach("large-image-paints",{body:JSON.stringify(result),contentType:"application/json"});
  expect(result.small).toEqual([[4096,5],[4096,5]]);
  expect(result.warm).toBe(2);
  expect(result.sizes.slice(2)).toEqual([[6000,8],[6000,8]]);
  expect(result.mismatches).toEqual([0,0]);
  expect(result.p95).toBeLessThan(16.7);
});

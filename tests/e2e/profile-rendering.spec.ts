import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { profileFrames } from "../fixtures/profile-rendering";

test("Display P3 pans a 10000-node document and proofs the translucent composite", async ({page}) => {
  const built = await build({configFile:false, logLevel:"silent", build:{write:false,lib:{
    entry:"tests/fixtures/profile-rendering.ts",name:"FigcraftProfile",formats:["iife"]}}});
  const output = (Array.isArray(built) ? built[0] : built) as {output:{type:string;code?:string}[]};
  const code = output.output.find(item => item.type === "chunk")?.code;
  if (!code) throw Error("Profile fixture failed to build");
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:code});
  const result = await page.evaluate(() => (window as unknown as {FigcraftProfile:{profileFrames:typeof profileFrames}})
    .FigcraftProfile.profileFrames(document.querySelector("canvas")!));
  await test.info().attach("working-space-pan",{body:JSON.stringify(result),contentType:"application/json"});
  expect(result.pixel[0]).toBeCloseTo(128,-0.5); expect(result.pixel[1]).toBeCloseTo(127,-0.5);
  expect(result.pixel.slice(2)).toEqual([0,255]);
  expect(result.p95).toBeLessThan(16.7);
});

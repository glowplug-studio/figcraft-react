import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/eyedropper";

declare global { interface Window { FigcraftEyedropper: typeof Fixture } }

// Restates native crates/engine/src/eyedropper_image_tests.rs at bad07e44 (upstream 30767bd2, #2189).
test("the eyedropper picks a magnified image's pixel under the pointer, not a blend with its neighbours, as native does", async ({ page }) => {
  const result = await build({ configFile:false, logLevel:"silent", build:{ write:false, lib:{ entry:"tests/fixtures/eyedropper.ts", name:"FigcraftEyedropper", formats:["iife"] } } });
  const output = (Array.isArray(result) ? result[0] : result) as { output:{type:string;code?:string}[] };
  await page.goto("/login");
  await page.setContent("<title>Eyedropper</title>");
  await page.addScriptTag({ content: output.output.find(chunk => chunk.type === "chunk")!.code! });
  const picks: [number, number, number][] = [];
  for (const zoom of [2, 8, 20]) picks.push([4.5, 4.5, zoom], [2.5, 4.5, zoom]);
  picks.push([4.5, 4.5, 1]);
  const colours = await page.evaluate(p => window.FigcraftEyedropper.linePicks("#151B23", "#3D444D", p), picks);
  // The reporter's colours: a #3D444D border, 1 px wide, beside a darker background.
  expect(colours).toEqual(["3D444D", "151B23", "3D444D", "151B23", "3D444D", "151B23", "3D444D"]);
});

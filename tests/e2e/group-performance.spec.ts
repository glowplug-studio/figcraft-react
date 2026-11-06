import { expect, test } from "@playwright/test";
import { build } from "vite";

for (const [frames, navigating] of [[false, false], [true, false], [true, true]]) test(`Canvas 2D renders 10000 rectangles in nested ${frames ? "frames" : "groups"} ${navigating ? "during pan and zoom " : ""}within the frame budget`, async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/group-performance.ts", name: "FigcraftGroupPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Group performance fixture did not build");
  await page.setContent('<canvas aria-label="Group performance canvas"></canvas>');
  await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async ({ frames, navigating }) => {
    const fixture = (window as unknown as { FigcraftGroupPerformance: { measureGroupedDocument(canvas: HTMLCanvasElement, frames: boolean, navigating: boolean): Promise<{ rectangles: number; rootGroups: number; rootFrames: number; subgroups: number; measuredFrames: number; p95: number; max: number; pixel: number[]; changedBoundsPixel: number[]; reactRenderers: number }> } }).FigcraftGroupPerformance;
    return fixture.measureGroupedDocument(document.querySelector("canvas")!, frames, navigating);
  }, { frames, navigating });
  expect(measurement).toMatchObject({ rectangles: 10_000, rootGroups: frames ? 0 : 100, rootFrames: frames ? 100 : 0, subgroups: 1_000, measuredFrames: 110, reactRenderers: 0 });
  for (const [index, expected] of [231, 231, 231, 255].entries()) expect(Math.abs(measurement.pixel[index] - expected)).toBeLessThanOrEqual(1);
  for (const [index, expected] of [231, 231, 231, 255].entries()) expect(Math.abs(measurement.changedBoundsPixel[index] - expected)).toBeLessThanOrEqual(1);
  expect(measurement.p95).toBeLessThan(16.7);
  await test.info().attach(frames ? "frame-document-performance" : "group-document-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
});

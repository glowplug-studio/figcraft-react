import { expect, test } from "@playwright/test";
import { build } from "vite";

for (const scale of [false, true]) test(`transform ${scale ? "Scale" : "resize"} previews in a10000-node document retain the frame budget`, async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/transform-performance.ts", name: "FigcraftTransformPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Transform fixture did not build");
  await page.setContent('<canvas aria-label="Transform performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async scale => {
    const fixture = (window as unknown as { FigcraftTransformPerformance: { measureTransform(canvas: HTMLCanvasElement, scale: boolean): Promise<{ rectangles: number; selected: number; scale: boolean; previewCount: number; measuredFrames: number; p95: number; max: number; inputP95: number; rootNotifications: number; restored: boolean }> } }).FigcraftTransformPerformance;
    return fixture.measureTransform(document.querySelector("canvas")!, scale);
  }, scale);
  await test.info().attach("transform-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ rectangles: 9_999, selected: 100, previewCount: 10000, measuredFrames: 110, rootNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7);
});

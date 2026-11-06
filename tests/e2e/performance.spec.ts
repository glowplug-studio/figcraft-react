import { expect, test } from "@playwright/test";
import { build } from "vite";

test("Canvas 2D renders 10000 rectangles within the frame budget", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/canvas-performance.ts", name: "FigcraftPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Performance fixture did not build");
  await page.setContent('<canvas aria-label="Performance canvas"></canvas>');
  await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => {
    const fixture = (window as unknown as { FigcraftPerformance: { measureLargeDocument(canvas: HTMLCanvasElement): Promise<{ rectangles: number; measuredFrames: number; p95: number; max: number; pixel: number[] }> } }).FigcraftPerformance;
    return fixture.measureLargeDocument(document.querySelector("canvas")!);
  });
  expect(measurement.rectangles).toBe(10_000);
  expect(measurement.pixel).toEqual([217,217,217,255]);
  expect(measurement.p95).toBeLessThan(16.7);
  await test.info().attach("large-document-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
});

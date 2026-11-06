import { expect, test } from "@playwright/test";
import { build } from "vite";

test("corner previews in a10000-node document retain the frame budget", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/corner-performance.ts", name: "FigcraftCornerPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Corner fixture did not build");
  await page.setContent('<canvas aria-label="Corner performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => {
    const fixture = (window as unknown as { FigcraftCornerPerformance: { measureCorners(canvas: HTMLCanvasElement): Promise<{ rectangles: number; selected: number; previewCount: number; measuredFrames: number; p95: number; max: number; inputP95: number; rootNotifications: number; restored: boolean }> } }).FigcraftCornerPerformance;
    return fixture.measureCorners(document.querySelector("canvas")!);
  });
  await test.info().attach("corner-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ rectangles: 9_999, selected: 1, previewCount: 10000, measuredFrames: 110, rootNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7);
});

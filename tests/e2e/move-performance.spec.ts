import { expect, test } from "@playwright/test";
import { build } from "vite";

for (const duplicate of [false, true]) test(`canvas ${duplicate ? "Alt-copy" : "move"} previews in a10000-node document retain the frame budget`, async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/move-performance.ts", name: "FigcraftMovePerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Move fixture did not build");
  await page.setContent('<canvas aria-label="Move performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async duplicate => {
    const fixture = (window as unknown as { FigcraftMovePerformance: { measureMove(canvas: HTMLCanvasElement, duplicate: boolean): Promise<{ rectangles: number; selected: number; duplicate: boolean; previewCount: number; measuredFrames: number; p95: number; max: number; inputP95: number; rootNotifications: number; restored: boolean }> } }).FigcraftMovePerformance;
    return fixture.measureMove(document.querySelector("canvas")!, duplicate);
  }, duplicate);
  await test.info().attach("move-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ rectangles: 9_999, selected: duplicate ? 20 : 100, previewCount: duplicate ? 10020 : 10000, measuredFrames: 110, rootNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7);
});

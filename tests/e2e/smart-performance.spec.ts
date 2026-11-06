import { expect, test } from "@playwright/test";
import { build } from "vite";

test("smart-selection previews and handles in a10000-node document stay within the frame budget", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/smart-performance.ts", name: "FigcraftSmartPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Smart-selection fixture did not build");
  await page.setContent('<canvas aria-label="Smart-selection performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => {
    const fixture = (window as unknown as { FigcraftSmartPerformance: { measureSmartSelection(canvas: HTMLCanvasElement): Promise<{ rectangles: number; selected: number; measuredFrames: number; p95: number; max: number; inputP95: number; rootNotifications: number; restored: boolean }> } }).FigcraftSmartPerformance;
    return fixture.measureSmartSelection(document.querySelector("canvas")!);
  });
  await test.info().attach("smart-selection-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ rectangles: 9_999, selected: 100, measuredFrames: 110, rootNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7);
});

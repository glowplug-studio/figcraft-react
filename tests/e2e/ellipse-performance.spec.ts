import { expect, test } from "@playwright/test";
import { build } from "vite";

test("ellipse previews in a10000-node document retain the frame budget", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/ellipse-performance.ts", name: "FigcraftEllipsePerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Ellipse fixture did not build");
  await page.setContent('<canvas aria-label="Ellipse performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => {
    const fixture = (window as unknown as { FigcraftEllipsePerformance: { measureEllipses(canvas: HTMLCanvasElement): Promise<{ ellipses: number; selected: number; previewCount: number; measuredFrames: number; p95: number; max: number; inputP95: number; rootNotifications: number; restored: boolean; drawP95: number; drawRootNotifications: number }> } }).FigcraftEllipsePerformance;
    return fixture.measureEllipses(document.querySelector("canvas")!);
  });
  await test.info().attach("ellipse-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ ellipses: 9_999, selected: 1, previewCount: 10000, measuredFrames: 110, rootNotifications: 0, restored: true, drawRootNotifications: 0 });
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.drawP95).toBeLessThan(16.7);
});

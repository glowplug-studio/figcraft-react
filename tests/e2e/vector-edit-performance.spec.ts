import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import type { measureRegionFills, measureVectorEdit } from "../fixtures/vector-edit-performance";

async function openBenchmark(page: Page) {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/vector-edit-performance.ts", name: "VectorEditPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Vector edit fixture did not build");
  await page.setContent('<canvas aria-label="Vector editing performance"></canvas>'); await page.addScriptTag({ content: code });
}

for (const operation of ["move", "scale", "rotate", "width", "paint", "region"] as const) test(`vector point ${operation} previews and overlays keep the frame budget across100 edited layers in10000 nodes`, async ({ page }) => {
  await openBenchmark(page);
  const measurement = await page.evaluate(operation => (window as unknown as { VectorEditPerformance: { measureVectorEdit: typeof measureVectorEdit } }).VectorEditPerformance.measureVectorEdit(document.querySelector("canvas")!, operation), operation);
  await test.info().attach("vector-edit-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ nodes: 10_000, visibleEditedLayers: 100, measuredFrames: 110, rootNotifications: 0, chromeNotifications: 0, restored: true });
  expect(measurement.selectedPoints).toBe(operation === "region" ? 103 : 100);
  if (operation === "paint" || operation === "region") expect(measurement.hoverPanP95).toBeLessThan(16.7);
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.inputP95).toBeLessThan(16.7);
});

test("selected region fill commands and draw stay within the frame budget in 10000 nodes", async ({ page }) => {
  await openBenchmark(page);
  const result = await page.evaluate(() => (window as unknown as { VectorEditPerformance: { measureRegionFills: typeof measureRegionFills } }).VectorEditPerformance.measureRegionFills(document.querySelector("canvas")!));
  await test.info().attach("region-fill-performance", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result).toMatchObject({ nodes: 10_000, editedLayers: 100, regions: 2, edits: 120, measuredFrames: 110 });
  expect(result.p95).toBeLessThan(16.7); expect(result.inputP95).toBeLessThan(16.7);
});

import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { measureVectorEdit } from "../fixtures/vector-edit-performance";

test("vector point previews and overlays keep the frame budget across100 edited layers in10000 nodes", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/vector-edit-performance.ts", name: "VectorEditPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Vector edit fixture did not build");
  await page.setContent('<canvas aria-label="Vector editing performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(() => (window as unknown as { VectorEditPerformance: { measureVectorEdit: typeof measureVectorEdit } }).VectorEditPerformance.measureVectorEdit(document.querySelector("canvas")!));
  await test.info().attach("vector-edit-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ nodes: 10_000, visibleEditedLayers: 100, selectedPoints: 100, measuredFrames: 110, rootNotifications: 0, chromeNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.inputP95).toBeLessThan(16.7);
});

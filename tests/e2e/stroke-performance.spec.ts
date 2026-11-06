import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { measureStrokes } from "../fixtures/stroke-performance";

test("Line and dashed stroke previews retain the10000-node frame budget", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/stroke-performance.ts", name: "FigcraftStrokePerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Stroke fixture did not build");
  await page.setContent('<canvas aria-label="Stroke performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => (window as unknown as { FigcraftStrokePerformance: { measureStrokes: typeof measureStrokes } }).FigcraftStrokePerformance.measureStrokes(document.querySelector("canvas")!));
  await test.info().attach("stroke-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ nodes: 10000, visible: 100, measuredFrames: 110, rootNotifications: 0, restored: true, drawRootNotifications: 0 });
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.drawP95).toBeLessThan(16.7);
});

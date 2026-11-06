import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { measurePointShapes } from "../fixtures/polygon-performance";

test("Polygon Star previews retain the frame budget in a10000-node document", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/polygon-performance.ts", name: "FigcraftPointShapePerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Shape fixture did not build");
  await page.setContent('<canvas aria-label="Polygon performance"></canvas>'); await page.addScriptTag({ content: code });
  const measurement = await page.evaluate(async () => {
    const fixture = (window as unknown as { FigcraftPointShapePerformance: { measurePointShapes: typeof measurePointShapes } }).FigcraftPointShapePerformance;
    return fixture.measurePointShapes(document.querySelector("canvas")!);
  });
  await test.info().attach("polygon-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ nodes: 10000, measuredFrames: 110, rootNotifications: 0, drawRootNotifications: 0, restored: true });
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.drawP95).toBeLessThan(16.7);
});

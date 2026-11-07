import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { measurePen } from "../fixtures/pen-performance";

for (const operation of ["hover", "draw", "edit"] as const) test(`Pen ${operation} keeps its frame budget in10000 nodes`, async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/pen-performance.ts", name: "PenPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Pen fixture did not build");
  await page.setContent('<canvas aria-label="Pen performance"></canvas>'); await page.addScriptTag({ content: code });
  const measured = await page.evaluate(operation => (window as unknown as { PenPerformance: { measurePen: typeof measurePen } }).PenPerformance.measurePen(document.querySelector("canvas")!, operation), operation);
  await test.info().attach("pen-performance", { body: JSON.stringify(measured), contentType: "application/json" });
  expect(measured).toMatchObject({ nodes: 10_000, visibleLayers: 100, measuredFrames: 110, rootNotifications: 0, chromeNotifications: 0, restored: true });
  expect(measured.p95).toBeLessThan(16.7); expect(measured.inputP95).toBeLessThan(16.7);
});

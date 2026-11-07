import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { measurePencil } from "../fixtures/pencil-performance";

test("Pencil preview and long-stroke completion stay responsive in10000 nodes", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/pencil-performance.ts", name: "PencilPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Pencil fixture did not build");
  await page.setContent('<canvas aria-label="Pencil performance"></canvas>'); await page.addScriptTag({ content: code });
  const measured = await page.evaluate(() => (window as unknown as { PencilPerformance: { measurePencil: typeof measurePencil } }).PencilPerformance.measurePencil(document.querySelector("canvas")!));
  await test.info().attach("pencil-performance", { body: JSON.stringify(measured), contentType: "application/json" });
  expect(measured).toMatchObject({ nodes: 10_000, visibleLayers: 100, measuredFrames: 110, rootNotifications: 0, chromeNotifications: 0, restored: true, samples: 4001, completed: true, undoDepth: 1 });
  expect(measured.p95).toBeLessThan(16.7); expect(measured.inputP95).toBeLessThan(16.7);
  expect(measured.completionMs).toBeLessThan(100);
});

import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { sideStrokePixels } from "../fixtures/side-stroke-rendering";

test("per-side strokes preserve native edge matrix, rounded clipping, alpha and Frame ordering", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/side-stroke-rendering.ts", name: "SideStrokePixels", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Side stroke fixture did not build");
  await page.setContent('<canvas aria-label="Side stroke pixel fixture"></canvas>'); await page.addScriptTag({ content: code });
  const pixels = await page.evaluate(() => (window as unknown as { SideStrokePixels: { sideStrokePixels: typeof sideStrokePixels } }).SideStrokePixels.sideStrokePixels(document.querySelector("canvas")!));
  await test.info().attach("side-stroke-pixels", { body: JSON.stringify(pixels), contentType: "application/json" });
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  expect(pixels.matrix).toHaveLength(24);
  for (const row of pixels.matrix) row.pixels.forEach((p, index) => expect(p, `${row.kind}/${row.align}/${row.side} edge${index}`).toEqual(index === row.side ? black : white));
  expect(pixels.bar).toEqual([black, black, black, black, white]);
  expect(pixels.fit.side).toEqual([255, 127, 127, 255]);
  // Independently flattened/clipped boundaries permit one Canvas coverage quantisation level.
  for (const p of [pixels.fit.hole, pixels.fit.above, pixels.fit.below]) p.forEach(channel => expect(channel).toBeGreaterThanOrEqual(254));
  expect(pixels.smoothed).toEqual({ topInk: 0, bottom: black, corner: white });
  expect(pixels.stray).toBe(0);
  expect(pixels.culled).toEqual(black);
  expect(pixels.order).toEqual({ stroke: [255, 0, 0, 255], child: [0, 0, 255, 255] });
  expect(pixels.metadata).toEqual({ overlap: white, band: black, head: black });
});

import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { vectorPixels } from "../fixtures/vector-rendering";

test("vectors preserve fill regions, holes, open strokes, point styles, arrows and mask reuse", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/vector-rendering.ts", name: "VectorPixels", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Vector fixture did not build");
  await page.setContent('<canvas aria-label="Vector pixels"></canvas>'); await page.addScriptTag({ content: code });
  const pixels = await page.evaluate(() => (window as unknown as { VectorPixels: { vectorPixels: typeof vectorPixels } }).VectorPixels.vectorPixels(document.querySelector("canvas")!));
  await test.info().attach("vector-pixels", { body: JSON.stringify(pixels), contentType: "application/json" });
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  expect(pixels.openFill).toEqual(white); expect(pixels.separate).toEqual({ fill: [255, 0, 0, 255], stroke: black, gap: white });
  expect(pixels.curve).toEqual({ ink: black, interior: white, endpoint: black });
  expect(pixels.hole).toEqual({ ring: black, hole: white });
  expect(pixels.alignments.inside).toEqual({ outer: white, inner: black, holeOutside: black, holeInside: white });
  expect(pixels.alignments.outside).toEqual({ outer: black, inner: white, holeOutside: white, holeInside: black });
  expect(pixels.regions).toEqual({ first: [255, 127, 127, 255], overlap: [127, 127, 255, 255], second: [127, 127, 255, 255] });
  expect(pixels.pointStyles.start).toEqual(black); expect(pixels.pointStyles.end).toEqual(white);
  // The round join sample touches a curved antialiased edge; allow two8-bit coverage levels.
  expect(pixels.pointStyles.corner[3]).toBe(255); for (const channel of pixels.pointStyles.corner.slice(0, 3)) expect(channel).toBeLessThanOrEqual(2);
  expect(pixels.arrows).toEqual({ first: white, last: black });
  for (const [label, difference] of Object.entries(pixels.comparisons)) expect(difference, label).toBeLessThanOrEqual(2);
  expect(pixels.cacheEqual).toBe(true);
});

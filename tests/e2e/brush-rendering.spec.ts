import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { brushPixels } from "../fixtures/brush-rendering";

test("brushes preserve native dots, taper, seeded output, alignment, precedence and fallback", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/brush-rendering.ts", name: "BrushPixels", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Brush fixture did not build");
  await page.setContent('<canvas aria-label="Brush pixels"></canvas>'); await page.addScriptTag({ content: code });
  const pixels = await page.evaluate(() => (window as unknown as { BrushPixels: { brushPixels: typeof brushPixels } }).BrushPixels.brushPixels(document.querySelector("canvas")!));
  await test.info().attach("brush-pixels", { body: JSON.stringify(pixels), contentType: "application/json" });
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  expect(pixels.scatter).toEqual({ dot: black, gap: white }); expect(pixels.taper).toEqual({ middle: black, start: white });
  expect(Object.keys(pixels.counts)).toHaveLength(8); for (const n of Object.values(pixels.counts)) expect(n).toBeGreaterThan(100);
  expect(pixels.pressure).toEqual({ firstOutside: white, lastInside: black }); expect(pixels.repeat).toBe(true); expect(pixels.different).toBe(true);
  for (const ink of [pixels.alignments.inside.inside, pixels.alignments.outside.outside]) {
    // Canvas mask/image compositing permits one8-bit rounding level around half-opacity red.
    expect(ink[0]).toBe(255); expect(ink[3]).toBe(255); expect(ink[1]).toBeGreaterThanOrEqual(126); expect(ink[1]).toBeLessThanOrEqual(128); expect(ink[2]).toBe(ink[1]);
  }
  expect(pixels.alignments.inside.outside).toEqual(white); expect(pixels.alignments.outside.inside).toEqual(white);
  expect(pixels.alignments.center).toEqual({ inside: white, outside: white });
  expect(pixels.centreInk).toEqual([255, 127, 127, 255]);
  expect(pixels.cachePixelsEqual).toBe(true);
  expect(pixels.arrow).toEqual({ overlap: [255, 127, 127, 255], head: [255, 127, 127, 255] });
  expect(pixels.precedence).toEqual({ top: black, right: white }); expect(pixels.culled).toEqual(black); expect(pixels.fallback).toEqual(black);
});

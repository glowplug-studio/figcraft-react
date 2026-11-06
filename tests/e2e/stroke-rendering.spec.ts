import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { strokePixels } from "../fixtures/stroke-rendering";

test("stroke rendering preserves alignment, alpha, Frame order, caps and viewport reach", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/stroke-rendering.ts", name: "FigcraftStrokePixels", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Stroke fixture did not build");
  await page.setContent('<canvas aria-label="Stroke pixel fixture"></canvas>'); await page.addScriptTag({ content: code });
  const pixels = await page.evaluate(() => (window as unknown as { FigcraftStrokePixels: { strokePixels: typeof strokePixels } }).FigcraftStrokePixels.strokePixels(document.querySelector("canvas")!));
  await test.info().attach("stroke-pixels", { body: JSON.stringify(pixels), contentType: "application/json" });
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255];
  for (const p of Object.values(pixels.alpha)) { expect(p[0]).toBe(255); expect(p[1]).toBeGreaterThanOrEqual(127); expect(p[1]).toBeLessThanOrEqual(128); expect(p[2]).toBe(p[1]); }
  expect(pixels.styles.inside).toEqual({ edge: red, inside: white, outside: white });
  expect(pixels.styles.center.edge).toEqual(red); expect(pixels.styles.center.inside).toEqual(white);
  expect(pixels.styles.outside).toEqual({ edge: white, inside: white, outside: red });
  expect(pixels.overlay).toEqual({ stroke: red, child: [0, 0, 255, 255] });
  expect(pixels.stack.edge).toEqual([255, 127, 127, 255]); expect(pixels.stack.centre).toEqual([127, 127, 255, 255]);
  expect(pixels.culled).toEqual([0, 0, 0, 255]);
  expect(pixels.asymmetric.roundCorner[0]).toBeGreaterThan(150); expect(pixels.asymmetric.squareCorner[0]).toBeLessThan(50);
  expect(pixels.asymmetric.dash).toEqual([0, 0, 0, 255]); expect(pixels.asymmetric.gap).toEqual(white);
  expect(pixels.cache).toEqual({ resized: red, recoloured: [0, 0, 255, 255], moved: { old: white, current: [0, 0, 255, 255] } });
});

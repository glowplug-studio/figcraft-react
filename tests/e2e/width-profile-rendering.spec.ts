import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { widthProfilePixels } from "../fixtures/width-profile-rendering";

test("width profiles preserve sided bands, alignment, caps, dashes, alpha, precedence and culling", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/width-profile-rendering.ts", name: "WidthPixels", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Width profile fixture did not build");
  await page.setContent('<canvas aria-label="Width profile pixels"></canvas>'); await page.addScriptTag({ content: code });
  const pixels = await page.evaluate(() => (window as unknown as { WidthPixels: { widthProfilePixels: typeof widthProfilePixels } }).WidthPixels.widthProfilePixels(document.querySelector("canvas")!));
  await test.info().attach("width-profile-pixels", { body: JSON.stringify(pixels), contentType: "application/json" });
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  expect(pixels.taper).toEqual({ start: black, end: white });
  expect(pixels.sided).toEqual({ below: black, above: white, cap: black });
  expect(pixels.dash).toEqual({ ink: black, gap: white, narrow: white });
  expect(pixels.dots).toEqual({ ink: black, gap: white });
  expect(pixels.styles).toEqual({ inside: { inner: black, outer: white, middle: white }, center: { inner: black, outer: black, middle: white }, outside: { inner: white, outer: black, middle: white } });
  expect(pixels.ring).toEqual({ wide: black, hole: white, tip: white });
  // Native variable band and TriangleArrow wind in opposite directions; their overlap cancels.
  expect(pixels.alpha).toEqual({ band: [255, 127, 127, 255], overlap: white, head: [255, 127, 127, 255] });
  expect(pixels.sides).toEqual({ top: black, right: white, bottom: white });
  expect(pixels.culled).toEqual(black); expect(pixels.fallback).toEqual(black);
  expect(pixels.extremeReach).toBe(20000);
});

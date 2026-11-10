import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { build } from "vite";
import cases from "../fixtures/native-png-exports.json" with { type: "json" };
import codecs from "../fixtures/native-raster-codecs.json" with { type: "json" };
import { embeddedIcc } from "../../src/engine/icc-container";
import { iccDescription } from "../../src/engine/image-profile";
import { jpegHeader } from "../../src/engine/jpeg-header";
import type { replay } from "../fixtures/raster-export";

const { PNG } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle") as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } }
};

let script: string;
test.beforeAll(async () => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false,
    lib: { entry: "tests/fixtures/raster-export.ts", name: "FigcraftRaster", formats: ["iife"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Could not build export fixture");
  script = code;
});
async function loadExporter(page: Page) {
  await page.goto("/login"); await page.setContent("<main></main>"); await page.addScriptTag({ content: script });
}

test("PNG export matches independently rendered native pixels, size and colour tags", async ({ page }) => {
  await loadExporter(page);
  for (const entry of cases.filter(c => c.png)) {
    const base64 = await page.evaluate(commands => (window as unknown as { FigcraftRaster: { replay: typeof replay } }).FigcraftRaster.replay(commands), entry.commands);
    const bytes = Buffer.from(base64, "base64"), actual = PNG.sync.read(bytes), native = PNG.sync.read(Buffer.from(entry.png!, "base64"));
    expect([actual.width, actual.height], entry.name).toEqual([native.width, native.height]);
    for (let i = 0; i < actual.data.length; i += 4) {
      const alpha = actual.data[i + 3], nativeAlpha = native.data[i + 3];
      // The final 0.05-pixel strip has analytic coverage 12.75/255. Chromium includes it;
      // the native rasteriser has no covered sample there. Compare composited contributions.
      const fringe = entry.name === "float edge" && (i / 4) % actual.width === actual.width - 1;
      const tolerance = fringe ? 13 : 2;
      expect(Math.abs(alpha - nativeAlpha), entry.name).toBeLessThanOrEqual(tolerance);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs((actual.data[i + c] * alpha - native.data[i + c] * nativeAlpha) / 255), entry.name).toBeLessThanOrEqual(tolerance);
      }
    }
    const chunks: string[] = [];
    for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) chunks.push(bytes.toString("ascii", at + 4, at + 8));
    if (entry.name === "p3 tag") expect(chunks).toEqual(expect.arrayContaining(["cICP", "iCCP"]));
    else expect(chunks).toContain("sRGB");
  }
});

test("lossless WebP and baseline JPEG retain native profiles, alpha and full chroma", async ({ page }) => {
  await loadExporter(page);
  for (const entry of codecs) {
    const isJpeg = entry.name.startsWith("jpg"), p3 = entry.name.includes("displayP3");
    const mime = isJpeg ? "image/jpeg" : "image/webp";
    const encoded = await page.evaluate(commands => (window as unknown as { FigcraftRaster: { replay: typeof replay } }).FigcraftRaster.replay(commands), entry.commands);
    const bytes = Buffer.from(encoded, "base64");
    const icc = await embeddedIcc(Uint8Array.from(bytes), mime);
    if (isJpeg || p3) expect(icc && iccDescription(icc.profile)?.name, entry.name).toBe(p3 ? "Display P3" : "sRGB");
    else expect(icc).toBeUndefined();
    if (isJpeg) expect(jpegHeader(bytes)?.sampling).toEqual([17,17,17]);
    else expect(bytes.includes(Buffer.from("VP8L"))).toBe(true);
    const result = await page.evaluate(async ({ encoded, native, mime }) => {
      async function read(data: string) {
        const blob = await (await fetch("data:" + mime + ";base64," + data)).blob();
        const image = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        try {
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, image.width, image.height).data;
        } finally { image.close(); }
      }
      const a = await read(encoded), b = await read(native);
      let max = 0, sum = 0;
      for (let i = 0; i < a.length; i++) {
        const error = Math.abs(a[i] - b[i]); max = Math.max(max, error); sum += error;
      }
      return { max, mean: sum / a.length, length: a.length };
    }, { encoded, native: entry.data, mime });
    expect(result.length).toBe(24 * 20 * 4);
    if (isJpeg) expect(result.mean, entry.name).toBeLessThan(entry.name.endsWith("20") ? 2 : 0.6);
    else expect(result.max, entry.name).toBe(0);
  }
});

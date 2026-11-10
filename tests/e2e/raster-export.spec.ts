import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { build } from "vite";
import cases from "../fixtures/native-png-exports.json" with { type: "json" };
import type { replay } from "../fixtures/raster-export";

const { PNG } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle") as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } }
};

test("PNG export matches independently rendered native pixels, size and colour tags", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false,
    lib: { entry: "tests/fixtures/raster-export.ts", name: "FigcraftRaster", formats: ["iife"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Could not build export fixture");
  await page.goto("/login"); await page.setContent("<main></main>"); await page.addScriptTag({ content: code });
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

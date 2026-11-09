import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

// Exact default WASM catalogue selected by build.rs from both craft-fonts manifests at 37827adc.
const fonts = [
  ["inter/Inter-Regular.ttf","40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82"],
  ["inter/Inter-Italic.ttf","bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a"],
  ["inter/Inter-SemiBold.ttf","78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3"],
  ["inter/Inter-Bold.ttf","288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f"],
  ["noto-sans-georgian/NotoSansGeorgian.ttf","dc591156f36842d38996c4a7a17fee9bb58e45da3e2cac7a31b7d33de700adb9"],
] as const;

it.each(fonts)("ships the original %s and registers its byte-identical face", async (file, digest) => {
  const src = await readFile(new URL("../../fonts/" + file, import.meta.url));
  expect(createHash("sha256").update(src).digest("hex")).toBe(digest);
  const css = await readFile(new URL("../../fonts/catalog.css",import.meta.url),"utf8");
  expect(css).toContain('url("./' + file + '")');
});

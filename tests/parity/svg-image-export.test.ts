import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../fixtures/native-svg-image-export.json";
import { EditorEngine } from "../../src/engine/editor";

// An SVG export writes each image's bytes once per file, as an <image> in defs that every paint of it uses through its
// own <pattern>. Observed through the native engine at bad07e44 (upstream 9032dc3e, #2250;
// tests/fixtures/native-svg-image-export.provenance.md).

// The pure test environment cannot decode pixels: each PNG's size comes from its header, as a browser reads it.
beforeEach(() => vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  return { width: head.getUint32(16), height: head.getUint32(20), close() {} };
}));
afterEach(() => vi.unstubAllGlobals());

it.each(fixture.cases.map(c => [c.name, c] as const))("matches the native SVG for %s", async (_name, c) => {
  const engine = new EditorEngine();
  for (const [command, params] of c.commands.slice(0, -1) as [string, Record<string, unknown>][]) await engine.executeAsync(command, params);
  const { data } = await engine.executeAsync("file.export", c.commands.at(-1)![1] as Record<string, unknown>) as { data: string };
  // As in svg-export.test.ts: native's rounded stroke outline holds redundant cubics of zero length.
  const expected = c.name === "an image fill and an image stroke" ? c.svg.replace(/C(-?\d+) (-?\d+) \1 \2 \1 \2/g, "") : c.svg;
  expect(Buffer.from(data, "base64").toString("utf8")).toBe(expected);
});

it("embeds an image once however many paints use it", () => {
  const three = fixture.cases.find(c => c.name === "three paints of one image")!.svg;
  expect([three.match(/<image /g)?.length, three.match(/<pattern /g)?.length, three.match(/<use href="#image2"\/>/g)?.length]).toEqual([1, 3, 3]);
});

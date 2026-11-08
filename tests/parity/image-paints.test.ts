import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { readPaint, samePaints } from "../../src/engine/solid-paint";
import { adjustImagePixels, readImageFilters } from "../../src/engine/image-filters";
import { base64Bytes } from "../../src/engine/recovery";
import { decodeFigcraft } from "../../src/engine/file-format";
import { rectanglePaints, type RectangleNode } from "../../src/engine/document";

const png = readFileSync(new URL("../fixtures/images/six-pixels.png", import.meta.url));
const data = base64Bytes(png);
const plain = { type: "image", image: "source" };
afterEach(() => vi.unstubAllGlobals());

describe("native image paints and placement", () => {
  it("defaults native records and compares crop, rotation, visibility and independent adjustments", () => {
    const base = readPaint(plain);
    expect(base).toMatchObject({ scale_mode: "fill", scale: 1, rotation: 0, crop: null, visible: true, opacity: 1, colorAlpha: 1, filters: { shadows: 0 } });
    const input = { ...plain, rotation: -1, crop: [2,0,0,1,-.25,.2], filters: { saturation: .2 } };
    const stored = readPaint(input);
    expect(samePaints([stored], [readPaint(input)])).toBe(true);
    input.crop[0]++;
    expect(samePaints([stored], [readPaint(input)])).toBe(false);
    expect(stored).toMatchObject({ filters: { saturation: Math.fround(.2) }, crop: [2,0,0,1,-.25,.2] });
    for (const extra of [{ scale_mode: "stretch" }, { scale: Infinity }, { rotation: 1.2 }, { rotation: 2**31 }, { crop: [1] }, { filters: null }]) {
      expect(() => readPaint({ ...plain, ...extra })).toThrow();
    }
  });

  it("uses all seven adjustment channels and retains transparency", () => {
    const sample = (channels: Record<string, number>, pixel=[128,128,128,255]) => {
      const pixels = Uint8ClampedArray.from(pixel);
      adjustImagePixels(pixels, readImageFilters(channels)); return [...pixels];
    };
    expect(sample({ exposure: 1 })).toEqual([255,255,255,255]);
    expect(sample({ contrast: -1 }, [0,0,0,255])).toEqual([128,128,128,255]);
    expect(sample({ saturation: -1 }, [255,0,0,255])).toEqual([54,54,54,255]);
    expect(sample({ temperature: 1 })).toEqual([166,128,90,255]);
    expect(sample({ tint: -1 })).toEqual([128,90,128,255]);
    expect(sample({ highlights: -1 }, [255,255,255,255])).toEqual([179,179,179,255]);
    expect(sample({ shadows: 1 }, [0,0,0,255])).toEqual([77,77,77,255]);
    expect(sample({ saturation:-1 }, [255,0,0,128])).toEqual([54,54,54,128]);
    expect(sample({ temperature:1 }, [0,0,0,0])).toEqual([0,0,0,0]);
  });

  it("places a density-aware rectangle, appends to an existing fill, deduplicates, and restores exactly one undo per placement", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3, height: 2, close }));
    const engine = new EditorEngine();
    const first = await engine.executeAsync("image.place", { data, width: 30, mode: "FIT", name: "Photo" });
    expect(first).toMatchObject({ width: 30, height: 20 });
    const initial = engine.getSnapshot().document;
    const node = initial.nodes[String(first.id)] as RectangleNode;
    expect(node).toMatchObject({ name: "Photo", fills: [{ type: "image", scale_mode: "fit", image: first.image }] });
    const appended = await engine.executeAsync("file.placeImage", { target: first.id, data: "data:image/png;base64,"+data, mode: "tile" });
    expect(appended).toMatchObject({ id: first.id, image: first.image, width: 30 });
    expect(Object.keys(engine.getSnapshot().document.images!)).toEqual([first.image]);
    expect(engine.getSnapshot().document.images).toBe(initial.images);
    expect(engine.getSnapshot().selection).toEqual([first.id]);
    const saved = (await decodeFigcraft(await engine.nativeSnapshot())).document;
    expect(rectanglePaints(saved.nodes[node.id] as RectangleNode).map(p => p.type === "image" && p.scale_mode)).toEqual(["fit", "tile"]);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(initial);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document.images).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("opens a raster at its pixel dimensions and refuses a damaged or interrupted placement atomically", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3, height: 2, close() {} }));
    const engine = new EditorEngine();
    const result = await engine.executeAsync("file.open", { data, name: "sample.png" });
    expect(result.summary).toEqual({ name: "sample", pages: 1, layers: 1, images: 1 });
    expect(engine.getSnapshot().document.nodes["2"]).toMatchObject({ x: 0, y: 0, width: 3, height: 2, name: "sample" });
    const before = engine.getSnapshot();
    vi.stubGlobal("createImageBitmap", async () => { throw new Error("bad pixels"); });
    await expect(engine.executeAsync("image.place", { data })).rejects.toThrow("can't be read");
    expect(engine.getSnapshot()).toBe(before);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3, height: 2, close() {} }));
    const placing = engine.executeAsync("image.place", { data });
    engine.execute("shape.rectangle");
    const current = engine.getSnapshot();
    await expect(placing).rejects.toThrow("cancelled");
    expect(engine.getSnapshot()).toBe(current);
  });
});

import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { newDocument } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";

async function presetFile(imagePresets: unknown) {
  const members = unzipSync(await encodeFigcraft(newDocument()));
  const root = JSON.parse(strFromU8(members["document.json"]!));
  return new TextEncoder().encode(JSON.stringify({ ...root, image_presets: imagePresets }));
}

describe("native image adjustment presets", () => {
  it("lists the seven native presets with all channels, defaults and f32 precision", () => {
    const engine = new EditorEngine();
    const snapshot = engine.getSnapshot();
    const { builtIn, saved } = engine.execute("image.presets");
    expect(builtIn.map(p => p.id)).toEqual(["vivid", "muted", "warm", "cool", "blackAndWhite", "fade", "reset"]);
    expect(builtIn[0].filters).toEqual({ contrast: Math.fround(0.2), saturation: Math.fround(0.45), highlights: Math.fround(-0.1), shadows: Math.fround(0.1), tint: 0, exposure: 0, temperature: 0 });
    expect(builtIn[4]).toMatchObject({ label: "Black & white", filters: { saturation: -1 } });
    expect(Object.values(builtIn[6].filters)).toEqual(Array(7).fill(0));
    expect(saved).toEqual([]);
    expect(engine.getSnapshot()).toBe(snapshot);
  });

  it("preserves ordered native preset names and file values through edits, undo and recovery", async () => {
    const engine = new EditorEngine();
    const data = await presetFile([{ name: "warm", filters: { exposure: 1.5 } }, { name: "Warm", filters: { tint: 0.1 } }]);
    await engine.executeAsync("file.open", { data: base64Bytes(data) });
    const { saved } = engine.execute("image.presets");
    expect(saved.map(p => p.name)).toEqual(["warm", "Warm"]);
    expect(saved[0].filters).toMatchObject({ exposure: 1.5, shadows: 0 });
    expect(Object.isFrozen(saved[1].filters)).toBe(true);
    engine.execute("shape.rectangle");
    engine.execute("edit.undo");
    expect(engine.execute("image.presets").saved).toBe(saved);
    const archive = await engine.nativeSnapshot();
    expect(JSON.parse(strFromU8(unzipSync(archive)["document.json"]!)).image_presets).toEqual(saved);
    await engine.executeAsync("file.recover", { data: base64Bytes(archive) });
    expect(engine.execute("image.presets").saved).toEqual(saved);
  });

  it.each([[{ name: "bad" }], [{ name: "bad", filters: { tint: "1" } }], [{ name: "bad", filters: { unknown: 1 } }]])("rejects invalid or unsupported adjustments atomically", async preset => {
    const engine = new EditorEngine();
    const before = engine.getSnapshot();
    await expect(engine.executeAsync("file.open", { data: base64Bytes(await presetFile([preset])) })).rejects.toThrow("Cannot open Figcraft file");
    expect(engine.getSnapshot()).toBe(before);
  });

  it("omits empty presets in files without image adjustments", async () => {
    const { document } = await decodeFigcraft(await presetFile([]));
    const root = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(document))["document.json"]!));
    expect(root).not.toHaveProperty("image_presets");
  });
});

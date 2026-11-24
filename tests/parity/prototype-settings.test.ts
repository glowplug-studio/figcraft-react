import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import native from "../fixtures/native-prototype-settings.json" with { type: "json" };

type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string; saved?: { prototype: unknown } };
const f32 = (v: unknown): unknown => typeof v === "number" ? Math.fround(v) : Array.isArray(v) ? v.map(f32) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f32(x)])) : v;

// Native cmd/proto.rs::settings and doc/src/proto.rs PrototypeSettings, observed at bad07e44: devices, colours, rotation,
// custom sizes, responsive and the background, checked before anything changes, answered and saved with the page.
it("sets, answers and saves a page's prototype settings as native does", async () => {
  const e = new EditorEngine();
  const { unzipSync, strFromU8 } = await import("fflate");
  for (const [n, step] of (native.steps as Step[]).entries()) {
    const where = `step ${n}: ${step.command} ${JSON.stringify(step.params)}`;
    if (step.saved) {
      const bytes = await encodeFigcraft(e.getSnapshot().document);
      const saved = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]));
      expect(f32(saved.nodes["1"].prototype), where).toEqual(f32(step.saved.prototype));
      // And the settings survive opening the file again.
      const again = (await decodeFigcraft(bytes)).document;
      const page = (doc: typeof again) => doc.nodes["1"] as { prototypeDevice?: unknown; prototypeBackground?: unknown };
      expect(page(again).prototypeDevice, where).toEqual(page(e.getSnapshot().document).prototypeDevice);
      expect(page(again).prototypeBackground, where).toEqual(page(e.getSnapshot().document).prototypeBackground);
      continue;
    }
    let receipt: unknown, error: string | undefined;
    try { receipt = e.execute(step.command, step.params); } catch (x) { error = (x as Error).message; }
    if (step.error !== undefined) expect(error, where).toBe(step.error);
    else { expect(error, where).toBeUndefined(); expect(f32(receipt), where).toEqual(f32(step.receipt)); }
  }
});

import { expect, it } from "vitest";
import { stringify } from "lossless-json";
import { EditorEngine } from "../../src/engine/editor";
import { wireInteractions } from "../../src/engine/prototype-data";
import native from "../fixtures/native-prototype-actions.json" with { type: "json" };

type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string; saved?: { interactions: unknown } };
const f32 = (v: unknown): unknown => typeof v === "number" ? Math.fround(v) : Array.isArray(v) ? v.map(f32) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f32(x)])) : v;

// Native cmd/proto_actions.rs, observed at bad07e44: actions are added, replaced, removed and reordered by path, inside
// conditional actions too, and if / else if / else blocks are added, given conditions and removed.
it("edits prototype actions and conditional blocks by path as native does", () => {
  const e = new EditorEngine();
  for (const [n, step] of (native.steps as Step[]).entries()) {
    const where = `step ${n}: ${step.command} ${JSON.stringify(step.params)}`;
    if (step.saved) {
      const node = e.getSnapshot().document.nodes["2"];
      expect(f32(JSON.parse(stringify(wireInteractions(node.interactions ?? []))!)), where).toEqual(f32(step.saved.interactions));
      continue;
    }
    let receipt: unknown, error: string | undefined;
    try { receipt = e.execute(step.command, step.params); } catch (x) { error = (x as Error).message; }
    if (step.error !== undefined) expect(error, where).toBe(step.error);
    else {
      expect(error, where).toBeUndefined();
      if (step.command.startsWith("proto.")) expect(f32(receipt), where).toEqual(f32(step.receipt));
    }
  }
});

import { expect, it } from "vitest";
import { stringify } from "lossless-json";
import { EditorEngine } from "../../src/engine/editor";
import { wireInteractions } from "../../src/engine/prototype-data";
import native from "../fixtures/native-prototype-expressions.json" with { type: "json" };

type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string; saved?: { interactions: unknown } };
const f32 = (v: unknown): unknown => typeof v === "number" ? Math.fround(v) : Array.isArray(v) ? v.map(f32) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f32(x)])) : v;

// Native proto_expr.rs, proto_expr_parse.rs and cmd/proto_actions.rs, observed at bad07e44: expression text is read with
// variables by name, checked, evaluated and written back; commands store names as ids.
it("reads, checks, evaluates and stores prototype expressions as native does", () => {
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

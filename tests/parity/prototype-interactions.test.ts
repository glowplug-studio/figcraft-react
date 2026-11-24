import { describe, expect, it } from "vitest";
import { stringify } from "lossless-json";
import { EditorEngine } from "../../src/engine/editor";
import { wireFlows, wireInteractions } from "../../src/engine/prototype-data";
import native from "../fixtures/native-prototype-interactions.json" with { type: "json" };

const f32 = (v: unknown): unknown => typeof v === "number" ? Math.fround(v) : Array.isArray(v) ? v.map(f32) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f32(x)])) : v;
type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string; saved?: Record<string, Record<string, unknown>> };

// Native cmd/proto.rs, observed at bad07e44: interactions are added, patched, removed and cleared, and flows start at top-level frames.
describe("prototype interaction and flow commands, as native runs them", () => {
  for (const c of native.cases as { name: string; steps: Step[] }[]) {
    it(c.name, () => {
      const e = new EditorEngine();
      for (const [n, step] of c.steps.entries()) {
        const where = `${c.name} step ${n}: ${step.command} ${JSON.stringify(step.params)}`;
        if (step.saved) {
          const doc = e.getSnapshot().document, saved: Record<string, Record<string, unknown>> = {};
          for (const [id, node] of Object.entries(doc.nodes)) {
            const fields: Record<string, unknown> = {};
            if (node.interactions?.length) fields.interactions = JSON.parse(stringify(wireInteractions(node.interactions))!);
            if (node.kind === "page" && node.flows?.length) fields.flows = JSON.parse(stringify(wireFlows(node.flows))!);
            saved[id] = fields;
          }
          // Colour channels are f32: native writes their shortest form.
          expect(f32(saved), where).toEqual(f32(step.saved));
          continue;
        }
        let receipt: unknown, error: string | undefined;
        try { receipt = e.execute(step.command, step.params); } catch (x) { error = (x as Error).message; }
        if (step.error !== undefined) expect(error, where).toBe(step.error);
        else {
          expect(error, where).toBeUndefined();
          // Setup commands answer in the port's own receipt form; the prototype commands answer as native does.
          if (step.command.startsWith("proto.")) expect(receipt, where).toEqual(step.receipt);
        }
      }
    });
  }

  it("undoes a removal", () => {
    const e = new EditorEngine();
    e.execute("node.create", { type: "frame", x: 0, y: 0, width: 100, height: 200 });
    e.execute("node.create", { type: "frame", x: 200, y: 0, width: 100, height: 200 });
    e.execute("proto.interaction.add", { id: 2, dest: 3 });
    e.execute("proto.interaction.add", { id: 2, dest: 3 });
    e.execute("proto.interaction.remove", { id: 2, index: 0 });
    expect(e.getSnapshot().document.nodes["2"].interactions).toHaveLength(1);
    e.execute("edit.undo");
    expect(e.getSnapshot().document.nodes["2"].interactions).toHaveLength(2);
  });
});

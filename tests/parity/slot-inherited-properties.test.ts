import { beforeAll, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { prepareText } from "../../src/engine/text-node-layout";
import native from "../fixtures/native-slot-inherited-properties.json" with { type: "json" };

// Restates native crates/engine/src/slot_tests.rs at bad07e44 (upstream a6d9b74d, a66946d1, 2067a0b5) through its observed receipts.
beforeAll(async () => { await prepareText("Default Custom Main value New default Wrong owner"); });

function pick(command: string, v: Record<string, unknown>) {
  if (command === "node.get") {
    const out: Record<string, unknown> = { id: v.id };
    if ("characters" in v) out.characters = v.characters;
    out.visible = v.visible ?? true;
    if (v.type === "INSTANCE") out.props = v.componentProperties ?? v.properties;
    return out;
  }
  if (command === "component.properties") return (v.properties as { name: string; value: unknown }[]).map(p => [p.name, p.value]);
  return null;
}

for (const scene of native.cases) {
  it("inherited slot properties resolve by their defining component as native: " + scene.name, () => {
    const e = new EditorEngine();
    for (const step of scene.steps) {
      const got = e.execute(step.command, step.params) as Record<string, unknown>;
      if (step.receipt !== null) expect(pick(step.command, got), step.command + " " + JSON.stringify(step.params)).toEqual(step.receipt);
    }
  });
}

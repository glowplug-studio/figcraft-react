import { beforeAll, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { prepareText } from "../../src/engine/text-node-layout";
import native from "../fixtures/native-text-style-weight-variable.json" with { type: "json" };

// Restates native crates/engine/src/style_vars_tests.rs and variables_io_tests.rs at bad07e44 (upstream ccb33e0b, 281918e2, #2174).
beforeAll(async () => { await prepareText("Hello Hi"); });

for (const scene of native.cases) {
  it("a text style's weight bound to a number variable, as native: " + scene.name, () => {
    const e = new EditorEngine();
    for (const step of scene.steps) {
      let got: unknown, refused = false;
      try { got = e.execute(step.command, step.params); } catch { refused = true; }
      const v = got as Record<string, unknown>;
      if (step.command === "node.get") expect({ fontStyle: v.fontStyle, wght: (v.fontVariations as Record<string, number> | undefined)?.wght ?? null }, JSON.stringify(step.params)).toEqual(step.receipt);
      else if (step.command === "style.bind") expect({ refused }, JSON.stringify(step.params)).toEqual(step.receipt);
      else if (step.command === "style.list") expect((got as { bound?: unknown }[]).map(s => s.bound ?? null)).toEqual(step.receipt);
      else if (step.command === "variable.export") expect((v.text as string).split("\n").filter(l => l.includes("weight")).map(l => l.trim())).toEqual(step.receipt);
    }
  });
}

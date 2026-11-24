import { beforeAll, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { prepareText } from "../../src/engine/text-node-layout";
import native from "../fixtures/native-instance-properties.json" with { type: "json" };

beforeAll(async () => { await prepareText("Label Title Dot"); });

for (const scene of native.cases) {
  it("an instance lists the properties its variant uses, as native: " + scene.name, () => {
    const e = new EditorEngine();
    for (const step of scene.steps) {
      const got = e.execute(step.command, step.params) as { properties?: Record<string, unknown>[] };
      if (step.receipt) expect(got.properties!.map(p => Object.fromEntries(["name", "type", "value"].filter(k => k in p).map(k => [k, p[k]]))), JSON.stringify(step.params)).toEqual(step.receipt);
    }
  });
}

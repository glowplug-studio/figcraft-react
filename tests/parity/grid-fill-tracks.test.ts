import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import native from "../fixtures/native-grid-fill-tracks.json" with { type: "json" };

for (const scene of native.cases) {
  it("grid Fill tracks as native lays them out: " + scene.name, async () => {
    const engine = new EditorEngine();
    await engine.executeAsync("file.open", { data: base64Bytes(new TextEncoder().encode(JSON.stringify(scene.document))) });
    const width = scene.document.nodes["2"].width;
    engine.execute("node.set", { id: 2, props: { width: width + 1 } });
    engine.execute("node.set", { id: 2, props: { width } });
    const doc = engine.getSnapshot().document, frame = doc.nodes["2"] as { width: number; height: number };
    expect({ width: frame.width, height: frame.height }).toEqual(scene.frame);
    expect(scene.children.map(({ id }) => {
      const node = doc.nodes[String(id)] as { x: number; y: number; width: number; height: number };
      return { id, x: node.x, y: node.y, width: node.width, height: node.height };
    })).toEqual(scene.children);
  });
}

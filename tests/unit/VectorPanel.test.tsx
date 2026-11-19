import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VectorPanel } from "../../src/VectorPanel";
import { EditorEngine } from "../../src/engine/editor";
import { selectedParentPoints, sharedPointPosition } from "../../src/engine/vector-edit";

// The Point section's X and Y with several points selected, restating native
// crates/ui-egui/src/vector_point_xy_tests.rs at bad07e44 (upstream 6ac20c7d).

function setup(x = 0, y = 0) {
  const engine = new EditorEngine();
  engine.execute("shape.rectangle", { x, y, width: 100, height: 100 }); engine.execute("vector.edit.begin", { id: 2 });
  const markup = () => renderToStaticMarkup(<VectorPanel engine={engine} editable dispatch={() => undefined} />);
  const input = (name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(markup())![0];
  const shown = () => sharedPointPosition(selectedParentPoints(engine.getSnapshot().document, engine.getVectorEdit()!));
  return { engine, input, shown };
}

describe("point position fields in vector edit mode", () => {
  it("reads Mixed for points that differ, and a typed value sets every point", () => {
    const { engine, input, shown } = setup();
    engine.execute("vector.edit.select", { vertices: [0, 1] });
    expect(shown()).toEqual({ x: undefined, y: 0 });
    expect(input("x")).toContain('placeholder="Mixed"'); expect(input("x")).toContain('value=""');
    expect(input("y")).toContain('value="0"'); expect(input("y")).not.toContain("Mixed");
    engine.execute("vector.edit.position", { x: -200 });
    expect(shown()).toEqual({ x: -200, y: 0 });
    expect(input("x"), "the points share an x now").toContain('value="-200"');
    engine.execute("vector.edit.select", { vertices: [1, 2] });
    expect(shown()).toEqual({ x: undefined, y: undefined });
    expect(input("x")).toContain('placeholder="Mixed"'); expect(input("y")).toContain('placeholder="Mixed"');
  });

  it("shows one point's own value, in the parent's coordinates", () => {
    const { engine, input, shown } = setup(40, 30);
    engine.execute("vector.edit.select", { vertices: [2] });
    expect(shown()).toEqual({ x: 140, y: 130 });
    expect(input("x")).toContain('value="140"'); expect(input("y")).toContain('value="130"');
  });

  it("shares a value within 1e-6 and shows it to two decimals", () => {
    expect(sharedPointPosition([{ x: 10.004, y: 1 }, { x: 10.0040004, y: 2 }])).toEqual({ x: 10, y: undefined });
    expect(sharedPointPosition([{ x: 10.004, y: 1 }, { x: 10.00401, y: 1 }])).toEqual({ x: undefined, y: 1 });
    expect(sharedPointPosition([])).toEqual({ x: undefined, y: undefined });
  });

  it("includes the ends of selected segments", () => {
    const { engine, shown } = setup();
    engine.execute("vector.edit.select", { vertices: [], segments: [1] });
    expect(shown()).toEqual({ x: 100, y: undefined });
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArrangePanel } from "../../src/ArrangePanel";
import { EditorEngine } from "../../src/engine/editor";

// Tidy up is offered where native `can_tidy` offers it (crates/ui-egui/src/panels/right.rs at bad07e44).
function tidyButton(rects: readonly (readonly [number, number, number, number])[], selected?: readonly string[]) {
  const engine = new EditorEngine();
  const ids = rects.map(([x, y, width, height]) => String(engine.execute("shape.rectangle", { x, y, width, height }).id));
  const html = renderToStaticMarkup(<ArrangePanel document={engine.getSnapshot().document} selection={selected ?? ids} editable dispatch={() => undefined} />);
  return /<button[^>]*value="arrange.tidy"[^>]*>/.exec(html)![0];
}
const squares = (xs: readonly number[]) => xs.map(x => [x, 0, 50, 50] as const);

describe("Tidy up in the Arrange panel", () => {
  it("is enabled for a row of three and a full grid", () => {
    expect(tidyButton(squares([0, 60, 160]))).not.toContain("disabled");
    expect(tidyButton([[0, 0, 50, 30], [80, 5, 70, 50], [190, -3, 40, 40], [2, 90, 60, 20], [85, 95, 40, 50], [200, 92, 55, 35]])).not.toContain("disabled");
  });
  it("is disabled for two layers, a diagonal, an irregular layout and a grid with an empty place", () => {
    expect(tidyButton(squares([0, 87]))).toContain("disabled");
    expect(tidyButton([[0, 0, 50, 50], [60, 70, 50, 50], [140, 150, 50, 50]])).toContain("disabled");
    expect(tidyButton([[0, 0, 200, 30], [0, 50, 90, 50], [110, 50, 90, 50]])).toContain("disabled");
    expect(tidyButton([[0, 0, 50, 50], [70, 0, 50, 50], [150, 0, 50, 50], [0, 80, 50, 50], [72, 90, 50, 50]])).toContain("disabled");
  });
});

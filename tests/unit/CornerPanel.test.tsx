import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CornerPanel } from "../../src/CornerPanel";
import { cornerFields, hasIndependentCorners, shownRadius } from "../../src/engine/corner-fields";
import type { LayerNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";

// The Design panel's corner rows, restating native crates/ui-egui/src/field_tests.rs
// (`a_boolean_group_has_one_corner_radius_field_and_a_mixed_selection_reads_mixed`,
// `a_boolean_groups_field_shows_the_radius_it_draws`) and corner_individual_tests.rs
// (`a_boolean_group_opens_corner_smoothing_and_has_no_corner_fields`) at bad07e44, upstream #2222.

function scene() {
  const engine = new EditorEngine();
  const id = (command: string, params: Record<string, unknown>) => String((engine.execute(command, params) as { id: string | number }).id);
  const a = id("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 }), b = id("shape.rectangle", { x: 50, y: 50, width: 100, height: 100 });
  const group = id("bool.union", { ids: [a, b] });
  const nodes = (...ids: string[]) => ids.map(i => engine.getSnapshot().document.nodes[i] as LayerNode);
  return { engine, id, group, nodes };
}
const markup = (engine: EditorEngine, nodes: readonly LayerNode[]) =>
  renderToStaticMarkup(<CornerPanel document={engine.getSnapshot().document} nodes={nodes} editable dispatch={() => undefined} />);
const input = (html: string, name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0];

describe("corner rows of the Design panel", () => {
  it("gives a boolean group one radius field that reads 0, then the radius set", () => {
    const { engine, group, nodes } = scene();
    expect(cornerFields(nodes(group))).toEqual({ radius: 0, independent: false, smoothing: true, radii: [0, 0, 0, 0], smoothingPercent: 0 });
    expect(input(markup(engine, nodes(group)), "cornerRadius")).toContain('value="0"');
    engine.execute("node.set", { ids: [group], props: { cornerRadius: 20 } });
    expect(cornerFields(nodes(group))!.radius).toBe(20);
    expect(input(markup(engine, nodes(group)), "cornerRadius")).toContain('value="20"');
  });

  it("reads Mixed for a group at 20 with a rectangle at 0, and one edit sets both", () => {
    const { engine, id, group, nodes } = scene();
    const rectangle = id("shape.rectangle", { x: 400, y: 0, width: 50, height: 50 });
    engine.execute("node.set", { ids: [group], props: { cornerRadius: 20 } });
    expect(cornerFields(nodes(group, rectangle))).toMatchObject({ radius: undefined, independent: false, smoothing: true });
    const field = input(markup(engine, nodes(group, rectangle)), "cornerRadius")!;
    expect(field).toContain('placeholder="Mixed"'); expect(field).toContain('value=""');
    engine.execute("node.set", { ids: [group, rectangle], props: { cornerRadius: 8 } });
    expect(nodes(group, rectangle).map(n => n.corners?.radii)).toEqual([[8, 8, 8, 8], [8, 8, 8, 8]]);
    expect(cornerFields(nodes(group, rectangle))!.radius).toBe(8);
  });

  it("shows the radius a boolean group draws, whatever its other three corners hold", () => {
    const { engine, group, nodes } = scene();
    engine.execute("node.set", { ids: [group], props: { topRightRadius: 30, bottomRightRadius: 30, bottomLeftRadius: 30 } });
    expect(nodes(group)[0].corners?.radii).toEqual([0, 30, 30, 30]);
    expect(shownRadius(nodes(group)[0])).toBe(0);
    const field = input(markup(engine, nodes(group)), "cornerRadius")!;
    expect(field).toContain('value="0"'); expect(field).not.toContain("Mixed");
  });

  it("keeps Mixed for a rectangle whose four corners differ", () => {
    const { engine, id, nodes } = scene();
    const rectangle = id("shape.rectangle", { x: 400, y: 0, width: 50, height: 50 });
    engine.execute("node.set", { ids: [rectangle], props: { topRightRadius: 12 } });
    expect(shownRadius(nodes(rectangle)[0])).toBeUndefined();
    expect(input(markup(engine, nodes(rectangle)), "cornerRadius")).toContain('placeholder="Mixed"');
    expect(cornerFields(nodes(rectangle))).toMatchObject({ independent: true, radii: [0, 12, 0, 0] });
  });

  it("opens only Corner smoothing for a boolean group, and Individual corners for a rectangle", () => {
    const { engine, id, group, nodes } = scene();
    const rectangle = id("shape.rectangle", { x: 400, y: 0, width: 50, height: 50 });
    const grouped = markup(engine, nodes(group)), plain = markup(engine, nodes(rectangle));
    expect(grouped).toContain(">Corner smoothing</button>"); expect(grouped).not.toContain("Individual corners");
    expect(plain).toContain(">Individual corners</button>");
    expect(markup(engine, nodes(group, rectangle))).toContain(">Corner smoothing</button>");
  });

  it("rounds the shown radius to two decimals before comparing layers", () => {
    const { engine, id, group, nodes } = scene();
    const rectangle = id("shape.rectangle", { x: 400, y: 0, width: 50, height: 50 });
    engine.execute("node.set", { ids: [group], props: { cornerRadius: 4.001 } });
    engine.execute("node.set", { ids: [rectangle], props: { cornerRadius: 4.004 } });
    expect(cornerFields(nodes(group, rectangle))!.radius).toBe(4);
  });

  it("shows no corner rows when a selected layer takes no radius", async () => {
    const { engine, id, group, nodes } = scene();
    const ellipse = id("shape.ellipse", { x: 0, y: 300, width: 50, height: 50 }), line = id("shape.line", { x: 0, y: 500, width: 50, height: 0 });
    const text = String(((await engine.executeAsync("text.create", { x: 0, y: 400, text: "a" })) as { id: string | number }).id);
    for (const other of [ellipse, text, line]) {
      expect(cornerFields(nodes(other)), other).toBeNull();
      expect(cornerFields(nodes(group, other))).toBeNull();
      expect(markup(engine, nodes(group, other))).toBe("");
    }
  });

  it("follows native's kinds: one radius for polygons and stars, four for frames and sections", () => {
    const { id, nodes } = scene();
    const polygon = id("shape.polygon", { x: 0, y: 300, width: 50, height: 50 }), star = id("shape.star", { x: 100, y: 300, width: 50, height: 50 });
    const frame = id("frame.create", { x: 200, y: 300, width: 50, height: 50 });
    expect(cornerFields(nodes(polygon, star))).toMatchObject({ radius: 0, independent: false, smoothing: true });
    expect(cornerFields(nodes(frame))).toMatchObject({ radius: 0, independent: true, smoothing: true });
    expect(hasIndependentCorners({ ...nodes(frame)[0], kind: "section" } as unknown as LayerNode)).toBe(true);
    expect(cornerFields(nodes(polygon, frame))).toMatchObject({ independent: false });
  });
});

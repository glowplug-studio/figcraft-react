import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-boolean-radius.json";
import { inverse, transformPoint } from "../../src/engine/affine";
import { booleanResult } from "../../src/engine/boolean-result";
import type { BooleanNode, LayerNode, VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import { vectorFillContains } from "../../src/engine/vector-path";

// A boolean group's corner radius, observed through the native engine at bad07e44 (upstream #2222;
// tests/fixtures/native-round-corners.provenance.md). Scenarios restate crates/engine/src/boolean_radius_tests.rs.

/** The drawn segments of an exported contour, each with where it starts, so two paths can be compared whatever
 * vertex they start at. Native's path normaliser and the port's begin a contour at different vertices. */
function contour(svg: string): string[] {
  const d = / d="([^"]+)"/.exec(svg)![1], out: string[] = [];
  let pen = "";
  for (const [, letter, body] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const numbers = body.trim() ? body.trim().split(/[ ,]+/) : [];
    if (letter === "M") pen = numbers.join(" ");
    else if (letter === "L" || letter === "C") { const to = numbers.slice(-2).join(" "); if (to !== pen || letter === "C") out.push(pen + " " + letter + " " + numbers.join(" ")); pen = to; }
  }
  return out;
}
function sameContour(actual: string, expected: string) {
  const a = contour(actual), b = contour(expected);
  expect(a.length).toBe(b.length);
  const shift = a.indexOf(b[0]);
  expect(shift, "the native contour's first segment appears in the port's").toBeGreaterThanOrEqual(0);
  expect([...a.slice(shift), ...a.slice(0, shift)]).toEqual(b);
}
async function replay(name: string) {
  const { commands, receipts } = fixture.cases.find(c => c.name === name)!, engine = new EditorEngine(), results: unknown[] = [];
  for (const [command, params] of commands as [string, Record<string, unknown>][]) {
    results.push(command === "file.exportSvg" ? { svg: Buffer.from(String((await engine.executeAsync(command, params)).data), "base64").toString("utf8") } : engine.execute(command, params));
  }
  return { engine, commands: commands as [string, Record<string, unknown>][], receipts: receipts as unknown[], results };
}
const layer = (engine: EditorEngine, id: string) => engine.getSnapshot().document.nodes[id] as LayerNode;
/** Whether the page point is inside the group's drawn result, as the native test's `covers`. */
function covers(engine: EditorEngine, id: string, x: number, y: number): boolean {
  const doc = engine.getSnapshot().document, result = booleanResult(doc, doc.nodes[id] as BooleanNode, 0, true)!;
  return vectorFillContains(result.network, transformPoint(inverse(worldTransform(doc, id)), { x, y }));
}

describe("a boolean group's corner radius", () => {
  it.each(fixture.cases.map(c => c.name))("gives native's receipts and rounded outline: %s", async name => {
    const { commands, receipts, results } = await replay(name);
    let rounded = false;
    commands.forEach(([command, params], i) => {
      const expected = receipts[i] as Record<string, unknown> | null, actual = results[i] as Record<string, unknown> | null;
      if (command === "node.set") rounded = "cornerRadius" in ((params.props ?? {}) as object) || "topLeftRadius" in ((params.props ?? {}) as object) || rounded;
      if (command === "edit.pasteProperties" || command === "variable.bind") rounded = true;
      if (command === "edit.undo") rounded = false;
      if (command === "file.exportSvg") {
        // Without a radius the two normalisers differ on points left along straight edges; that is not this change.
        if (rounded || name === "two circles united") sameContour(String(actual!.svg), String(expected!.svg));
      } else if (expected && Object.keys(expected).length === 1 && typeof expected.id === "number") {
        // Native returns a new layer's id as a number; the port's creation receipts return a string (final audit).
        expect(Number(actual!.id)).toBe(expected.id);
      } else expect(actual).toEqual(expected);
    });
  });
  it("cuts off convex corners and fills in concave ones, and one undo removes the radius", async () => {
    const { engine } = await replay("L group rounds every sharp corner");
    expect(covers(engine, "4", 1, 1)).toBe(true);
    engine.execute("node.set", { ids: [4], props: { cornerRadius: 20 } });
    expect([covers(engine, "4", 1, 1), covers(engine, "4", 148, 102), covers(engine, "4", 100, 50)]).toEqual([false, true, true]);
    engine.execute("edit.undo");
    expect(layer(engine, "4").corners?.radii.some(r => r > 0) ?? false).toBe(false);
    expect(covers(engine, "4", 1, 1)).toBe(true);
  });
  it("keeps a child's own radius, rounds a subtraction's cut and shrinks a radius the edges cannot hold", async () => {
    const { engine } = await replay("children keep their radius and a subtraction rounds its cut");
    // The replay ends at a group radius of 500 under the child's 10.
    expect(layer(engine, "4").corners?.radii[0]).toBe(500);
    expect(layer(engine, "2").corners?.radii).toEqual([10, 10, 10, 10]);
    expect([covers(engine, "4", 40, 4), covers(engine, "4", 27, 1), covers(engine, "4", 100, 51), covers(engine, "4", 100, 49), covers(engine, "4", 4, 4)]).toEqual([false, true, true, false, true]);
    engine.execute("node.set", { ids: [4], props: { cornerRadius: 20 } });
    expect([covers(engine, "4", 4, 4), covers(engine, "4", 48, 2), covers(engine, "4", 52, 48)]).toEqual([true, false, true]);
  });
  it("lets a nested group keep its own radius", async () => {
    const { engine } = await replay("a nested group keeps its own radius");
    expect([covers(engine, "6", 4, 4), covers(engine, "6", 48, 2), covers(engine, "6", 52, 48)]).toEqual([true, false, true]);
  });
  it("bakes the arcs on Flatten into a vector that has no radius of its own", async () => {
    const { engine } = await replay("flatten bakes the arcs");
    const flat = engine.getSnapshot().document.nodes["5"] as VectorNode;
    expect(flat.kind).toBe("vector");
    expect(flat.corners?.radii.some(r => r > 0) ?? false).toBe(false);
    expect(flat.network.vertices.every(v => !("radius" in v) || !(v as { radius?: number }).radius)).toBe(true);
    expect([flat.width, flat.height]).toEqual([250, 200]);
  });
});

// Restates crates/format/src/rest/tests.rs::vectors_ellipses_stars_and_booleans and
// crates/format/src/fig/export_tests.rs::a_boolean_groups_corner_radius_round_trips at bad07e44.
describe("a boolean group's corner radius in files", () => {
  const radiusOf = (nodes: Readonly<Record<string, unknown>>) => (Object.values(nodes) as BooleanNode[]).find(n => n.kind === "booleanOp")!.corners;
  async function lGroup() {
    const { engine } = await replay("L group rounds every sharp corner");
    engine.execute("node.set", { ids: [4], props: { cornerRadius: 20, cornerSmoothing: .6 } });
    return engine.getSnapshot().document;
  }
  const rest = (boolean: Record<string, unknown>) => {
    const base = (name: string, type: string, x = 0) => ({ id: name, name, type, relativeTransform: [[1, 0, x], [0, 1, x]], size: { x: 10, y: 10 } });
    return { document: { type: "DOCUMENT", children: [{ type: "CANVAS", children: [{ ...base("Bool", "BOOLEAN_OPERATION"), booleanOperation: "SUBTRACT", ...boolean, children: [base("A", "RECTANGLE"), base("B", "ELLIPSE", 5)] }] }] } };
  };

  it("reads the radius and smoothing from REST JSON", async () => {
    const { importRestDocument } = await import("../../src/engine/interchange/rest/document");
    const read = await importRestDocument(rest({ cornerRadius: 12, cornerSmoothing: .6 }));
    expect(read!.issues).toEqual([]);
    expect(radiusOf(read!.document.nodes)).toEqual({ radii: [12, 12, 12, 12], smoothing: .6 });
  });

  it("keeps a radius variable bound to a boolean group in REST JSON", async () => {
    const { importRestDocument } = await import("../../src/engine/interchange/rest/document");
    const alias = { type: "VARIABLE_ALIAS", id: "r" };
    const variables = { meta: { variableCollections: { c: { modes: [{ modeId: "m", name: "Day" }] } }, variables: { r: { resolvedType: "FLOAT", variableCollectionId: "c", valuesByMode: { m: 12 } } } } };
    const corners = { RECTANGLE_TOP_LEFT_CORNER_RADIUS: alias, RECTANGLE_TOP_RIGHT_CORNER_RADIUS: alias, RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: alias, RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: alias };
    const read = await importRestDocument(rest({ cornerRadius: 12, boundVariables: { rectangleCornerRadii: corners } }), undefined, undefined, variables);
    expect(read!.issues).toEqual([]);
    const group = (Object.values(read!.document.nodes) as BooleanNode[]).find(n => n.kind === "booleanOp")!;
    expect(Object.keys(group.boundVariables ?? {})).toEqual(["cornerRadius"]);
  });

  it("round-trips through a Fig file", async () => {
    const [{ writeFigDocument }, { loadDesignDocument }] = await Promise.all([import("../../src/engine/interchange/fig/write-document"), import("../../src/engine/interchange/load")]);
    const file = await writeFigDocument(await lGroup(), () => {});
    const back = (await loadDesignDocument(file.blob, undefined, () => {}, undefined, "boolean radius.fig")).decoded.document;
    const corners = radiusOf(back.nodes)!;
    for (const r of corners.radii) expect(r).toBeCloseTo(20, 4);
    expect(corners.smoothing).toBeCloseTo(.6, 4);
  });

  it("round-trips through the native file", async () => {
    const { encodeFigcraft, decodeFigcraft } = await import("../../src/engine/file-format");
    const back = await decodeFigcraft(await encodeFigcraft(await lGroup()));
    expect(radiusOf(back.document.nodes)).toEqual({ radii: [20, 20, 20, 20], smoothing: .6 });
  });
});

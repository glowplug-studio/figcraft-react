import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-vector-clipboard.json";
import { EditorEngine } from "../../src/engine/editor";

// Copy, cut and paste in vector edit mode act on the selected points and segments, observed through the native
// engine at bad07e44 (upstream 0fec344f #1875, 87ce9612, ad701088; tests/fixtures/native-vector-clipboard.provenance.md).
// The sessions restate crates/engine/src/cmd/edit/vector_clipboard_tests.rs.

type Step = [string, Record<string, unknown>];
const cases = fixture.cases as unknown as { name: string; steps: Step[]; receipts: unknown[] }[];
const compared = new Set(["node.get", "vector.edit.state", "file.exportSvg", "edit.copy", "edit.cut", "edit.paste", "vector.edit.pen"]);
/** Numbers to nine decimals, with negative zero read as zero. */
const rounded = (value: unknown): unknown => typeof value === "number" ? Math.round(value * 1e9) / 1e9 + 0
  : Array.isArray(value) ? value.map(rounded)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)])) : value;
/** The port's edit state names layers by string id, native by number: a recorded difference queued for the final audit. */
const numericIds = (state: Record<string, unknown>) => ({ ...state, id: Number(state.id), layers: (state.layers as unknown[]).map(Number),
  others: (state.others as { id: unknown }[]).map(part => ({ ...part, id: Number(part.id) })) });
type State = { network: { vertices: { x: number; y: number }[]; segments: { a: number; b: number }[]; regions: { loops: number[][]; winding: string }[] }; overlay: { selectedVertices: number[] } } & Record<string, unknown>;
/** The port's boolean result starts its loop one point on from native's: a recorded difference queued for the final
 * audit. The pasted outline is compared as the same closed run of points, whichever point it starts at. */
const booleanCase = "a boolean group joins as its outline";
function sameUpToLoopStart(actual: State, expected: State, why: string) {
  const { network: a, overlay: ao, ...restA } = actual, { network: e, overlay: eo, ...restE } = expected;
  expect(restA, why).toEqual(restE);
  expect(ao.selectedVertices, why).toEqual(eo.selectedVertices);
  expect([a.vertices.length, a.segments.length, a.regions.map(r => r.winding)], why).toEqual([e.vertices.length, e.segments.length, e.regions.map(r => r.winding)]);
  expect(a.vertices.slice(0, 2), why).toEqual(e.vertices.slice(0, 2));
  // Each loop's points in the order its segments run.
  const run = (n: State["network"]) => n.regions[0].loops[0].map(i => { const v = n.vertices[n.segments[i].a]; return `${v.x},${v.y}`; });
  const mine = run(a), theirs = run(e), start = mine.indexOf(theirs[0]);
  expect(start, `${why}: native's first point is on the loop`).toBeGreaterThanOrEqual(0);
  expect([...mine.slice(start), ...mine.slice(0, start)], why).toEqual(theirs);
}
const editState = (engine: EditorEngine) => JSON.stringify(engine.getVectorEdit() ?? null);

describe("native copy, cut and paste in vector edit mode", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const engine = new EditorEngine();
    let depth: { native: number; document: unknown } | undefined;
    for (const [i, [name, params]] of c.steps.entries()) {
      const expected = c.receipts[i], why = `${name} ${JSON.stringify(params)} (step ${i})`;
      if (name === "@selection") expect(engine.getSnapshot().selection.map(Number), why).toEqual(expected);
      else if (name === "@undoDepth") {
        // The port exposes no undo depth: an unchanged native depth must mean an unchanged document, and the reverse.
        const native = (expected as number[])[0], document = engine.getSnapshot().document;
        if (depth) expect(document === depth.document, `${why}: undo steps since the last reading`).toBe(native === depth.native);
        depth = { native, document };
      } else if (expected && typeof expected === "object" && "error" in expected) {
        const before = engine.getSnapshot().document, edit = editState(engine);
        await expect(engine.executeAsync(name, params), why).rejects.toThrow();
        expect(engine.getSnapshot().document, `${why}: a refused command changes nothing`).toBe(before);
        expect(editState(engine), `${why}: a refused command keeps the edit selection`).toBe(edit);
      } else {
        const actual = await engine.executeAsync(name, params).catch((error: unknown) => { throw new Error(`${why}: ${String(error)}`); });
        if (name === "vector.edit.state" && c.name === booleanCase) sameUpToLoopStart(rounded(numericIds(actual)) as State, rounded(expected) as State, why);
        else if (compared.has(name)) expect(rounded(name === "vector.edit.state" ? numericIds(actual) : actual), why).toEqual(rounded(expected));
      }
    }
  });
  it("names what was wrong, as native does", async () => {
    const engine = new EditorEngine(), run = (command: string, params: Record<string, unknown> = {}) => engine.executeAsync(command, params);
    await run("vector.create", { points: [[100, 100], [200, 150], [300, 100]], closed: false });
    await run("vector.edit.begin", { id: 2 });
    await expect(run("edit.paste")).rejects.toThrow(/the clipboard is empty/i);
    await run("vector.edit.tool", { tool: "pen" }); await run("vector.edit.pen", { x: 50, y: 50 }); await run("vector.edit.penEnd"); await run("vector.edit.tool", { tool: "move" });
    await run("vector.edit.select", { vertices: [3] });
    await expect(run("edit.copy")).rejects.toThrow(/the selection has nothing to copy/i);
    await expect(run("edit.cut")).rejects.toThrow(/nothing to copy \(Delete removes lone points\)/);
    await run("vector.edit.select", { segments: [0] }); await run("edit.copy");
    await expect(run("edit.paste", { x: 10 })).rejects.toThrow(/give both x and y, or neither/i);
    await run("vector.edit.end");
    const text = (await run("text.create", { text: "hello", x: 0, y: 400 })).id;
    await run("edit.copy", { ids: [text] }); await run("vector.edit.begin", { id: 2 });
    await expect(run("edit.paste")).rejects.toThrow(/none of the copied layers has an outline/i);
  });

  // vector_clipboard.rs::clip_node: the copy is a layer of its own in the clipboard, never in the document.
  it("keeps the temporary layer out of the document and its history", async () => {
    const engine = new EditorEngine();
    await engine.executeAsync("vector.create", { points: [[100, 100], [200, 150], [300, 100]], closed: false });
    await engine.executeAsync("vector.edit.begin", { id: 2 }); await engine.executeAsync("vector.edit.select", { segments: [1] });
    const before = engine.getSnapshot().document;
    await engine.executeAsync("edit.copy", {});
    expect(engine.getSnapshot().document, "Copy changes nothing").toBe(before);
    expect(Object.keys(before.nodes).filter(id => before.nodes[id].kind === "vector")).toEqual(["2"]);
    expect(engine.hasCopiedLayers()).toBe(true);
  });
});

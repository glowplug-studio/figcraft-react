import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";

const capture = readFileSync(new URL("../fixtures/native-shared-styles.json", import.meta.url));
const original = () => JSON.parse(capture.toString("utf8"));
const bytes = (text: string) => ({data: base64Bytes(new TextEncoder().encode(text))});

describe("local shared style records", () => {
  it("opens the Rust fixture, inspects seven ordered styles and recovers the saved native archive", async () => {
    const engine = new EditorEngine(), native = original();
    await engine.executeAsync("file.open", {data:base64Bytes(capture)});
    expect(engine.execute("style.list")).toEqual(native.styles);
    expect(await engine.executeAsync("style.list", {type:"text"})).toEqual(native.styles.filter((s: {type:string}) => s.type === "text"));
    for (const type of ["", "Text", false]) expect(engine.execute("style.list", {type})).toEqual([]);
    for (const id of [2, 3]) expect(engine.execute("node.get", {id, fields:["styles"], depth:0})).toMatchObject({styles:native.nodes[id].styles});
    const archive = await engine.nativeSnapshot();
    const stored = JSON.parse(strFromU8(unzipSync(archive)["document.json"]));
    expect(stored.styles).toEqual(native.styles);
    expect(stored.nodes[2].grids).toEqual(native.nodes[2].grids);
    expect(stored.nodes[4].runs).toEqual(native.nodes[4].runs);
    const recovered = new EditorEngine();
    await recovered.executeAsync("file.recover", {data:base64Bytes(archive)});
    expect(recovered.getSnapshot().document).toEqual(engine.getSnapshot().document);
  });

  it("converts linked paints, shadows, guide grids and text colours together", async () => {
    const engine = new EditorEngine(), file = original();
    const textStyle = file.styles[3].style;
    textStyle.fills = file.styles[1].paints;
    textStyle.decoration_look = { color: file.styles[1].paints[0].color };
    file.nodes[4].style = textStyle;
    file.nodes[4].runs[0].style = textStyle;
    await engine.executeAsync("file.open", bytes(JSON.stringify(file)));
    engine.execute("file.colorProfile", {profile:"displayP3",convert:false});
    expect(engine.execute("style.list", {type:"paint"})).toEqual([file.styles[1], file.styles[5]]);
    engine.execute("edit.undo");
    engine.execute("file.colorProfile", {profile:"displayP3",convert:true});
    const wire = JSON.parse(strFromU8(unzipSync(await engine.nativeSnapshot())["document.json"]));
    // Values from file.colorProfile on the pinned native fixture.
    const red = {r:0.9174875617027283, g:0.20028680562973022, b:0.13856059312820435, a:1};
    for (const color of [wire.styles[1].paints[0].color, wire.styles[2].effects[0].color,
      wire.nodes[3].fills[0].color, wire.nodes[3].strokes[0].color, wire.nodes[3].effects[0].color,
      wire.nodes[4].style.fills[0].color, wire.nodes[4].runs[0].style.decoration_look.color,
      wire.styles[3].style.decoration_look.color, wire.styles[3].style.fills[0].color]) {
      for (const [key, expected] of Object.entries(red)) expect(color[key]).toBeCloseTo(expected, 6);
    }
    expect(wire.styles[0].grids).toEqual(wire.nodes[2].grids);
    expect(wire.nodes[2].grids[0].color.r).toBeCloseTo(red.r, 6);
    expect(wire.nodes[2].grids[0].color.a).toBe(0.25);
  });

  it("preserves pattern IDs, arbitrary binding keys and orphan layer links", async () => {
    const engine = new EditorEngine(), file = original();
    file.styles[1].paints = [{type:"pattern", source:"LARGE_ID"}];
    file.styles[1].bound = JSON.parse('{"__proto__":"VariableID:7","fills/0/color":"missing"}');
    file.nodes[3].styles.fill = "missing/赤";
    await engine.executeAsync("file.open", bytes(JSON.stringify(file).replace('"LARGE_ID"', '18446744073709551615')));
    const result = engine.execute("style.list", {type:"paint"});
    expect(result[0]).toMatchObject({paints:[{type:"pattern",source:"18446744073709551615"}]});
    expect(result[0].bound).toEqual(file.styles[1].bound);
    result.splice(0);
    const wire = strFromU8(unzipSync(await engine.nativeSnapshot())["document.json"]);
    expect(wire).toContain('"source":18446744073709551615');
    expect(JSON.parse(wire).nodes[3].styles.fill).toBe("missing/赤");
    expect(engine.execute("style.list")).toHaveLength(7);
  });

  it.each([
    ["unknown style kind", {type:"lookup"}], ["missing paint stack", {type:"paint"}],
    ["invalid grid count", {type:"grid",grids:[{count:-1}]}], ["invalid grid alignment", {type:"grid",grids:[{align:"left"}]}],
    ["invalid paragraph feature", {type:"text",style:{},paragraph:{features:{liga:"yes"}}}],
    ["unknown style field", {type:"paint", paints:[], tokens:["keep"]}],
    ["invalid binding ID", {type:"effect",effects:[],bound:{radius:2}}],
  ])("refuses %s without replacing the open document", async (_reason, invalid) => {
    const engine = new EditorEngine(), file = original(), before = engine.getSnapshot().document;
    file.styles = [{id:"S:1", name:"Test", ...(invalid as object)}];
    await expect(engine.executeAsync("file.open", bytes(JSON.stringify(file)))).rejects.toThrow();
    expect(engine.getSnapshot().document).toBe(before);
  });
});

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
    for (const id of [2, 3]) expect(engine.execute("node.get", {id, fields:["styles"]})).toMatchObject({styles:native.nodes[id].styles});
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

describe("shared style folders and order", () => {
  it("duplicates below the original, preserves catalogue order on moves, renames nested folders and undoes each edit", async () => {
    const engine = new EditorEngine();
    await engine.executeAsync("file.open", {data:base64Bytes(capture)});
    engine.execute("file.markSaved");
    const originalStyles = engine.execute("style.list");
    expect(engine.execute("style.duplicate", {style:"Type/Body"})).toEqual({id:"S:8"});
    expect(engine.execute("style.duplicate", {style:"S:4"})).toEqual({id:"S:9"});
    const styles = () => engine.execute("style.list");
    expect(styles().slice(3,6).map(s => s.name)).toEqual(["Type/Body","Type/Body copy 2","Type/Body copy"]);
    const copies = styles();
    engine.execute("style.move", {styles:["S:8", "S:4", false, "S:4"], before:"S:1", folder:" Brand // Type / "});
    expect(styles().slice(0,2).map(s => [s.id,s.name])).toEqual([["S:4","Brand/Type/Body"],["S:8","Brand/Type/Body copy"]]);
    engine.execute("style.renameFolder", {folder:" /Brand",name:" Product / Mobile "});
    expect(styles()[0].name).toBe("Product/Mobile/Type/Body");
    engine.execute("style.move", {styles:["S:4"],before:"S:4",folder:" / "});
    expect(styles().at(-1)?.name).toBe("Body");
    for (let i = 0; i < 3; i++) engine.execute("edit.undo");
    expect(styles()).toEqual(copies);
    engine.execute("edit.undo"); engine.execute("edit.undo");
    expect(styles()).toEqual(originalStyles);
    expect(engine.getSnapshot().dirty).toBe(false);
    engine.execute("edit.redo");
    expect(styles()).toHaveLength(8);
  });

  it("rejects invalid batch moves atomically and allocates around style ID and name collisions", async () => {
    const engine = new EditorEngine(), file = original();
    file.styles[0].name = "S:8"; file.styles[1].id = "S:9";
    await engine.executeAsync("file.open", bytes(JSON.stringify(file)));
    const before = engine.getSnapshot().document;
    for (const p of [{styles:["S:1","missing"]}, {styles:["S:1"],before:"missing"}, {styles:[]}, {styles:[false]}, {}]) {
      expect(() => engine.execute("style.move",p)).toThrow();
      expect(engine.getSnapshot().document).toBe(before);
    }
    expect(() => engine.execute("style.renameFolder", {folder:"Type/Body", name:"Other"})).toThrow();
    expect(engine.execute("style.duplicate", {style:"S:1"})).toEqual({id:"S:10"});
  });
});

describe("native shared style authoring", () => {
  it("keeps stroke and fill links independent, honours explicit style keys and updates every linked target", async () => {
    const e = new EditorEngine();
    e.execute("node.create", {type:"rectangle", props:{fill:"red", stroke:"blue"}});
    expect(e.execute("style.create", {type:"stroke", name:"Palette / Outline"})).toEqual({id:"S:1"});
    e.execute("style.create", {type:"fill", name:"Palette/Surface"});
    e.execute("node.create", {type:"frame", props:{fillStyle:"Palette/Surface", fill:"black", strokeStyle:"S:1"}});
    expect(e.execute("node.get", {id:3, fields:["styles","fills","strokes"]})).toMatchObject({
      styles:{fill:"S:2",stroke:"S:1"}, fills:[{color:"#FF0000"}], strokes:[{color:"#0000FF"}],
    });
    e.execute("style.update", {style:"S:1", value:"green", name:"Palette/Stroke", description:"Outline"});
    expect(e.execute("node.get", {id:2,fields:["strokes"]})).toMatchObject({strokes:[{color:"#008000"}]});
    e.execute("node.set", {id:3,props:{stroke:"white"}});
    expect(e.execute("node.get", {id:3,fields:["styles"]})).toMatchObject({styles:{fill:"S:2",stroke:null}});
    e.execute("style.detach", {which:"fill",id:2});
    e.execute("style.delete", {style:"S:2"});
    expect(e.execute("node.get", {id:3,fields:["styles","fills"]})).toEqual({id:3,fills:[{type:"solid",color:"#FF0000"}]});
    e.execute("edit.undo");
    expect(e.execute("node.get", {id:3,fields:["styles"]})).toMatchObject({styles:{fill:"S:2",stroke:null}});
    const before = e.getSnapshot().document;
    expect(() => e.execute("style.apply", {style:"S:1",ids:[2,99]})).toThrow();
    expect(() => e.execute("node.set", {id:2,props:{fill:"black",gridStyle:"S:1"}})).toThrow();
    expect(e.getSnapshot().document).toBe(before);
    expect((await e.executeAsync("style.list")).map(s=>s.name)).toEqual(["Palette/Stroke","Palette/Surface"]);
  });

  it("creates a text style from selected characters and keeps unrelated characters independent", async () => {
    const e = new EditorEngine();
    await e.executeAsync("text.create", {text:"One\nTwo"});
    e.execute("text.style", {id:2, start:4, end:7, fontSize:22});
    const edit = e.beginTextEdit({id:"2"});
    edit.select(4,7);
    expect(e.execute("style.create", {type:"text",name:"Type/Accent"})).toEqual({id:"S:1"});
    expect(e.execute("style.list")[0]).toMatchObject({style:{font_size:22}});
    expect(edit.node().text.runs[0]).toMatchObject({start:4,end:7,style:{styleId:"S:1"}});
    edit.finish();
    e.execute("style.update", {style:"S:1",value:{fontSize:19,listStyle:"numbered",paragraphIndent:7}});
    expect(e.execute("node.get",{id:2,fields:["styledRuns"]})).toMatchObject({styledRuns:[
      {start:4,end:7,style:{font_size:19,style_id:"S:1"}},
    ]});
    e.execute("style.detach",{id:2,which:"text",start:5,end:6});
    e.execute("style.delete",{style:"Type/Accent"});
    const layer = e.getSnapshot().document.nodes["2"];
    if (layer.kind !== "text") throw new Error("Missing text");
    expect(layer.text.runs).toHaveLength(1);
    expect(layer.text.runs[0]).toMatchObject({start:4,end:7,style:{fontSize:19}});
    expect(layer.text.runs[0].style.styleId).toBeUndefined();
    expect(layer.text.paragraphs.map(p=>p.list)).toEqual(["none","numbered"]);
    expect(layer.text.paragraphIndent).toBe(7);
  });

  it("propagates guide grids through component instances and restores overridden references", async () => {
    const e = new EditorEngine();
    await e.executeAsync("file.open",{data:base64Bytes(readFileSync(new URL("../fixtures/native-component-instance.json",import.meta.url)))});
    e.execute("style.create",{type:"grid",name:"Columns",value:[{kind:"columns",count:3}]});
    e.execute("node.set",{id:2,props:{gridStyle:"S:1"}});
    const grid = (id:number) => e.execute("node.get",{id,fields:["grids","styles","overrides"]});
    expect(grid(4)).toMatchObject({grids:[{count:3}],styles:{grid:"S:1"}});
    e.execute("node.set",{id:4,props:{grids:[{kind:"rows",count:2}]}});
    expect(grid(4)).toMatchObject({grids:[{kind:"rows",count:2}],overrides:["grids"]});
    e.execute("style.update",{style:"S:1",value:[{kind:"columns",count:5}]});
    expect(grid(4)).toMatchObject({grids:[{kind:"rows",count:2}]});
    e.execute("component.resetOverride",{id:4,property:"grids"});
    expect(grid(4)).toMatchObject({grids:[{kind:"columns",count:5}],styles:{grid:"S:1"}});
  });
});

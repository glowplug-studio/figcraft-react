import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { rectanglePaints, type LayerNode } from "../../src/engine/document";

const base = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8");
const picture = Uint8Array.from(readFileSync(new URL("../fixtures/images/six-pixels.png", import.meta.url)));
const different = Uint8Array.from(readFileSync(new URL("../fixtures/images/six-pixels.gif", import.meta.url)));
const digest = createHash("sha256").update(picture).digest("hex");

async function open(engine: EditorEngine, resources: Record<string, Uint8Array>, source = false) {
  const root = JSON.parse(base);
  if (source) {
    const paint = {type:"image", image:"legacy"};
    root.nodes["2"].fills = [paint];
    root.nodes["2"].strokes = [paint];
    root.nodes["2"].stroke = {weight:7,align:"inside"};
  }
  const images = Object.fromEntries(Object.entries(resources).map(([key, data]) => ["images/"+key,data]));
  const data = zipSync({"document.json":new TextEncoder().encode(JSON.stringify(root)), ...images});
  await engine.openFile(new File([new Uint8Array(data)],"clipboard.figcraft"));
}
const layer = (engine: EditorEngine) => engine.getSnapshot().document.nodes["2"] as LayerNode;

it.each(["absent","identical","legacy collision","hash collision"] as const)("retains copied image bytes after a file change with %s destination data",async mode=>{
  const engine = new EditorEngine();
  await open(engine,{legacy:picture},true);
  engine.execute("fill.copy",{id:"2"});
  const resources: Record<string,Uint8Array> = {};
  if (mode !== "absent") resources.legacy = mode === "identical" ? picture : different;
  if (mode === "hash collision") { resources[digest] = different; resources[digest+"1"] = different; }
  await open(engine,resources);
  const before = engine.getSnapshot().document;
  expect(() => engine.execute("fill.paste",{id:"2",index:99})).toThrow();
  expect(engine.getSnapshot().document).toBe(before);
  engine.execute("fill.paste",{id:"2",index:0});
  const key = mode === "hash collision" ? digest+"2" : mode === "legacy collision" ? digest : "legacy";
  const doc = engine.getSnapshot().document;
  expect(rectanglePaints(layer(engine))[0]).toMatchObject({type:"image",image:key});
  expect(Buffer.from(await doc.images![key].bytes.arrayBuffer())).toEqual(Buffer.from(picture));
  if (key !== "legacy") expect(doc.images!.legacy).toBe(before.images!.legacy);
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
  engine.execute("edit.redo");
  expect(engine.getSnapshot().document).toBe(doc);
});

it("keeps missing resources missing, refuses occupied suffixes and clears the paint on loss of access",async()=>{
  const engine = new EditorEngine();
  await open(engine,{},true); engine.execute("fill.copy",{id:"2"});
  await open(engine,{}); engine.execute("fill.paste",{id:"2",index:0});
  expect(engine.getSnapshot().document.images).toBeUndefined();
  await open(engine,{legacy:picture},true); engine.execute("fill.copy",{id:"2"});
  const taken: Record<string,Uint8Array> = {legacy:different,[digest]:different};
  for (let i=1; i<=999; i++) taken[digest+i] = different;
  await open(engine,taken);
  const before = engine.getSnapshot().document;
  expect(() => engine.execute("fill.paste",{id:"2"})).toThrow(/no free image key/i);
  expect(engine.getSnapshot().document).toBe(before);
  engine.setEditable(false); engine.setEditable(true);
  expect(() => engine.execute("fill.paste",{id:"2"})).toThrow(/copied/i);
});

it("copies image strokes with their settings in one transaction and distinguishes fills from strokes",async()=>{
  const engine = new EditorEngine();
  await open(engine,{legacy:picture},true);
  engine.execute("stroke.copy",{id:"2"});
  await open(engine,{legacy:different});
  const before = engine.getSnapshot().document;
  expect(() => engine.execute("fill.paste",{id:"2",index:0})).toThrow(/stroke/i);
  engine.execute("stroke.paste",{id:"2"});
  expect(layer(engine).strokes?.[0]).toMatchObject({type:"image",image:digest});
  expect(layer(engine).stroke).toMatchObject({weight:7,align:"inside"});
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
  engine.execute("fill.copy",{id:"2"});
  expect(() => engine.execute("stroke.paste",{id:"2"})).toThrow(/fill/i);
});

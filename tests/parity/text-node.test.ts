import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { textNodeLayout, textNodePath } from "../../src/engine/text-node-layout";
import { commonProperties } from "../../src/engine/document";

// Serialised by pinned figcraft-doc Node::new, Document::insert and figcraft-text::auto_size.
const bytes = readFileSync(new URL("../fixtures/native-text.json",import.meta.url));
const characters = "Inter ქართული\nsecond line";

it("creates native text from either command, fits bundled fonts, and travels through history", async () => {
  const engine = new EditorEngine();
  const {id} = await engine.executeAsync("text.create",{text:characters.replace("\n","\r\n")});
  const node = engine.getSnapshot().document.nodes[String(id)];
  if (node.kind !== "text") throw Error("Expected a text layer");
  expect(node).toMatchObject({name:"Inter ქართული", fill:"#000000",width:90,height:30,text:{characters}});
  expect(commonProperties(node)).not.toHaveProperty("text");
  expect(textNodePath(node).length).toBeGreaterThan(30);
  expect(textNodeLayout(node).dy).toBe(0);
  const second = engine.execute("node.create",{type:"TEXT",width:20,characters:"a long line",select:false});
  expect(engine.getSnapshot().document.nodes[String(second.id)]).toMatchObject({kind:"text",width:20,text:{autoResize:"height"}});
  expect(engine.getSnapshot().selection).toEqual([id]);
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document.nodes[String(second.id)]).toBeUndefined();
  engine.execute("edit.redo");
  expect(engine.getSnapshot().document.nodes[String(second.id)]).toBeDefined();
});

it("opens a Rust text document, edits, saves and reopens its native record losslessly",async () => {
  const decoded = await decodeFigcraft(bytes);
  const node = decoded.document.nodes["2"];
  if (node.kind !== "text") throw Error("Expected a text layer");
  expect(node.text.savedBreaks?.forText).toBe("18446744073709551610");
  const original = await encodeFigcraft(decoded.document);
  expect(strFromU8(unzipSync(original)["document.json"])).toContain('"for_text":18446744073709551610');
  expect(await decodeFigcraft(original)).toEqual(decoded);
  const editor = new EditorEngine();
  await editor.executeAsync("file.open",{name:"native.figcraft",data:bytes.toString("base64")});
  expect(editor.execute("node.get",{id:2,fields:["characters","type","fontSize"]})).toEqual({id:2,type:"TEXT",characters,fontSize:24});
  const before = editor.getSnapshot().document;
  editor.execute("node.set",{id:2,props:{characters:"short\u2029word"}});
  const changed=editor.getSnapshot().document;
  expect(changed.nodes["2"]).toMatchObject({width:91,charactersOverridden:true,text:{characters:"short\nword"}});
  expect((await decodeFigcraft(await encodeFigcraft(changed))).document).toEqual(changed);
  editor.execute("edit.undo"); expect(editor.getSnapshot().document).toBe(before);
  editor.execute("edit.redo"); expect(editor.getSnapshot().document).toBe(changed);
});

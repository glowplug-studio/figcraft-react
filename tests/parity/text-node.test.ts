import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { textNodeLayout, textNodePath } from "../../src/engine/text-node-layout";
import { textWordRange } from "../../src/engine/text-edit";
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

it("previews scalar range edits without publishing React snapshots and keeps the session in one undo",async()=>{
  const engine=new EditorEngine();
  await engine.executeAsync("file.open",{name:"native.figcraft",data:bytes.toString("base64")});
  const before=engine.getSnapshot(), original=before.document.nodes["2"];
  if (original.kind!=="text") throw Error("Expected fixture text");
  const session=engine.beginTextEdit({id:"2"});
  session.replace(1,4,"🙂");
  session.replace(0,0,"X");
  expect(engine.getSnapshot()).toBe(before);
  expect(session.node().text.characters).toBe("XI🙂r ქართული\nsecond line");
  expect(session.node().text.runs[0]).toMatchObject({start:0,end:4});
  expect(session.node().name).toBe("Styled native text");
  session.finish(); expect(session.active()).toBe(false);
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before.document);
  const blank=engine.beginTextEdit({parent:"1",start:{x:20,y:20}});
  blank.replace(0,0,"  "); blank.finish();
  expect(engine.getSnapshot().document).toBe(before.document);
  engine.execute("edit.redo"); expect(engine.getSnapshot().document.nodes["2"]).toMatchObject({text:{characters:"XI🙂r ქართული\nsecond line"}});
});

it("matches native word selection at paragraph ends, combining marks, punctuation and script changes",()=>{
  const word = (s:string,i:number) => Array.from(s).slice(...textWordRange(s,i)).join("");
  expect(word("Hello world",7)).toBe("world");
  expect(word("Hello world",5)).toBe("Hello");
  expect(word("ab é!",4)).toBe("é");
  expect(word("漢字かなカナ각",3)).toBe("かな");
  expect(word("漢字かなカナ각",5)).toBe("カナ");
  expect(word("x...\ny",2)).toBe("...");
  expect(word("x...\ny",4)).toBe("");
  expect(word("x!",2)).toBe("");
});

it("uses the native readable fill and positions new text in a transformed frame",async()=>{
  const editor=new EditorEngine();
  await editor.executeAsync("text.create",{text:"prepare"});
  const {id}=editor.execute("frame.create",{x:120,y:90,width:100,height:100,props:{fill:"#757575",rotation:30}});
  const edit=editor.beginTextEdit({parent:String(id),start:{x:148.5,y:107.5}});
  expect(edit.node().fill).toBe("#ffffff");
  const {worldTransform}=await import("../../src/engine/hierarchy");
  const world=worldTransform(editor.getRenderDocument(),edit.node().id);
  for(const [i,n] of [1,0,0,1,149,101].entries()) expect(world[i]).toBeCloseTo(n,9);
  edit.cancel();
  editor.execute("node.set",{id,props:{fill:"#767676"}});
  const light=editor.beginTextEdit({parent:String(id),start:{x:0,y:0}});
  expect(light.node().fill).toBe("#000000"); light.cancel();
});

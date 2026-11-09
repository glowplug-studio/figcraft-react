import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";
import cases from "../fixtures/native-text-edit-sessions.json" with {type:"json"};

it.each(cases)("matches the pinned session results, directed selections and composing text for $text",async ({text,steps})=>{
  const engine=new EditorEngine();
  await engine.executeAsync("text.create",{text,x:10,y:20});
  for (const step of steps) {
    const action=engine.executeAsync(step.command,step.params);
    if (step.ok) await expect(action).resolves.toEqual({ok:true});
    else await expect(action).rejects.toThrow();
    expect(engine.execute("text.edit.selection")).toEqual(step.selection);
    const node=engine.getRenderDocument().nodes["2"];
    expect(node?.kind==="text" ? node.text.characters : null).toEqual(step.characters);
  }
});

it("saves a live edit without composition glyphs, preserves its session and records one undo",async ()=>{
  const e=new EditorEngine();
  await e.executeAsync("text.create",{text:"Initial",x:10,y:20});
  const depth=e.getUndoDepth();
  e.execute("text.edit.begin",{id:2});e.execute("text.edit.insert",{text:"Active"});
  e.execute("text.edit.preedit",{text:"D\u0000raft",cursor:2});
  expect(e.currentTextEdit()?.compositionPreview()?.node.text.characters).toBe("ActiveDraft");
  const saved=await e.executeAsync("file.saveAs");
  const reopened=await decodeFigcraft(Buffer.from(String(saved.data),"base64"));
  expect(reopened.document.nodes["2"]).toMatchObject({text:{characters:"Active"}});
  e.execute("file.markSaved",{revision:saved.revision});
  expect(e.execute("text.edit.selection")).toEqual({id:2,caret:6,anchor:6,text:"",preedit:{text:"Draft",cursor:2}});
  e.execute("text.edit.end");
  expect(e.getUndoDepth()).toBe(depth+1);
  expect(e.getSnapshot().dirty).toBe(false);
  e.execute("edit.undo");expect(e.getSnapshot().document.nodes["2"]).toMatchObject({text:{characters:"Initial"}});
});

it("caps composition at 1000 scalars, rejects unknown options and drops the edit on lost access",async ()=>{
  const e=new EditorEngine();
  await e.executeAsync("text.create",{text:"AB🙂C",x:10,y:20});
  for (const cmd of ["text.edit.caret","text.edit.selectWord","text.edit.selectLine"]) expect(e.execute(cmd,{index:9})).toEqual({ok:true});
  expect(()=>e.execute("text.edit.key",{key:"Left"})).toThrow();
  e.execute("text.edit.begin",{id:2,caret:2});
  e.execute("text.edit.caret",{index:1,extend:true});
  expect(e.execute("text.edit.selection")).toMatchObject({caret:1,anchor:2,text:"B"});
  expect(()=>e.execute("text.edit.insert",{typo:"x"})).toThrow();
  e.execute("text.edit.preedit",{text:"🙂".repeat(2000),cursor:3000});
  expect(e.execute("text.edit.selection")).toMatchObject({caret:1,anchor:1,preedit:{text:"🙂".repeat(1000),cursor:1000}});
  e.setEditable(false);e.setEditable(true);
  expect(e.execute("text.edit.selection")).toBeNull();
  expect(e.getSnapshot().document.nodes["2"]).toMatchObject({text:{characters:"AB🙂C"}});
});

it("restarting the same new layer supersedes deferred typing and retains empty-layer cancellation",async ()=>{
  const e=new EditorEngine();
  const depth=e.getUndoDepth();
  const first=e.beginTextEdit({start:{x:4,y:8},parent:"1"});
  const pending=e.executeAsync("text.edit.insert",{text:"old"});
  e.execute("text.edit.begin",{id:first.node().id});
  await expect(pending).rejects.toThrow("active text edit changed");
  expect(first.active()).toBe(false);
  e.execute("text.edit.end",null);
  expect(e.execute("text.edit.selection",null)).toBeNull();
  expect(e.getSnapshot().document.nodes[first.node().id]).toBeUndefined();
  expect(e.getUndoDepth()).toBe(depth);
});

import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";

it("shows only the latest hover, restores document and selection, and commits the chosen style once",async ()=>{
  const e=new EditorEngine(), id=String((await e.executeAsync("text.create",{text:"A🙂bc",x:0,y:0})).id);
  const prior=e.getSnapshot(), nested={id,fontSize:42,start:1,end:2};
  const show=(command:string,params:Record<string,unknown>)=>e.execute("text.preview",{command,params});
  expect(show("text.style",nested)).toEqual({previewing:true});
  expect(e.getRenderDocument().nodes[id]).toMatchObject({text:{runs:[{start:1,end:2,style:{fontSize:42}}]}});
  expect(e.getSnapshot()).toBe(prior);
  expect(show("node.set",{id,props:{opacity:.2}})).toEqual({previewing:true});
  expect(e.getRenderDocument().nodes[id]).toMatchObject({opacity:Math.fround(.2),text:{runs:[]}});
  expect(e.execute("text.endPreview")).toEqual({ended:true});
  expect(e.execute("text.endPreview")).toEqual({ended:false});
  expect(e.getRenderDocument()).toBe(prior.document);
  show("text.style",nested);
  expect(()=>show("text.create",{})).toThrow();expect(e.getRenderDocument()).toBe(prior.document);
  show("text.style",nested);
  expect(e.execute("node.get",{id})).toMatchObject({fontSize:12});expect(e.getRenderDocument()).toBe(prior.document);
  show("text.style",nested);
  e.execute("text.style",nested);expect(e.getSnapshot().document.nodes[id]).toMatchObject({text:{runs:[{style:{fontSize:42}}]}});
  e.execute("edit.undo");expect(e.getSnapshot().document).toBe(prior.document);
  show("text.style",nested);
  const saved=await e.executeAsync("file.saveAs",{data:true});
  expect((await decodeFigcraft(Buffer.from(String(saved.data),"base64"))).document.nodes[id]).toEqual(prior.document.nodes[id]);
});

it("preserves uncommitted text and its active selection through a range preview",async ()=>{
  const e=new EditorEngine(), id=String((await e.executeAsync("text.create",{text:"Hello",x:0,y:0})).id);
  const session=e.beginTextEdit({id});
  session.select(1,3);
  const range=e.getTextRange();
  e.execute("text.preview",{command:"text.style",params:{id,start:1,end:3,fontStyle:"Bold"}});
  expect(e.getRenderDocument().nodes[id]).toMatchObject({text:{runs:[{start:1,end:3,style:{fontStyle:"Bold"}}]}});
  expect(e.getTextRange()).toBe(range);
  e.execute("text.endPreview");
  expect(e.getTextRange()).toBe(range);
  session.finish();
});

import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { TextNode } from "../../src/engine/document";
import reference from "../fixtures/native-text-format-commands.json";

it.each(reference)("matches native formatting sequence $index",async ({commands,expected,result})=>{
  const engine=new EditorEngine();
  const {id}=await engine.executeAsync("text.create",{text:"A🙂bc\nქართული",x:0,y:0});
  let output:unknown, active:ReturnType<EditorEngine["beginTextEdit"]>|undefined, anchor=0;
  for (const {command,params} of commands) {
    try {
      if (command==="text.edit.begin") {
        active=engine.beginTextEdit({id:String(id)});
        anchor=Number("caret" in params && params.caret);
        active.select(anchor,anchor);
      } else if (command==="text.edit.caret") {
        const index=Number("index" in params && params.index);
        active!.select(Math.min(index,anchor),Math.max(index,anchor));
      } else output=engine.execute(command,{id,...params});
    } catch { output={error:true}; break; }
  }
  expect(output).toEqual(result);
  expect(engine.execute("node.get",{id})).toEqual(expected);
  active?.finish();
});

it("applies native formatting to descendant text, preserves a right edge and keeps one undo",async ()=>{
  const engine=new EditorEngine();
  const a=String((await engine.executeAsync("text.create",{text:"A",x:10,y:15})).id);
  const b=String((await engine.executeAsync("text.create",{text:"B",x:85,y:15})).id);
  engine.execute("node.set",{id:a,props:{textAlign:"right",fontStyle:"Italic"}});
  engine.execute("object.group",{ids:[a,b]});
  const base=engine.getSnapshot(), group=base.selection[0];
  const edge=engine.execute("node.get",{id:a})!.absoluteBounds as {x:number;width:number};
  engine.execute("text.bold",{id:group});
  const text=(id:string)=>engine.getSnapshot().document.nodes[id] as TextNode;
  expect([text(a).text.style.fontStyle,text(b).text.style.fontStyle]).toEqual(["Bold Italic","Bold"]);
  const after=engine.execute("node.get",{id:a})!.absoluteBounds as typeof edge;
  expect(after.x+after.width).toBe(edge.x+edge.width);
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(base.document);
  engine.execute("text.bulletList",{id:group});
  engine.execute("text.bulletList",{id:group});
  expect(text(a).text.list).toBe("bulleted");
  engine.execute("text.bulletList",{ids:[a,b]});
  expect(text(b).text.list).toBe("none");
  expect(engine.execute("text.listIndent")).toEqual({changed:false});
  const previous=engine.getSnapshot();
  expect(()=>engine.execute("text.bold",{ids:[a,999]})).toThrow();
  expect(engine.getSnapshot()).toBe(previous);
});

it("uses the whole layer for a collapsed style caret and only its paragraph for list indentation",async ()=>{
  const engine=new EditorEngine(); await engine.executeAsync("text.create",{text:"one\ntwo\nthree"});
  const before=engine.getSnapshot();
  const session=engine.beginTextEdit({id:"2"});
  session.select(4,4);
  engine.execute("text.italic");
  expect(session.node().text.style.fontStyle).toBe("Italic");
  engine.execute("text.numberList"); expect(engine.execute("text.listIndent")).toEqual({changed:true});
  expect(session.node().text.paragraphs.map(p=>[p.list,p.indent])).toEqual([["none",0],["numbered",1],["none",0]]);
  expect(session.listKey("Delete",false,4,4)).toBe(true);
  expect(session.node().text.paragraphs[1]).toMatchObject({list:"none",indent:1});
  session.finish(); engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before.document);
});

it("opens the link after a caret first, falls back to the previous character, and rejects executable schemes",async ()=>{
  const engine=new EditorEngine(); await engine.executeAsync("text.create",{text:"one"});
  const link=(start:number,end:number,url:string)=>engine.execute("text.style",{id:2,start,end,hyperlink:url});
  link(0,1,"mailto:a@example.test"); link(1,2,"https://example.test");
  expect(()=>engine.execute("text.openLink")).toThrow();
  const edit=engine.beginTextEdit({id:"2"});
  edit.select(0,0); expect(engine.execute("text.openLink")).toEqual({url:"mailto:a@example.test"});
  edit.select(1,2); expect(engine.execute("text.openLink")).toEqual({url:"https://example.test"});
  edit.select(2,2); expect(engine.execute("text.openLink")).toEqual({url:"https://example.test"});
  edit.select(3,3); expect(engine.execute("text.openLink")).toEqual({url:null});
  edit.select(1,2); engine.execute("text.link",{url:"javascript:alert(1)"});
  expect(()=>engine.execute("text.openLink")).toThrow("Only web and mail links");
  edit.cancel();
});

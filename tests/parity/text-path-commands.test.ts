import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft,encodeFigcraft } from "../../src/engine/file-format";
import { resizeStart, previewResize } from "../../src/engine/transform-preview";
import { parseSvgPath } from "../../src/engine/svg-path";
import cases from "../fixtures/native-text-path-commands.json";

it.each(cases)("follows native path placement, effects and geometry for case $index",async entry=>{
  const engine=new EditorEngine(), {id}=await engine.executeAsync("text.create",{text:"A🙂bc\nქართული",x:0,y:0});
  for (const {command,params} of entry.commands) engine.execute(command,params);
  const result=engine.execute("node.get",{id}), expected=entry.node;
  expect(result).not.toBeNull();
  const {textPath,...actual}=result as Record<string,unknown>, {textPath:native,...rest}=expected as Record<string,unknown>;
  expect(actual).toEqual(rest);
  if (native) {
    const path=native as {d:string;start:number;flip?:boolean};
    expect(textPath).toMatchObject({start:path.start,...(path.flip && {flip:true})});
    const a=parseSvgPath((textPath as typeof path).d,true), b=parseSvgPath(path.d,true);
    expect(a.map(c=>c[0])).toEqual(b.map(c=>c[0]));
    for (let i=0;i<b.length;i++) for (let j=1;j<b[i].length;j++) expect(a[i][j]).toBeCloseTo(Number(b[i][j]),9);
  } else expect(textPath).toBeUndefined();
  const doc=engine.getSnapshot().document;
  expect((await decodeFigcraft(await encodeFigcraft(doc))).document.nodes["2"]).toEqual(doc.nodes["2"]);
});

it("refuses an ancestor path atomically, and restores the source's position and paint with undo",async ()=>{
  const engine=new EditorEngine();
  const parent=String(engine.execute("frame.create",{x:30,y:40,width:400,height:300}).id);
  const text=String((await engine.executeAsync("text.create",{parent,text:"Route",x:50,y:70})).id);
  const source=String(engine.execute("vector.create",{parent,path:"M0 0C20 10 40 30 80 50",x:98,y:76,props:{rotation:23,fill:"#cc0044"}}).id);
  const before=engine.getSnapshot();
  expect(()=>engine.execute("text.onPath",{text,path:parent})).toThrow();
  expect(engine.getSnapshot()).toBe(before);
  engine.execute("text.onPath",{text,path:source}); expect(engine.getSnapshot().selection).toEqual([text]);
  expect(engine.getSnapshot().document.nodes[source]).toBeUndefined();
  const attached=engine.execute("node.get",{id:text});
  expect(attached).toMatchObject({rotation:23,fills:[{color:"#CC0044",type:"solid"}]});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before.document);
});

it("refits a side-dragged text box and fixes both dimensions on a corner drag",async ()=>{
  const engine=new EditorEngine(), id=String((await engine.executeAsync("text.create",{text:"One two three four",x:0,y:0})).id);
  const doc=engine.getSnapshot().document;
  const drag=(kind:"edge"|"corner",index:number,x:number,y:number)=>{
    const start=resizeStart(doc,[id],{kind,index})!;
    return previewResize(doc,start,{x,y},false,false,false).document.nodes[id];
  };
  const side=drag("edge",1,24,0);
  expect(side).toMatchObject({width:24,text:{autoResize:"height"},textSizing:{horizontal:"fixed",vertical:"hug"}});
  if (side.kind!=="text") throw new Error("Expected a resized text layer");
  expect(side.height).toBeGreaterThan(30);
  expect(drag("corner",2,24,40)).toMatchObject({width:24,height:40,text:{autoResize:"none"}});
});

import { expect, it } from "vitest";
import { missingFonts } from "../../src/engine/text-refit";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import type { TextNode } from "../../src/engine/document";

it("refits stale boxes from a native file by subtree or document and preserves right alignment and undo",async ()=>{
  const engine=new EditorEngine();
  const frame=engine.execute("frame.create",{x:10,y:20,width:350,height:200}).id;
  const a=String((await engine.executeAsync("text.create",{parent:frame,text:"Inside",x:10,y:20})).id);
  const b=String((await engine.executeAsync("text.create",{text:"Outside",x:240,y:140})).id);
  const fixed=String((await engine.executeAsync("text.create",{text:"Fixed",x:30,y:90})).id);
  engine.execute("node.set",{id:a,props:{textAlign:"right"}});
  engine.execute("node.set",{id:fixed,props:{textAutoResize:"none"}});
  const doc=engine.getSnapshot().document, nodes={...doc.nodes};
  for (const id of [a,b,fixed]) {
    const node=nodes[id] as TextNode;
    nodes[id]={...node,width:node.width+32};
  }
  const data=Buffer.from(await encodeFigcraft({...doc,nodes})).toString("base64");
  await engine.executeAsync("file.open",{name:"Stale.figcraft",data});
  const before=engine.getSnapshot(), previous=engine.execute("node.get",{id:a})!;
  for (const ids of ["2",[],[{}],[frame,"999999"]]) {
    expect(()=>engine.execute("text.refit",{ids})).toThrow();
    expect(engine.getSnapshot()).toBe(before);
  }
  expect(engine.execute("text.refit",{ids:[frame,a]})).toEqual({refitted:[Number(a)]});
  expect(engine.execute("node.get",{id:a})).toMatchObject({width:(doc.nodes[a] as TextNode).width,x:Number(previous.x)+32});
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before.document);
  expect(engine.execute("text.refit",{ids:null})).toEqual({refitted:[Number(a),Number(b)]});
  const fitted=engine.getSnapshot();
  expect(engine.execute("text.refit",{ids:[1]})).toEqual({refitted:[]});
  expect(engine.getSnapshot()).toBe(fitted);
  expect((fitted.document.nodes[fixed] as TextNode).width).toBe((nodes[fixed] as TextNode).width);
});

it("counts distinct missing families per layer, respects loaded aliases and closes the dialog without an edit",async ()=>{
  const e=new EditorEngine();
  const a=(await e.executeAsync("text.create",{text:"ABC",x:0,y:0})).id;
  const b=(await e.executeAsync("text.create",{text:"DEF",x:10,y:10})).id;
  e.execute("node.set",{id:a,props:{fontFamily:"Absent"}});
  e.execute("node.set",{id:b,props:{fontFamily:"absent"}});
  e.execute("text.style",{id:a,start:0,end:1,fontFamily:"Other"});
  const before=e.getSnapshot().document;
  const expected=[{family:"Absent",layers:2,source:null},{family:"Other",layers:1,source:null}];
  expect(e.execute("text.missingFonts")).toEqual({families:expected});
  expect(e.getSnapshot().missingFonts).toEqual(expected);
  e.closeMissingFonts();
  expect(e.getSnapshot().missingFonts).toBeUndefined();
  expect(e.getSnapshot().document).toBe(before);
  for (const family of ["Inter Bold","NotoSansGeorgian"]) e.execute("node.set",{ids:[a,b],props:{fontFamily:family}});
  expect(e.execute("text.missingFonts")).toEqual({families:[]});
});

it("retains the first native spelling when a file stores high u64 ids out of order",async ()=>{
  const e=new EditorEngine();
  const id=String((await e.executeAsync("text.create",{text:"A",x:0,y:0})).id);
  const doc=e.getSnapshot().document, text=doc.nodes[id] as TextNode;
  const node=(id:string,fontFamily:string)=>({...text,id,text:{...text.text,style:{...text.text.style,fontFamily}}});
  const high="18446744073709551610", low="9007199254740993";
  expect(missingFonts({...doc,nodes:{...doc.nodes,[high]:node(high,"MISSING"),[low]:node(low,"Missing")}}))
    .toEqual([{family:"Missing",source:null,layers:2}]);
});

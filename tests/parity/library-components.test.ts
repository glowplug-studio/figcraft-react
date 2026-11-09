import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";
import {base64Bytes} from "../../src/engine/recovery";

const bytes=(file:string)=>readFileSync(new URL("../fixtures/"+file+".figcraft",import.meta.url));
const edition=(v:number)=>new File([bytes("native-component-library-v"+v)],"Kit"+v+".figcraft");

it("opens a native hidden library store and keeps the child's source and image resource on save",async()=>{
  const engine=new EditorEngine(),data=bytes("native-library-component-consumer");
  const native=await decodeFigcraft(data);
  expect(await engine.executeAsync("file.open",{name:"Untitled.figcraft",data:base64Bytes(data)})).toMatchObject({summary:{pages:1,layers:2,images:1}});
  expect(engine.execute("page.list")).toHaveLength(1);
  expect(engine.execute("component.list")).toMatchObject([{id:3,page:null,library:"e36d4acf0f4beca8",instances:1}]);
  expect(engine.execute("library.list",{assets:true}).publishable).toMatchObject({components:[]});
  const before=engine.getSnapshot().document;
  for (const [cmd,p] of [
    ["node.set",{id:3,props:{opacity:0.4}}],["select.set",{ids:[3]}],["page.select",{id:2}],
    ["edit.delete",{ids:[3]}],["node.reparent",{id:3,parent:1}]
  ] as const) expect(()=>engine.execute(cmd,p)).toThrow();
  expect(engine.getSnapshot().document).toBe(before);
  const saved=await decodeFigcraft(await engine.nativeSnapshot());
  expect(saved.document).toEqual({...native.document,name:saved.document.name});
  engine.execute("component.detach",{id:4});engine.execute("library.remove",{id:"Untitled"});
  const store=engine.getSnapshot().document.libraryStore!;
  expect(store.components).toEqual([]);expect(store.detached).toEqual([{library:"e36d4acf0f4beca8",key:"5",count:1}]);
  expect(engine.getSnapshot().document.nodes["3"]).toBeUndefined();
});

it("keeps nested linked copies, overrides and source IDs through native value and structure updates",async()=>{
  const e=new EditorEngine(),{id:library}=await e.pickLibrary(edition(1));
  const place=(component:string,x:number)=>e.execute("library.place",{library,component,x,y:50});
  expect(place("Button",100)).toEqual({component:3,id:5,parent:1});
  expect(place("Card",420)).toEqual({component:7,id:10,parent:1});
  expect(e.execute("library.import",{library,component:"Card"})).toEqual({component:7});
  await e.executeAsync("text.set",{id:6,characters:"Buy"});
  await e.pickLibrary(edition(2));
  expect(e.execute("library.updates")).toMatchObject({count:3,libraries:[{components:[{id:3,key:2},{id:7,key:4}]}]});
  expect(e.execute("library.acceptUpdates")).toMatchObject({styles:1,components:2});
  await e.pickLibrary(edition(3));
  const before=e.getSnapshot().document;
  e.execute("library.acceptUpdates");e.execute("edit.undo");expect(e.getSnapshot().document).toBe(before);e.execute("edit.redo");
  e.execute("library.remove",{id:library});
  const native=await decodeFigcraft(bytes("native-component-library-updated"));
  const saved=await decodeFigcraft(await e.nativeSnapshot());
  expect(saved.document).toEqual(native.document);
  expect(saved.document.nodes["6"]).toMatchObject({kind:"text",text:{characters:"Buy"}});
});
it("reuses dependency copies and rolls back failed placement and swap atomically",async()=>{
  const e=new EditorEngine(),{id:library}=await e.pickLibrary(edition(1));
  const before=e.getSnapshot().document,depth=e.getUndoDepth();
  expect(()=>e.execute("library.place",{library,component:"_Draft",x:10,y:10})).toThrow("publishes no component");
  expect(()=>e.execute("library.swapAt",{library,component:"Card",x:10,y:10})).toThrow();
  expect(e.getSnapshot().document).toBe(before);expect(e.getUndoDepth()).toBe(depth);
  const result=e.execute("library.place",{library,component:"Card",x:100,y:100}),doc=e.getSnapshot().document;
  const button=doc.libraryStore!.components.find(r=>r.key==="2")!;
  const id=e.execute("library.import",{library,component:"Button"});
  expect(id.component).toBe(Number(button.root));
  expect(e.getSnapshot().document).toBe(doc);
  const swapped=e.execute("library.swapAt",{library,component:2,x:100,y:100});
  expect(swapped.component).toBe(Number(button.root));
  e.execute("edit.duplicate",{ids:[result.id]});
  expect(e.getSnapshot().document.libraryStore?.inserted).toMatchObject([{key:"4",count:1},{key:"2",count:1}]);
});

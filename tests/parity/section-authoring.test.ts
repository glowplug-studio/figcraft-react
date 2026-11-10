import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft} from "../../src/engine/file-format";

const files=unzipSync(readFileSync(new URL("../fixtures/native-section-authoring.zip",import.meta.url)));
interface Sequence {
  commands:[string,Record<string,unknown>][];
  receipts:Record<string,unknown>[];
}
it.each(Object.keys(files).filter(key=>key.endsWith(".json")).map(key=>key.slice(0,-5)))("matches native Section authoring for %s",async name=>{
  const {commands,receipts}:Sequence=JSON.parse(strFromU8(files[name+".json"]));
  const engine=new EditorEngine();
  for (const [index,[command,params]] of commands.entries()) {
    const receipt=receipts[index];
    const before=engine.getSnapshot();
    if (typeof receipt.error==="string") {
      expect(()=>engine.execute(command,params)).toThrow();
      expect(engine.getSnapshot()).toBe(before);
    } else {
      const result=engine.execute(command,params);
      if (command==="node.get" || ["section.toggleContents","object.wrapInSection","object.convertToSection"].includes(command)) expect(result).toEqual(receipt);
    }
  }
  const expected=await decodeFigcraft(files[name+".figcraft"]);
  const actual=await decodeFigcraft((await engine.saveFile()).data);
  expect(actual.document).toEqual(expected.document);
  if (name==="hide selected child") expect(engine.getSnapshot().selection).toEqual(["2"]);
  if (name==="undo selected child") expect(engine.getSnapshot().selection).toEqual(["3"]);
  if (name==="nested promotion order") expect(engine.getSnapshot().selection).toEqual(["3"]);
  if (name==="promote from mixed selection") expect(engine.getSnapshot().selection).toEqual(["2","4"]);
});

it("a clicked Section encloses eligible siblings with one undo and preserves their page position",async()=>{
  const {DrawInteraction}=await import("../../src/engine/draw-interaction");
  const {worldTransform}=await import("../../src/engine/hierarchy");
  const engine=new EditorEngine(), draw=new DrawInteraction(engine,message=>{throw new Error(message);});
  const create=(x:number,y:number,width:number,height:number,props={})=>
    String(engine.execute("shape.rectangle",{x,y,width,height,props}).id);
  const inside=create(50,55,25,25),edge=create(400,40,10,10),locked=create(70,70,9,10,{locked:true}),hidden=create(80,55,10,10,{visible:false});
  const before=engine.getSnapshot().document, matrix=worldTransform(before,inside);
  engine.execute("tool.section");draw.down({x:10,y:20});draw.up({x:10,y:20});
  const {document,selection}=engine.getSnapshot(),section=selection[0];
  expect(document.nodes[section]).toMatchObject({kind:"section",width:400,height:300,children:[inside]});
  expect(worldTransform(document,inside)).toEqual(matrix);
  for (const id of [edge,locked,hidden]) expect(document.nodes[id].parent).toBe(document.currentPage);
  engine.execute("edit.undo");expect(engine.getSnapshot().document).toBe(before);
});

it("Sections nest in the Section under the pointer and return to the page when a frame is under it",async()=>{
  const {DrawInteraction}=await import("../../src/engine/draw-interaction");
  const {targetForLeaf}=await import("../../src/engine/selection");
  const engine=new EditorEngine(),draw=new DrawInteraction(engine,message=>{throw new Error(message);});
  const outer=String(engine.execute("node.create",{type:"section",width:1200,height:850}).id);
  const child=String(engine.execute("frame.create",{x:100,y:100,width:240,height:180,parent:outer}).id);
  const rect=String(engine.execute("shape.rectangle",{parent:child,x:20,y:20,width:10,height:10}).id);
  expect(targetForLeaf(engine.getSnapshot().document,rect,[])).toBe(rect);
  for (const [point,parent] of [[{x:410,y:10},outer],[{x:130,y:130},"1"]] as const) {
    engine.execute("tool.section");draw.down(point);draw.up(point);
    const {document,selection}=engine.getSnapshot();
    expect(document.nodes[selection[0]].parent).toBe(parent);
  }
});

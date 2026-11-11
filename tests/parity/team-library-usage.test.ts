import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {decodeFigcraft} from "../../src/engine/file-format";
import {EditorWorkspace} from "../../src/engine/workspace";
import {EditorEngine} from "../../src/engine/editor";
import {libraryUsageReport,readLibraryUsageReport,summariseLibraryUsage} from "../../src/engine/sharing/library-usage";

it("counts nested placed instances outside the native library store and keeps lifetime actions after detachment",async()=>{
  const engine=new EditorEngine();
  const bytes=readFileSync(new URL("../fixtures/native-component-library-v1.figcraft",import.meta.url));
  const {id}=await engine.pickLibrary(new File([bytes],"Kit.figcraft"));
  const placed=engine.execute("library.place",{library:id,component:"Card",x:100,y:100});
  const report=()=>libraryUsageReport(engine.getSnapshot().document,String(id));
  expect(report()).toMatchObject({components:[["2",1],["4",1]],inserted:[["4",1]]});
  engine.execute("component.detach",{id:placed.id});
  expect(report()).toMatchObject({components:[["2",1]],inserted:[["4",1]],detached:[["4",1]]});
  expect(libraryUsageReport(engine.getSnapshot().document,"foreign")).toMatchObject({components:[]});
});

it("retains native positive minima, u64 keys, scalar name limit and byte-bounded asset IDs",()=>{
  const report={file:"  Kit\u202e ",components:[["10",0],["18446744073709551615",1],["9",7],["9",2]],
    styles:[["🙂".repeat(17),3],["🙂".repeat(16),2],["x",1]]};
  expect(readLibraryUsageReport(report)).toEqual({file:"Kit",components:[["9",2],["18446744073709551615",1]],
    styles:[["x",1],["🙂".repeat(16),2]]});
  expect(()=>readLibraryUsageReport({...report,components:[["18446744073709551616",1]]})).toThrow();
  const many=Array.from({length:4000},(_,i)=>[String(5000-i),1]);
  expect(readLibraryUsageReport({...report,components:[...many,["0",1]]}).components).toEqual(
    Array.from({length:1000},(_,i)=>[String(1001+i),1]));
});

it("aggregates current counts separately from overlapping-week actions, including removed components",()=>{
  const base={updated:1,components:[["3",2]] as const,detached:[],styles:[["S:1",2]] as const,variables:[]};
  const rows=summariseLibraryUsage({files:[{...base,file:"First"},{...base,file:"Second",detached:[["8",2]]}],
    weeks:[{week:12,component:"8",insertions:1,detachments:2},{week:5,component:"5",insertions:4,detachments:0}]});
  expect(rows).toMatchObject({instances:4,detached:2,insertions:5,detachments:2,
    components:[{id:"3",instances:4,files:2},{id:"8",detached:2},{id:"5",insertions:4}],
    styles:[{id:"S:1",files:2,layers:4}],weeks:[{week:5},{week:12}]});
});

it("keeps native remote main components on their server after replacing the link with a private device reference",async()=>{
  const workspace=new EditorWorkspace(),engine=workspace.activeEngine!;
  const members=unzipSync(readFileSync(new URL("../fixtures/native-library-component-consumer.figcraft",import.meta.url)));
  const native=JSON.parse(strFromU8(members["document.json"]));
  native.libraries.enabled[0].path="figcraft://join?host=localhost:47900&file=kit&token=fixture-token-1234567890";
  members["document.json"]=strToU8(JSON.stringify(native));
  await engine.openFile(new File([new Uint8Array(zipSync(members))],"Consumer.figcraft"));
  expect(engine.getSnapshot().document.libraryLinks![0].path).toMatch(/^team-library:/);
  await expect(workspace.goToMain({id:"4"})).rejects.toThrow("Open the team library file from the server");
});

it("counts style and variable links once per layer and preserves native style keys after a library is removed",async()=>{
  const {document}=await decodeFigcraft(readFileSync(new URL("../fixtures/native-linked-style-consumer.figcraft",import.meta.url)));
  const library=document.libraryRecords!.styles![0].library;
  const frame=document.nodes["2"];
  const linked={...document,nodes:{...document.nodes,"2":{...frame,boundVariables:{width:"local",height:"local"}}},
    libraryRecords:{...document.libraryRecords!,variables:[{library,key:"V:7",local:"local",version:"1"}]}};
  expect(libraryUsageReport(linked,library)).toMatchObject({components:[],
    styles:[["S:1",1],["S:2",1],["S:3",1],["S:4",1],["S:5",1]],variables:[["V:7",1]]});
});

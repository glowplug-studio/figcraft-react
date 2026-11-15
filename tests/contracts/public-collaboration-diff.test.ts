import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {EditorEngine,commandSpecs} from "../../src/engine/editor";
import {base64Bytes} from "../../src/engine/recovery";

interface Receipt {changes:unknown[];count:number;bytes:number}
interface Stage {stage:string;command:string;params:Record<string,unknown>;result:{receipt?:unknown;error?:string}}
const native=JSON.parse(readFileSync(new URL("../fixtures/native-public-diff-engine.json",import.meta.url),"utf8")) as {nativeRevision:string;stages:Stage[]};
const empty:Receipt={changes:[],count:0,bytes:2};
const stage=(name:string)=>native.stages.find(row=>row.stage===name)!;
const receipt=(name:string)=>stage(name).result.receipt as Receipt;
const diff=(engine:EditorEngine,against="saved")=>engine.executeAsync("collab.diff",{against});
function rectangle(engine=new EditorEngine("Oracle 🙂")) {
  engine.execute("shape.rectangle",{x:0,y:0,width:10,height:10});return engine;
}

it("matches all 22 real native public-dispatch stages, including scalar coercion and Debug escaping",async()=>{
  const engine=new EditorEngine("Oracle 🙂");
  expect(native.nativeRevision).toBe("bad07e4433240cad046589129c084bd2fc36f097");
  expect(native.stages).toHaveLength(22);
  for(const row of native.stages) {
    if(row.command!=="collab.diff"){engine.execute(row.command,row.params);continue;}
    const before=engine.getSnapshot(),depth=engine.getUndoDepth();
    if(row.result.error)await expect(engine.executeAsync(row.command,row.params),row.stage).rejects.toThrow(new Error(row.result.error));
    else expect(await engine.executeAsync(row.command,row.params),row.stage).toEqual(row.result.receipt);
    expect(engine.getSnapshot(),row.stage).toBe(before);
    expect(engine.getUndoDepth(),row.stage).toBe(depth);
  }
});

it("registers a read-only command, requires async dispatch and leaves selection/history unchanged",async()=>{
  const spec=(commandSpecs as Record<string,{label:string;undo:boolean}>)["collab.diff"];
  expect(spec).toMatchObject({label:"Show sync changes",undo:false});
  const engine=rectangle(),before=engine.getSnapshot(),depth=engine.getUndoDepth();
  expect(()=>engine.execute("collab.diff")).toThrow(/requires executeAsync/);
  engine.setEditable(false);
  const readonly=engine.getSnapshot();
  expect(await engine.executeAsync("collab.diff")).toEqual(receipt("default-undo"));
  expect(await diff(engine)).toEqual(receipt("edited-saved"));
  expect(engine.getSnapshot()).toBe(readonly);
  expect(engine.getSnapshot().selection).toEqual(before.selection);
  expect(engine.getUndoDepth()).toBe(depth);
});

it("starts constructor and new-tab comparisons at their own content without changing browser save UX",async()=>{
  const fresh=new EditorEngine("Oracle 🙂"),tab=EditorEngine.newTab("Oracle 🙂");
  const before=[fresh.getSnapshot(),tab.getSnapshot()];
  expect(await diff(fresh)).toEqual(empty);expect(await diff(tab)).toEqual(empty);
  expect(fresh.getSnapshot()).toBe(before[0]);expect(tab.getSnapshot()).toBe(before[1]);
  expect(fresh.getSnapshot()).toMatchObject({dirty:true,hasSaved:false});
  expect(tab.getSnapshot()).toMatchObject({dirty:false,hasSaved:false});
});

it("uses settled normal opens as comparison baselines while recovery compares against a fresh named document",async()=>{
  const archive=(await rectangle().saveFile()).data;
  const data=base64Bytes(new Uint8Array(await archive.arrayBuffer()));
  const opened=new EditorEngine(),tab=new EditorEngine(),recovered=new EditorEngine();
  await opened.executeAsync("file.open",{name:"Oracle.figcraft",data});
  await tab.openTabFile(new File([archive],"Oracle.figcraft"));
  await recovered.recoverFile(archive);
  expect(await diff(opened)).toEqual(empty);expect(await diff(tab)).toEqual(empty);
  expect(await diff(recovered)).toEqual(receipt("edited-saved"));
  expect(opened.getSnapshot()).toMatchObject({dirty:true,hasSaved:false});
  expect(tab.getSnapshot()).toMatchObject({dirty:false,hasSaved:false});
  expect(recovered.getSnapshot()).toMatchObject({dirty:true,hasSaved:false});
  await expect(opened.executeAsync("file.open",{data:"invalid"})).rejects.toThrow();
  expect(await diff(opened)).toEqual(empty);
});

it("compares ordinary copies and branch heads with themselves but offline copies with their unrenamed source",async()=>{
  const source=rectangle();
  const duplicate=source.duplicateTab(),offline=source.offlineCopy();
  expect(await diff(duplicate)).toEqual(empty);
  expect(await diff(offline)).toMatchObject({count:1,changes:[{setDoc:{prop:"name",value:"Oracle 🙂 (offline copy)"}}]});
  expect(offline.getSnapshot().dirty).toBe(true);
  const head={document:source.getSnapshot().document,nextId:"3"};
  const branch=source.openBranch({id:"branch",name:"Review",time:"1",client:3,state:"active",base:head,head,versions:[]});
  expect(await diff(branch)).toEqual(empty);
});

it("advances the comparison baseline only to an acknowledged saved revision, preserving edits made afterwards",async()=>{
  const engine=rectangle(),saved=await engine.saveFile();
  expect(await diff(engine)).toEqual(receipt("edited-saved"));
  engine.execute("file.rename",{name:"Renamed é🙂"});
  expect(engine.execute("file.markSaved",{revision:saved.revision})).toEqual({saved:true});
  expect(await diff(engine)).toEqual(receipt("rename-saved-diff"));
  expect(engine.getSnapshot()).toMatchObject({dirty:true,hasSaved:true});
  expect(engine.execute("file.markSaved",{revision:saved.revision})).toEqual({saved:false});
  expect(await diff(engine)).toEqual(receipt("rename-saved-diff"));
  engine.execute("edit.undo");expect(await diff(engine)).toEqual(empty);
  engine.execute("edit.redo");expect(await diff(engine)).toEqual(receipt("rename-saved-diff"));
  engine.execute("file.markSaved");expect(await diff(engine)).toEqual(empty);
});

it("does not advance comparison baselines when a save acknowledgement was invalidated by opening another document",async()=>{
  const engine=rectangle(),saved=await engine.saveFile();
  const other=new EditorEngine("Other"),archive=(await other.saveFile()).data;
  await engine.openFile(new File([archive],"Other.figcraft"));
  engine.execute("shape.rectangle",{x:0,y:0,width:10,height:10});
  expect(engine.execute("file.markSaved",{revision:saved.revision})).toEqual({saved:false});
  expect(await diff(engine)).toEqual(receipt("edited-saved"));
});

it("compares the shown version without closing its preview and initialises duplicate versions independently",async()=>{
  const engine=new EditorEngine("Oracle 🙂");
  engine.execute("file.saveVersion",{name:"Before"});
  rectangle(engine);engine.execute("file.markSaved");
  const copy=await engine.duplicateVersion({index:0});expect(await diff(copy)).toEqual(empty);
  await engine.executeAsync("version.preview",{index:0});
  const before=engine.getSnapshot(),depth=engine.getUndoDepth();
  expect(await diff(engine)).toEqual({changes:[{delete:{id:2}}],count:1,bytes:4});
  expect(engine.getSnapshot()).toBe(before);expect(engine.getUndoDepth()).toBe(depth);
  expect(before.previewVersionId).toBeDefined();expect(before.editable).toBe(false);
});

it("rejects live undo even when available, permits saved comparison and ignores local followed page preference",async()=>{
  const engine=rectangle();engine.execute("page.add",{name:"Other"});engine.execute("file.markSaved");
  engine.setLiveHistory({canUndo:true,canRedo:false,travel:()=>true});
  engine.setEditable(false);
  await expect(engine.executeAsync("collab.diff")).rejects.toThrow('command `collab.diff` is not available right now: in a live session undo is per user: compare against "saved"');
  expect(await diff(engine)).toEqual(empty);
  const sharedPage=engine.liveDrawing().currentPage;
  engine.followViewport(["1",0,0,100,100]);
  expect(engine.getSnapshot().document.currentPage).toBe("1");
  expect(engine.liveDrawing().currentPage).toBe(sharedPage);
  expect(await diff(engine)).toEqual(empty);
  const drawing=engine.liveDrawing();
  engine.receiveLiveDocument({...drawing,name:"Renamed é🙂"});
  expect(await diff(engine)).toEqual(receipt("rename-saved-diff"));
});

it("captures immutable comparison documents before asynchronous image reads",async()=>{
  const engine=new EditorEngine("Oracle 🙂");
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  class DelayedBlob extends Blob {override async arrayBuffer(){await gate;return super.arrayBuffer();}}
  engine.receiveLiveDocument({...engine.getSnapshot().document,images:{image:{width:1,height:1,bytes:new DelayedBlob([Uint8Array.of(1,2,3)])}}});
  const running=diff(engine);
  engine.execute("file.rename",{name:"Later name"});release();
  const result=await running;
  expect(result.count).toBe(1);
  expect(result.changes).toEqual([{put:{entry:{image:"image"},value:{bytes:"AQID",height:1,width:1}}}]);
  expect(engine.getSnapshot().document.name).toBe("Later name");
});

it("matches native registry global keys, scalar ordering and plural errors, and defaults non-object payloads",async()=>{
  // Native cmd.rs::refuse_unknown_params accepts id/ids globally and inspects only objects.
  const engine=rectangle();
  expect(await engine.executeAsync("collab.diff",{id:"ignored",ids:["missing"],against:"undo"})).toEqual(receipt("default-undo"));
  for(const input of [undefined,null,[],["saved"],"saved",1,true])
    expect(await engine.executeAsync("collab.diff",input)).toEqual(receipt("default-undo"));
  await expect(engine.executeAsync("collab.diff",{z:1,a:1,against:"saved"})).rejects.toThrow(new Error('invalid parameters for `collab.diff`: unknown parameters `a`, `z` (it takes against)'));
  await expect(engine.executeAsync("collab.diff",{"𐐷":1,"\ue000":1,z:1})).rejects.toThrow(new Error('invalid parameters for `collab.diff`: unknown parameters `z`, `\ue000`, `𐐷` (it takes against)'));
});

it("keeps shared-page comparison baselines separate from the local page encoded by saves while following",async()=>{
  // Native live_follow_apply changes ds.page only; FileSnapshot saves ds.doc as its baseline.
  const engine=rectangle();engine.execute("page.add",{name:"Other"});
  engine.setLiveHistory({canUndo:false,canRedo:false,travel:()=>false});
  const sharedPage=engine.liveDrawing().currentPage;
  engine.followViewport(["1",0,0,100,100]);
  expect(engine.getSnapshot().document.currentPage).not.toBe(sharedPage);
  const first=await engine.saveFile();
  engine.execute("file.markSaved",{revision:first.revision});
  expect(await diff(engine)).toEqual(empty);
  engine.execute("file.markSaved");
  expect(await diff(engine)).toEqual(empty);

  const second=await engine.saveFile();
  // The comparison baseline belongs to save capture, before this remote preference change.
  engine.receiveLiveDocument({...engine.liveDrawing(),currentPage:"1"});
  engine.execute("file.markSaved",{revision:second.revision});
  expect(await diff(engine)).toMatchObject({count:1,changes:[{setDoc:{prop:"currentPage",value:1}}]});
});

it("uses native JSON number spelling for invalid numeric targets across the browser JSON boundary",async()=>{
  const engine=rectangle();
  // Independent native serde primitive oracle; -0 crosses browser JSON as the integer token 0.
  for(const [value,text] of [[1e-6,"1e-6"],[1e20,"1e+20"],[1e16,"10000000000000000"],[0,"0"],[-0,"0"]] as const)
    await expect(engine.executeAsync("collab.diff",{against:value})).rejects.toThrow(new Error('invalid parameters for `collab.diff`: `against` is "undo" or "saved", not "'+text+'"'));
});

it("matches independently probed Rust Debug escaping for Unicode marks, fillers and printable exceptions",async()=>{
  const engine=rectangle();
  const cases=[
    ["e\u0301","e\\u{301}"],["a\u00a0b","a\\u{a0}b"],["a\u200db","a\\u{200d}b"],
    ["\ue000","\\u{e000}"],["\u{f0000}","\\u{f0000}"],
    ["\u115f","\\u{115f}"],["\u1160","\\u{1160}"],["\u3164","\\u{3164}"],["\uffa0","\\u{ffa0}"],
    ["\uff9e","\uff9e"],["\uff9f","\uff9f"],
  ];
  for(const [value,debug] of cases)
    await expect(engine.executeAsync("collab.diff",{against:value})).rejects.toThrow(new Error('invalid parameters for `collab.diff`: `against` is "undo" or "saved", not "'+debug+'"'));
  // Native serde maps sort scalar values: U+E000 precedes U+10000, unlike UTF-16 unit order.
  await expect(engine.executeAsync("collab.diff",{"\u{10000}":1,"\ue000":1})).rejects.toThrow(new Error('invalid parameters for `collab.diff`: unknown parameters `\ue000`, `\u{10000}` (it takes against)'));
});

it("compares a historical version's stored page preference while retaining the currently displayed page",async()=>{
  const engine=new EditorEngine("Oracle 🙂");
  engine.execute("page.add",{name:"Other"});
  const secondPage=engine.getSnapshot().document.currentPage;
  engine.execute("page.select",{id:"1"});
  engine.execute("file.saveVersion",{name:"Stored on first page"});
  engine.execute("page.select",{id:secondPage});
  engine.execute("file.markSaved");
  expect(await diff(engine)).toEqual(empty);
  await engine.executeAsync("version.preview",{index:0});
  const shown=engine.getSnapshot();
  expect(shown.document.currentPage).toBe(secondPage);
  expect(shown.previewVersionId).toBeDefined();
  expect(await diff(engine)).toMatchObject({count:1,changes:[{setDoc:{prop:"currentPage",value:1}}]});
  expect(engine.getSnapshot()).toBe(shown);
  expect(engine.getSnapshot().document.currentPage).toBe(secondPage);
});

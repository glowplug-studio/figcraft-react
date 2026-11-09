import {readFileSync} from "node:fs";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {describe,expect,it} from "vitest";
import {decodeFigcraft,decodePublishedLibrary,encodeFigcraft} from "../../src/engine/file-format";

// Rust a2e87433: variable and component fixture, image.replace, library.publish, unpublished rename, file.saveAs.
const fixture=readFileSync(new URL("../fixtures/native-published-library.figcraft",import.meta.url));
const manifest="library/manifest.json",snapshot="library/document.json";
describe("native published library archives",()=>{
  it("keeps the author's edits separate from the publication through a save",async()=>{
    const {document,issues}=await decodeFigcraft(fixture);
    expect(issues).toBeUndefined();
    expect(document.nodes["5"].name).toBe("Unpublished rename");
    const published=document.published!;
    expect(published.document.nodes["5"].name).toBe("Button");
    expect(published.manifest.components).toEqual([{id:"5",name:"Button",published:true,version:"1",set:false}]);
    expect(published.manifest.variables.filter(v=>v.published)).toHaveLength(11);
    const hash=Object.keys(document.images!)[0];
    expect(published.document.images![hash]).toBe(document.images![hash]);
    const saved=await encodeFigcraft(document);
    expect(await decodePublishedLibrary(saved)).toEqual(published);
    expect(unzipSync(saved)["library/images/"+hash]).toBeUndefined();
    expect((await decodeFigcraft(saved)).document).toEqual(document);
  });
  it("reads only the publication and preserves snapshot-only image bytes",async()=>{
    const members=unzipSync(fixture);
    const key=Object.keys(members).find(k=>k.startsWith("images/"))!;
    members["library/"+key]=members[key]; delete members[key];
    const author=JSON.parse(strFromU8(members["document.json"]));author.imageIndex=[];
    members["document.json"]=strToU8(JSON.stringify(author));
    const {document,issues}=await decodeFigcraft(zipSync(members));expect(issues).toBeUndefined();
    expect(document.images).toBeUndefined();
    expect(unzipSync(await encodeFigcraft(document))["library/"+key]).toEqual(members["library/"+key]);
    members["document.json"]=strToU8("corrupt");members["versions/index.json"]=strToU8("{}");
    expect(await decodePublishedLibrary(zipSync(members))).toEqual(document.published);
    delete members["library/"+key];
    expect((await decodePublishedLibrary(zipSync(members)))?.document.images).toBeUndefined();
  });
  it("retains u64 precision, clips by Unicode scalar and removes stale manifest entries",async()=>{
    const members=unzipSync(fixture);
    const m=JSON.parse(strFromU8(members[manifest]));
    m.name="🍎".repeat(201);m.description="𐐀".repeat(2001);m.components.push({...m.components[0],id:999});
    m.collections.push({id:"gone"});m.styles.push({id:"gone"});m.variables.push({...m.variables[0],collection:"wrong"});
    members[manifest]=strToU8(JSON.stringify(m).replace('"version":1','"version":18446744073709551615'));
    const {document}=await decodeFigcraft(zipSync(members));
    expect(document.published!.manifest).toMatchObject({version:"18446744073709551615",name:"🍎".repeat(200),description:"𐐀".repeat(2000),styles:[]});
    expect(document.published!.manifest.components).toHaveLength(1);
    expect(document.published!.manifest.collections).toHaveLength(2);
    expect(document.published!.manifest.variables).toHaveLength(m.variables.length-1);
    expect(await decodePublishedLibrary(await encodeFigcraft(document))).toEqual(document.published);
  });
  it.each([[manifest,"{"],[manifest,'{"id":"../unsafe"}'],[manifest,'{"id":"ok","components":[{"id":"x"}]}'],[snapshot,"{}"],[snapshot,null]] as const)(
    "reports a damaged %s to its author and refuses to link it",async(key,data)=>{
      const parts=unzipSync(fixture);
      if (data===null) delete parts[key]; else parts[key]=strToU8(data);
      const archive=zipSync(parts);
      await expect(decodePublishedLibrary(archive)).rejects.toThrow();
      const opened=await decodeFigcraft(archive);
      expect(opened.document.published).toBeUndefined();
      expect(opened.document.nodes["5"].name).toBe("Unpublished rename");
      expect(opened.issues).toEqual([expect.stringContaining("published library was skipped")]);
    });
});

import {EditorEngine} from "../../src/engine/editor";
import {base64Bytes} from "../../src/engine/recovery";
it("publishes edits as a new version, retains unaffected asset versions and supports undo",async()=>{
  const engine=new EditorEngine();await engine.executeAsync("file.open",{data:base64Bytes(fixture)});
  const before=engine.getSnapshot().document,m=before.published!.manifest;
  expect(engine.execute("library.publish",{description:" Updated "}))
    .toEqual({id:m.id,version:2,components:1,styles:0,collections:2,variables:11});
  const updated=engine.getSnapshot().document.published!;
  expect(updated.document.nodes["5"].name).toBe("Unpublished rename");
  expect(updated.manifest.components[0].version).toBe("2");
  expect(updated.manifest.variables.every(v=>v.version==="1")).toBe(true);
  expect(engine.execute("library.list",{assets:true})).toMatchObject({published:{version:2,description:"Updated",assets:{components:[{id:5,name:"Unpublished rename",version:2}]}}});
  expect(()=>engine.execute("library.publish")).toThrow("no changes to publish");
  engine.execute("edit.undo");expect(engine.getSnapshot().document).toBe(before);
  engine.execute("edit.redo");expect(engine.getSnapshot().document.published).toBe(updated);
  const reopened=await decodeFigcraft(await engine.nativeSnapshot());
  expect(reopened.document.published?.manifest).toEqual(updated.manifest);
});
it("preserves the native choice precedence, hidden names and empty selection refusal",async()=>{
  const engine=new EditorEngine();
  await engine.executeAsync("file.open",{data:base64Bytes(fixture)});
  const depth=engine.getUndoDepth();
  expect(()=>engine.execute("library.publish",{exclude:["Theme","Density",5]})).toThrow("nothing to publish");
  expect(()=>engine.execute("library.publish",{include:["Missing"]})).toThrow("not a local");
  expect(engine.getUndoDepth()).toBe(depth);
  engine.execute("node.set",{id:5,props:{name:".Hidden"}});
  expect(engine.execute("library.list",{assets:true})).toMatchObject({publishable:{components:[{id:5,name:".Hidden",selected:false}]}});
  expect(engine.execute("library.publish",{include:["5",".Hidden","Theme"],exclude:["Theme"]})).toMatchObject({version:2,components:2,collections:0});
  expect(engine.getSnapshot().document.published!.manifest.components).toHaveLength(1);
});

it("links the chosen publication across documents and restores only its published assets",async()=>{
  const engine=new EditorEngine(),file=new File([fixture],"Kit.figcraft");
  let stored!:Blob;
  const added=await engine.pickLibrary(file,async(_path,blob)=>{stored=blob;});
  const path=String(added.path),source=engine.librarySource(path)!;
  expect(added).toMatchObject({id:source.manifest.id,name:"Untitled",version:1,components:[{name:"Button",id:5}]});
  expect(await decodeFigcraft(stored)).toMatchObject({document:{nodes:{"1":{children:[]}},published:{document:{nodes:{"5":{name:"Button"}}}}}});
  expect(Object.keys((await decodeFigcraft(stored)).document.nodes)).toEqual(["1"]);
  const depth=engine.getUndoDepth();
  await engine.pickLibrary(file);
  expect(engine.getUndoDepth()).toBe(depth);
  const archive=await engine.nativeSnapshot(),fresh=new EditorEngine();
  await fresh.executeAsync("file.open",{data:base64Bytes(archive)});
  let info=fresh.execute("library.list",{assets:true});expect(info).toMatchObject({libraries:[{seenVersion:1,error:expect.any(String)}]});
  const link=fresh.getSnapshot().document.libraryLinks![0];
  await fresh.restoreLibrary(link,async()=>stored);
  info=fresh.execute("library.list",{assets:true});expect(info).toMatchObject({libraries:[{path,version:1,seenVersion:1,components:[{id:5,name:"Button",set:false,version:1}]}]});
  const moved=await fresh.pickLibrary(new File([fixture],"Moved.figcraft"));
  expect(moved.path).not.toBe(path);expect(fresh.getSnapshot().document.libraryLinks).toHaveLength(1);
  expect(fresh.execute("library.remove",{id:"Untitled"})).toEqual({removed:source.manifest.id});
  fresh.execute("edit.undo");expect(fresh.getSnapshot().document.libraryLinks?.[0].path).toBe(moved.path);
  fresh.setEditable(false);expect(fresh.librarySource(String(moved.path))).toBeUndefined();
});
it("rejects a self-link, unpublished source or obsolete file selection without creating history",async()=>{
  const engine=new EditorEngine(),file=new File([fixture],"Kit.figcraft");
  await engine.executeAsync("file.open",{data:base64Bytes(fixture)});
  await expect(engine.pickLibrary(file)).rejects.toThrow("this file is the library");
  await expect(engine.pickLibrary(new File([zipSync({}) as Uint8Array<ArrayBuffer>],"Empty.figcraft"))).rejects.toThrow("no published library");
  expect(engine.getUndoDepth()).toBe(0);
  const other=new EditorEngine();let began!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{began=resolve;});
  const pending=other.pickLibrary(file,async()=>{began();await new Promise<void>(resolve=>{release=resolve;});});
  await started;other.cancelPendingFiles();release();
  await expect(pending).rejects.toThrow("destination or library selection changed");
  expect(other.getSnapshot().document.libraryLinks).toBeUndefined();
});

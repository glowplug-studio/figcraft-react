import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { parse } from "lossless-json";
import { expect, it } from "vitest";
import { decodeFigcraft } from "../../src/engine/file-format";
import { applyLive } from "../../src/engine/sharing/live-replica";
import { initialDocumentState } from "../../src/engine/sharing/document-session";
import { diffLive, liveReplica, liveTargetValue, type LiveChange } from "../../src/engine/sharing/live-changes";

import {nativeLiveChange,type NativeChange} from "../support/nativeLiveChange";

const corpus = unzipSync(readFileSync(new URL("../fixtures/native-ordered-changes.zip",import.meta.url)));
it("produces the complete native property batches for edit, reparent, reply, deletion, page change and undo", async () => {
  let replica = liveReplica((await decodeFigcraft(corpus["0.figcraft"])).document);
  const batches = strFromU8(corpus["changes.jsonl"]).trim().split("\n");
  for (const [i,line] of batches.entries()) {
    const next = (await decodeFigcraft(corpus[(i+1)+".figcraft"])).document;
    const result = await diffLive(replica, next);
    expect(result.changes, "native batch " + (i+1)).toEqual((parse(line) as NativeChange[]).map(nativeLiveChange));
    const applied = await applyLive(replica, result.changes);
    expect(applied.skipped).toBe(0);
    for(const change of result.changes){
      if(change.type==="create" || change.type==="delete")continue;
      expect(await liveTargetValue(applied.replica,change)).toBe(change.type==="remove"?undefined:change.value);
    }
    expect(await initialDocumentState(applied.replica.document, 17n), "native replica " + (i+1))
      .toEqual(await initialDocumentState(next, 17n));
    expect(applied.replica.positions).toEqual(result.replica.positions);
    replica = applied.replica;
  }
});

async function fromState(n: number) {
  return liveReplica((await decodeFigcraft(corpus[n+".figcraft"])).document);
}

it("rolls back the whole refused batch and skips stale edits on optimistic replay", async () => {
  const from = await fromState(2);
  const rename: LiveChange = {type:"set",id:"3",prop:"name",value:'"Mine"'};
  const gone: LiveChange = {...rename,id:"999"};
  await expect(applyLive(from,[rename,gone])).rejects.toThrow(/No such layer/);
  expect(from.document.nodes["3"].name).toBe("Ink");
  const result = await applyLive(from,[gone,{type:"delete",id:"1"},rename],"lenient");
  expect(result.skipped).toBe(2);
  expect(result.replica.document.nodes["3"].name).toBe("Mine");
  expect(result.replica.document.pages).toEqual(["1"]);
});

it("orders colliding positions by full u64 ID and removes a deleted subtree's keys", async () => {
  const from = await fromState(1);
  const keys = ["9007199254740994","9007199254740993"];
  const creates: LiveChange[] = keys.map(id => ({type:"create",id,parent:"2",kind:'{"type":"rectangle"}',position:"a0",props:[]}));
  const {replica} = await applyLive(from,creates);
  const frame = replica.document.nodes["2"];
  expect("children" in frame && frame.children).toEqual(["3",keys[1],keys[0]]);
  const removed = await applyLive(replica,[{type:"delete",id:"2"}]);
  expect([...removed.replica.positions.keys()]).toEqual(["1"]);
  expect(from.positions.size).toBe(3);
});

it("validates final geometry, opacity, hierarchy and isolated kind payloads", async () => {
  const from = await fromState(1);
  for (const [prop,value] of [["opacity","1.1"],["width","1000000001"],["position",'"!"'],["kind",'{"type":"rectangle","id":3}'],["parent","3"]]) {
    await expect(applyLive(from,[{type:"set",id:"2",prop,value}])).rejects.toThrow();
  }
  const opacity = (value: string): LiveChange => ({type:"set",id:"3",prop:"opacity",value});
  expect((await applyLive(from,[opacity("2"),opacity("0.5")])).replica.document.nodes["3"].opacity).toBe(0.5);
  const changed = await applyLive(from,[{type:"set",id:"2",prop:"kind",value:'{"type":"rectangle"}'},{type:"delete",id:"3"}]);
  expect(changed.replica.document.nodes["2"].kind).toBe("rectangle");
});

it("keeps duplicate list entries in occurrence order and reuses the unchanged layer tree", async () => {
  const start = await fromState(0);
  const styles = ["A","B","A","C"].map((id,i) => ({id,name:String(i),type:"paint",paints:[]}));
  const {replica} = await applyLive(start,[{type:"setDoc",prop:"styles",value:JSON.stringify(styles)},
    {type:"setDoc",prop:"styleOrder",value:'["B","A","A","A"]'},{type:"setDoc",prop:"currentPage",value:"null"}]);
  expect(replica.document.styles?.map(s => s.name)).toEqual(["1","0","2","3"]);
  expect(replica.document.currentPage).toBe("1");
  expect(replica.document.nodes).toBe(start.document.nodes);
  expect(replica.positions).toBe(start.positions);
  const diff = await diffLive(start,replica.document);
  expect(diff.replica.positions).toBe(start.positions);
  expect(diff.changes.map(c => c.type)).toEqual(["setDoc"]);
});

it("admits only supported network operations and keeps IDs outside the Number conversion path", async () => {
  const {readLiveChanges} = await import("../../src/engine/sharing/live-wire");
  const valid = {type:"delete",id:"18446744073709551615"};
  expect(readLiveChanges([{...valid,principal:"untrusted"}])).toEqual([valid]);
  for (const invalid of [{...valid,id:9},{...valid,id:"18446744073709551616"},{...valid,type:"forged"},
    {type:"set",id:"3",prop:"__proto__",value:"{}"},{type:"create",id:"3",position:"a0",kind:"{}",parent:"1",props:[["width",12]]},
    {type:"put",entry:"comment",key:"-1",value:"{}"}]) expect(() => readLiveChanges([invalid])).toThrow();
  expect(() => readLiveChanges(Array(500001))).toThrow(/size/);
});

it("authorises scoped creations, restores deleted foreign layers and prevents another client's entry allocation", async () => {
  const {admitLiveChanges,emptyRemovedIds} = await import("../../src/engine/sharing/live-admission");
  const from = await fromState(1), issued = new Set([1,2]);
  const options = {client:1,base:0n,sequence:4n,access:"edit" as const,changes:[] as LiveChange[]};
  const create = (id: string): LiveChange => ({type:"create",id,parent:"1",kind:'{"type":"rectangle"}',position:"a0",props:[]});
  const run = (changes: LiveChange[], access: "view"|"edit"|"comment" = "edit") =>
    admitLiveChanges(from,emptyRemovedIds,issued,{...options,access,changes});
  await expect(run([create("8589934593")])).rejects.toThrow(/space/);
  const removed = await run([{type:"delete",id:"2"}]);
  expect(removed.removed.nodes).toEqual(["2","3"]);
  const restored = await admitLiveChanges(removed.replica,removed.removed,issued,{...options,changes:[create("3")]});
  expect(restored.removed.nodes).toEqual(["2"]);
  await expect(run([create("4294967297")],"comment")).rejects.toThrow(/comment/);
  await expect(run([],"view")).rejects.toThrow(/view/);
  const style = (n: string): LiveChange => ({type:"put",entry:"style",key:"S:"+n,value:JSON.stringify({id:"S:"+n,name:"Paint",type:"paint",paints:[]})});
  await expect(run([style("8589934593")])).rejects.toThrow(/space/);
  await expect(run([style("9223372036854775808")])).rejects.toThrow(/space/);
  expect((await run([style("12884901889")])).replica.document.styles?.[0].id).toBe("S:12884901889");
  await expect(admitLiveChanges(from,emptyRemovedIds,issued,{...options,base:5n})).rejects.toThrow(/sequence/);
});

it("validates claimed image bytes, padding, dimensions and immutable image keys", async () => {
  const start = await fromState(0);
  const put = (key: string,bytes: string,width=0): LiveChange => ({type:"put",entry:"image",key,value:JSON.stringify({width,height:0,bytes})});
  const {replica} = await applyLive(start,[put("placeholder","YQ==")]);
  expect(replica.document.images?.placeholder.width).toBe(0);
  for (const c of [put("placeholder","Yg=="),put("other","YR=="),put("other","Y Q="),put("a".repeat(64),"YQ=="),put("other","YQ==",65536)]) {
    await expect(applyLive(replica,[c])).rejects.toThrow();
  }
  expect((await applyLive(replica,[{type:"remove",entry:"image",key:"placeholder"}])).replica.document.images).toBeUndefined();
});

it("keeps keys that do not follow normal archive order through a compacted checkpoint",async()=>{
  const {makeLiveCheckpoint,restoreLiveCheckpoint} = await import("../../src/engine/sharing/live-checkpoint");
  const start = await fromState(2);
  const {replica} = await applyLive(start,[{type:"set",id:"4",prop:"position",value:'"a0"'}]);
  const saved = await makeLiveCheckpoint(replica);
  expect(saved.positions).toContainEqual(["4","a0"]);
  const read = await restoreLiveCheckpoint(saved);
  expect(read.positions).toEqual(replica.positions);
  expect((await diffLive(replica,read.document)).changes).toEqual([]);
});

it("leaves a subsequently claimed field alone even if it returns to the original value",async()=>{
  const {captureLiveStep,taintStep,travelLiveStep}=await import("../../src/engine/sharing/live-history");
  const from=await fromState(2);
  const own:LiveChange[]=[{type:"set",id:"3",prop:"name",value:'"My label"'},{type:"set",id:"3",prop:"width",value:"48"}];
  const edited=(await applyLive(from,own)).replica;
  const step=await captureLiveStep(from,edited,own);
  taintStep(step,[{type:"set",id:"3",prop:"name",value:'"Another label"'},own[0]]);
  const undone=(await applyLive(edited,travelLiveStep(step,true,edited.document))).replica;
  expect(undone.document.nodes["3"]).toMatchObject({name:"My label",width:30});
  expect((await applyLive(undone,travelLiveStep(step,false,undone.document))).replica.document.nodes["3"]).toMatchObject({name:"My label",width:48});
});

it("leaves a locally created frame containing somebody else's new layer in place during undo",async()=>{
  const {captureLiveStep,taintStep,travelLiveStep}=await import("../../src/engine/sharing/live-history");
  const from=await fromState(0), after=await fromState(1);
  const own=await diffLive(from,after.document);
  const step=await captureLiveStep(from,own.replica,own.changes);
  const other:LiveChange={type:"create",id:"8589934593",parent:"2",kind:'{"type":"rectangle"}',position:"a2",props:[]};
  const merged=(await applyLive(own.replica,[other])).replica;
  taintStep(step,[other]);
  const undone=(await applyLive(merged,travelLiveStep(step,true,merged.document))).replica;
  expect(Object.keys(undone.document.nodes).sort()).toEqual(["1","2","8589934593"]);
});

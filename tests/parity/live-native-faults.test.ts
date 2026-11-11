import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {parse} from "lossless-json";
import {expect,it} from "vitest";
import {newDocument} from "../../src/engine/document";
import {initialDocumentState} from "../../src/engine/sharing/document-session";
import {admitLiveChanges,emptyRemovedIds,liveRefusalReason} from "../../src/engine/sharing/live-admission";
import {livePageReference} from "../../src/engine/sharing/live-changes";
import {makeLiveCheckpoint,restoreLiveCheckpoint} from "../../src/engine/sharing/live-checkpoint";
import {applyLive} from "../../src/engine/sharing/live-replica";
import {nativeLiveChange,type NativeChange} from "../support/nativeLiveChange";

interface Request {client:number;base:number;batch:number;seq:number;reason:string|null;changes:NativeChange[]}
interface Trace {clients:number;initial:NativeChange[];end:NativeChange[];seq:number;requests:Request[]}
const corpus=unzipSync(readFileSync(new URL("../fixtures/native-session-faults.zip",import.meta.url)));

it.each(Object.keys(corpus))("matches the native server decisions and complete state in %s",async file=>{
  const trace=parse(strFromU8(corpus[file])) as Trace;
  const document={...newDocument(""),nodes:{},pages:[]};
  let {replica:state}=await applyLive({document,positions:new Map()},trace.initial.map(nativeLiveChange));
  let sequence=0,removed=emptyRemovedIds;
  const issued=new Set(Array.from({length:Number(trace.clients)},(_,i)=>i+1));
  for(const request of trace.requests){
    const changes=request.changes.map(nativeLiveChange),client=Number(request.client);
    let reason:string|null=null;
    try{
      const accepted=await admitLiveChanges(state,removed,issued,{access:"edit",client,base:BigInt(String(request.base)),sequence:BigInt(sequence),changes});
      state=accepted.replica;removed=accepted.removed;sequence++;
    }catch(error){reason=liveRefusalReason(error);}
    expect({reason,sequence},file+" client "+client+" batch "+request.batch).toEqual({reason:request.reason,sequence:Number(request.seq)});
  }
  state=await restoreLiveCheckpoint(await makeLiveCheckpoint(state));
  const actual=(await initialDocumentState(state.document,1n)).changes.map(c=>{
    if(c.type==="setDoc" && c.prop==="currentPage")return {...c,value:livePageReference(state)??"null"};
    return c.type==="create"?{...c,position:state.positions.get(c.id)}:c;
  });
  expect(sequence).toBe(Number(trace.seq));
  expect(actual).toEqual(trace.end.map(nativeLiveChange));
});

import {readFileSync} from "node:fs";
import {expect,it,vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import {admitLiveChanges,liveRefusalReason} from "../../src/engine/sharing/live-admission";
import {liveReplica} from "../../src/engine/sharing/live-changes";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import type {LiveAccepted,LiveTransport} from "../../src/engine/sharing/live-transport";

interface NativeStage {stage:string;sequence:number;name:string|null;width:number|null;history:boolean[][];rejected:number;notices:string[][]}
const {stages,lostRefusal}:{stages:NativeStage[];lostRefusal:NativeStage}=JSON.parse(readFileSync(new URL("../fixtures/native-offline-history.json",import.meta.url),"utf8"));
function initialEditor(){
  const engine=new EditorEngine();
  engine.execute("node.create",{type:"rectangle",name:"Box",width:20,height:10});
  engine.execute("node.set",{id:2,props:{name:"Box"}});
  return engine;
}

// The same six settled states come from the pinned Rust Sim. Each seed changes read and write delay.
// A committed write also loses its HTTP reply on the way back to the reconnecting editor.
it.each([4,19,37])("replays native offline edits, refusal and undo ownership on delayed links, seed %i",async seed=>{
  const editors=[initialEditor(),initialEditor()],online=[true,true],lastSeen=[-1,-1],processed=[0,0];
  const rejected=[new Set<string>(),new Set<string>()],notices:string[][]=[[],[]];
  const journal:LiveAccepted[]=[],wake:Array<(()=>void)|undefined>=[];
  const archive=await encodeFigcraftBlob(editors[0].liveDrawing());
  let state=liveReplica(editors[0].liveDrawing()),removed:{nodes:string[];entries:string[]}={nodes:[],entries:[]};
  let noise=seed,lost=false,droppedRefusal=false;
  async function delay(){
    noise=(Math.imul(noise,1664525)+1013904223)>>>0;
    await new Promise<void>(resolve=>setTimeout(resolve,1+noise%8));
  }
  const transport=(i:number):LiveTransport=>({
    archive,
    listen(f){wake[i]=f;return ()=>{wake[i]=undefined;};},
    async read(after){
      await delay();if(!online[i])throw new Error("offline");
      lastSeen[i]=journal.length;
      return {client:i+1,access:"edit",sequence:String(journal.length),lastBatch:String(processed[i]),refused:[...rejected[i]],
        reset:after===null,checkpointSeq:"0",batches:structuredClone(journal.slice(Number(after??0)))};
    },
    async submit(batch,base,changes){
      await delay();if(!online[i])throw new Error("offline");
      if(Number(batch)<=processed[i])return {decision:"processed",sequence:String(journal.length),refused:rejected[i].has(batch)};
      let reason:string|undefined;
      try {
        const accepted=await admitLiveChanges(state,removed,new Set([1,2]),{client:i+1,base:BigInt(base),sequence:BigInt(journal.length),access:"edit",changes});
        state=accepted.replica;removed=accepted.removed;
        journal.push({sequence:String(journal.length+1),client:i+1,batch,changes:structuredClone([...changes])});
      }catch(error){rejected[i].add(batch);reason=liveRefusalReason(error);}
      processed[i]=Number(batch);wake.forEach((f,j)=>{if(online[j])f?.();});
      if(i===0 && !lost){lost=true;throw new Error("lost acknowledgement");}
      if(reason && seed===19){droppedRefusal=true;throw new Error("lost refusal response");}
      return {reason,decision:rejected[i].has(batch)?"refused":"accepted",sequence:String(journal.length),refused:rejected[i].has(batch)};
    },
  });
  const stops=editors.map((engine,i)=>{
    engine.setLiveClient(i+1);
    return new LivePeer({current:()=>engine.liveDrawing(),receive:d=>engine.receiveLiveDocument(d),subscribe:engine.subscribe,
      normalise:(before,after,touched)=>engine.repairLiveDocument(before,after,touched),interacting:()=>engine.interacting,
      recordsEdit:d=>engine.recordsLiveEdit(d),history:h=>engine.setLiveHistory(h)},transport(i),i+1,text=>notices[i].push(text)).start();
  });
  async function settle(stage:NativeStage){
    await vi.waitFor(()=>{
      expect(lastSeen).toEqual([stage.sequence,stage.sequence]);
      expect(journal.length).toBe(stage.sequence);
      for(const [i,engine] of editors.entries()){
        const node=engine.liveDrawing().nodes["2"];
        expect(node?.name??null).toBe(stage.name);expect(node && "width" in node?node.width:null).toBe(stage.width);
        expect([engine.liveHistory?.canUndo,engine.liveHistory?.canRedo]).toEqual(stage.history[i]);
      }
      expect(rejected[0].size+rejected[1].size-Number(droppedRefusal)).toBe(stage.rejected);
      expect(notices).toEqual(stage.notices);
    },{timeout:8000,interval:20});
  }
  const [alice,bob]=editors;
  try{
    await vi.waitFor(()=>expect(lastSeen).toEqual([0,0]));
    online[0]=false;
    alice.execute("node.set",{id:2,props:{name:"Offline",width:30}});
    bob.execute("node.set",{id:2,props:{width:73}});
    await vi.waitFor(()=>expect(lastSeen[1]).toBe(1));
    online[0]=true;wake[0]?.();await settle(stages[0]);
    alice.execute("edit.undo");await settle(stages[1]);
    alice.execute("edit.redo");await settle(stages[2]);
    bob.execute("node.set",{id:2,props:{width:91}});await settle(stages[3]);
    alice.execute("edit.undo");await settle(stages[4]);
    online[0]=false;
    alice.execute("node.set",{id:2,props:{name:"Too late"}});
    bob.execute("select.set",{ids:[2]});bob.execute("edit.delete");
    await vi.waitFor(()=>expect(lastSeen[1]).toBe(7));
    online[0]=true;wake[0]?.();await settle(seed===19?lostRefusal:stages[5]);
    expect(lost).toBe(true);expect(notices[0]).toHaveLength(1);
  }finally{stops.forEach(stop=>stop());}
},30000);

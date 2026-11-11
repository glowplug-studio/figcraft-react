import {readFileSync} from "node:fs";
import {expect,it,vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import {liveReplica} from "../../src/engine/sharing/live-changes";
import {makeLiveCheckpoint,type LiveCheckpoint} from "../../src/engine/sharing/live-checkpoint";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import {applyLive} from "../../src/engine/sharing/live-replica";
import type {LiveAccepted,LiveTransport} from "../../src/engine/sharing/live-transport";

interface Stage {name:string;width:number;sequence:number;canUndo:boolean;canRedo:boolean;pending:number}
interface Trace {mode:string;resends:number;restored:Stage;afterTravel:Stage}
const traces:Trace[]=JSON.parse(readFileSync(new URL("../fixtures/native-checkpoint-history.json",import.meta.url),"utf8"));

const cases=traces.flatMap(trace=>[72,73].map(checkpointWidth=>({...trace,checkpointWidth})));
it.each(cases)("preserves native ownership after compacted $mode delivery at width $checkpointWidth",async trace=>{
  const editor=new EditorEngine();
  editor.execute("node.create",{type:"rectangle",width:20,height:10});
  editor.execute("node.set",{id:2,props:{name:"Box"}});
  editor.setLiveClient(1);
  let state=liveReplica(editor.liveDrawing());
  const archive=await encodeFigcraftBlob(state.document);
  const log:LiveAccepted[]=[],notices:string[]=[];
  const faultBatch=trace.mode.startsWith("edit")?1:trace.mode.startsWith("undo")?2:3;
  let processed=0,seen=-1,offline=false,rejoined=false,resends=0,checkpointSeq=0;
  let checkpoint:LiveCheckpoint|undefined,wake=()=>{};
  const transport:LiveTransport={
    archive,listen(f){wake=f;return ()=>{};},
    async read(after){
      if(offline)throw new Error("offline");
      const reset=after===null || Number(after)<checkpointSeq;
      seen=log.length;
      return {reset,client:1,access:"edit",sequence:String(seen),lastBatch:String(processed),refused:[],
        checkpoint:reset?checkpoint:undefined,checkpointSeq:String(checkpointSeq),batches:log.slice(reset?checkpointSeq:Number(after))};
    },
    async submit(batch,_base,changes){
      const fault=!rejoined && Number(batch)===faultBatch;
      if(rejoined && Number(batch)===faultBatch)resends++;
      if(!(fault && trace.mode.endsWith("-lost"))){
        state=(await applyLive(state,changes)).replica;
        log.push({sequence:String(log.length+1),client:1,batch,changes:[...changes]});
        processed=Number(batch);
      }
      if(fault){offline=true;throw new Error("lost in transit");}
      return {decision:"accepted",refused:false,sequence:String(log.length)};
    },
  };
  const stop=new LivePeer({current:()=>editor.liveDrawing(),receive:d=>editor.receiveLiveDocument(d),subscribe:editor.subscribe,
    interacting:()=>false,normalise:(_before,after)=>after,history:h=>editor.setLiveHistory(h)},transport,1,m=>notices.push(m)).start();
  async function check(stage:Stage){
    await vi.waitFor(()=>{
      expect(seen).toBe(stage.sequence);
      expect(editor.liveDrawing().nodes["2"]).toMatchObject({name:stage.name,width:stage.width});
      expect(state.document.nodes["2"]).toMatchObject({name:stage.name,width:stage.width});
      expect(editor.liveHistory).toMatchObject({canUndo:stage.canUndo,canRedo:stage.canRedo});
    });
  }
  try{
    await vi.waitFor(()=>expect(seen).toBe(0));
    editor.execute("node.set",{id:2,props:{name:"A name",width:30}});
    if(faultBatch>=2){
      await vi.waitFor(()=>expect(seen).toBe(1));editor.execute("edit.undo");
    }
    if(faultBatch===3){
      await vi.waitFor(()=>expect(seen).toBe(2));editor.execute("edit.redo");
    }
    await vi.waitFor(()=>expect(offline).toBe(true));
    for(const width of [70,71,72,73]){
      const changes=[{type:"set" as const,id:"2",prop:"width",value:String(width)}];
      state=(await applyLive(state,changes)).replica;
      log.push({sequence:String(log.length+1),client:2,batch:String(width-69),changes});
      if(width===trace.checkpointWidth){
        checkpointSeq=log.length;
        checkpoint=await makeLiveCheckpoint(state);
      }
    }
    offline=false;rejoined=true;wake();
    await check(trace.restored);
    expect(resends).toBe(trace.resends);
    editor.execute(trace.mode.startsWith("undo")?"edit.redo":"edit.undo");
    await check(trace.afterTravel);
    expect(notices).toEqual([]);
  }finally{stop();}
});

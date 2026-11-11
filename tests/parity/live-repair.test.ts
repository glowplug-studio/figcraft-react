import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { applyLive } from "../../src/engine/sharing/live-replica";
import { diffLive, liveReplica } from "../../src/engine/sharing/live-changes";
import { normaliseLive } from "../../src/engine/sharing/live-normalise";

function row() {
  const editor = new EditorEngine();
  editor.execute("node.create",{type:"frame",width:110,height:80,props:{layout:"row",padding:5,gap:6}});
  editor.execute("node.create",{type:"rectangle",parent:2,width:20,height:30});
  editor.execute("node.create",{type:"rectangle",parent:2,width:30,height:30});
  editor.execute("node.set",{id:2,sizingH:"hug"});
  return editor;
}

it("repairs both children in a hug frame after two peers resize different layers from the same base",async()=>{
  const alice=row(), bob=row(), base=liveReplica(alice.getSnapshot().document);
  alice.execute("node.set",{id:3,props:{width:55}});
  bob.execute("node.set",{id:4,props:{width:72}});
  const a=await diffLive(base,alice.getSnapshot().document), b=await diffLive(base,bob.getSnapshot().document);
  for (const [first,last] of [[a,b],[b,a]]) {
    const prior=(await applyLive(base,first.changes)).replica, merged=await applyLive(prior,last.changes);
    expect(merged.replica.document.nodes["2"]).not.toMatchObject({width:143});
    const fixed=normaliseLive(prior.document,merged.replica.document,merged.touched,1,4294967297n);
    const follow=await diffLive(merged.replica,fixed.document);
    const stored=(await applyLive(merged.replica,follow.changes)).replica.document;
    // Pinned native engine after both normalised node.set commands, in either order.
    expect(stored.nodes["2"]).toMatchObject({width:143,height:80});
    expect(stored.nodes["3"]).toMatchObject({width:55,x:5});
    expect(stored.nodes["4"]).toMatchObject({width:72,x:66});
  }
});

it("emits one follow-up outside user history when two clients' optimistic layout results conflict",async()=>{
  const {LivePeer}=await import("../../src/engine/sharing/live-peer");
  const {encodeFigcraftBlob}=await import("../../src/engine/file-format");
  const {vi}=await import("vitest");
  const a=row(), b=row(), archive=await encodeFigcraftBlob(a.archiveRevision.document);
  const accepted: import("../../src/engine/sharing/live-transport").LiveAccepted[]=[];
  const wakes=new Set<()=>void>();
  let open!:()=>void, sends=0;
  const bothWriting=new Promise<void>(resolve=>{open=resolve;});
  const reads=new Set<number>();
  const bind=(editor:EditorEngine,client:number)=>{
    editor.setLiveClient(client);
    const peer=new LivePeer({current:()=>editor.archiveRevision.document,receive:d=>editor.receiveLiveDocument(d),
      normalise:(pre,post,touched)=>editor.repairLiveDocument(pre,post,touched),subscribe:editor.subscribe,
      interacting:()=>editor.interacting,history:h=>editor.setLiveHistory(h)},{
      archive,listen(wake){wakes.add(wake);return ()=>{wakes.delete(wake);};},
      async read(after) {
        reads.add(client);
        const mine=accepted.filter(b=>b.client===client);
        return {client,access:"edit",sequence:String(accepted.length),lastBatch:mine.at(-1)?.batch??"0",refused:[],
          checkpointSeq:"0",reset:after===null,batches:accepted.slice(Number(after??0))};
      },
      async submit(batch,_base,changes){
        if (++sends===2) open();
        await bothWriting;
        accepted.push({sequence:String(accepted.length+1),client,batch,changes:[...changes]});
        for(const wake of wakes) wake();
        return {sequence:String(accepted.length),decision:"accepted",refused:false};
      },
    },client,message=>{throw new Error(message);});
    return peer.start();
  };
  const stopA=bind(a,1),stopB=bind(b,2);
  try {
    await vi.waitFor(()=>expect(reads.size).toBe(2));
    a.execute("node.set",{id:3,props:{width:55}});
    b.execute("node.set",{id:4,props:{width:72}});
    await vi.waitFor(()=>{
      expect(accepted.length).toBe(3);
      for(const engine of [a,b]) expect(engine.archiveRevision.document.nodes["2"]).toMatchObject({width:143});
    },{timeout:8000});
    expect(accepted[2].changes).toEqual([{type:"set",id:"2",prop:"width",value:"143.0"}]);
    const last=accepted[2].client===1?a:b;
    expect(last.execute("edit.undo")).toEqual({undone:true});
    await vi.waitFor(()=>expect(accepted.length).toBeGreaterThan(3));
    expect(accepted[3].changes.some(c=>c.type==="set" && (c.id==="3" || c.id==="4") && c.prop==="width")).toBe(true);
  } finally {stopA();stopB();}
},12000);

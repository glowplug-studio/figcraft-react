import {expect,it,vi} from "vitest";
import {EditorWorkspace} from "../../src/engine/workspace";
import {EditorEngine} from "../../src/engine/editor";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import type {OnlineGuestSession,OnlineInvitations} from "../../src/backends/online-files";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import {liveReplica} from "../../src/engine/sharing/live-changes";
import {applyLive} from "../../src/engine/sharing/live-replica";
import type {LiveAccepted,LiveTransport} from "../../src/engine/sharing/live-transport";

const host:OnlineInvitations={subscribe:()=>()=>{},showJoin(){},async leave(){},async copyPublished(){}};
const session:OnlineGuestSession={client:3,connection:"logical",access:"edit",file:"f"};

// Reproduce the independently asserted collab_live_tests.rs manual-rejoin cases.
it.each(["independent","conflict","new client","unchanged","view"] as const)("rejoins stranded work: %s",async mode=>{
  const source=EditorEngine.newTab("Drawing");
  source.execute("node.create",{type:"rectangle",name:"First",width:40,height:10});
  source.execute("node.create",{type:"rectangle",name:"Second",width:50,height:10});
  const base=source.liveDrawing(),original=await encodeFigcraftBlob(base);
  const workspace=new EditorWorkspace(),notices:string[]=[];
  workspace.setInvitations(host,value=>notices.push(value));
  await workspace.open(new File([original],"f.figcraft"),session);
  const editor=workspace.activeEngine!,id=workspace.getSnapshot()[1].id;
  editor.setLiveHistory({canUndo:false,canRedo:false,travel:()=>false,confirmed:()=>base});
  workspace.setGuestSession({...session,ended:"unavailable"});
  editor.setLiveHistory(undefined);
  let made:string|undefined;
  if(mode!=="unchanged"){
    editor.execute("node.set",{id:2,props:{name:"Mine"}});
    editor.execute("node.set",{id:3,props:{name:"Only mine"}});
    if(mode!=="conflict"){
      made=String(editor.execute("shape.rectangle").id);
      expect(BigInt(made)>>32n).toBe(3n);
    }
  }
  const local=editor.getSnapshot().document;
  source.execute("node.set",{id:2,props:mode==="conflict"?{name:"Theirs"}:{width:73}});
  let server=liveReplica(source.liveDrawing());
  const client=mode==="new client"?4:3,access=mode==="view"?"view":"edit";
  workspace.setGuestSession({...session,client,access});
  const journal:LiveAccepted[]=[],transport:LiveTransport={archive:await encodeFigcraftBlob(server.document),listen:()=>()=>{},
    async read(after){return {client,access,reset:after===null,sequence:String(journal.length),lastBatch:String(journal.length),
      batches:journal.slice(Number(after)),refused:[]};},
    async submit(batch,_base,changes){
      expect(access).toBe("edit");
      server=(await applyLive(server,changes)).replica;
      journal.push({batch,client,changes:[...changes],sequence:String(journal.length+1)});
      return {sequence:String(journal.length),decision:"accepted",refused:false};
    }};
  const stop=new LivePeer({current:()=>editor.liveDrawing(),subscribe:editor.subscribe,history:h=>editor.setLiveHistory(h),
    receive:d=>editor.receiveLiveDocument(d),interacting:()=>false,normalise:(_a,b)=>b,
    mergeStranded:(state,me)=>workspace.mergeStrandedDrawing(session.connection,state,me)},transport,client,msg=>notices.push(msg)).start();
  try{
    await vi.waitFor(()=>expect(notices.at(-1)).toMatch(/^Reconnected to Drawing/));
    const keeps=mode==="independent" || mode==="conflict";
    await vi.waitFor(()=>expect(server.document.nodes["3"].name).toBe(keeps?"Only mine":base.nodes["3"].name));
    expect(editor.getSnapshot().document.nodes["2"].name).toBe(mode==="conflict"?"Theirs":mode==="independent"?"Mine":base.nodes["2"].name);
    expect(workspace.getSnapshot().find(t=>t.active)?.id).toBe(id);
    if(mode==="conflict" || mode==="new client" || mode==="view"){
      const tab=workspace.getSnapshot().at(-1)!;
      expect(tab).toMatchObject({name:"Drawing (offline copy)",active:false,dirty:true});
      const copy=workspace.engines[tab.index].getSnapshot().document;
      expect(copy.nodes).toEqual(local.nodes);
      if(made)expect(server.document.nodes[made]).toBeUndefined();
    }else{
      expect(workspace.engines).toHaveLength(2);
      if(made)expect(server.document.nodes[made]).toBeDefined();
    }
    if(keeps){
      await vi.waitFor(()=>expect(editor.liveHistory?.canUndo).toBe(true));
      editor.execute("edit.undo");
      await vi.waitFor(()=>expect(server.document.nodes["3"].name).toBe(base.nodes["3"].name));
      if(mode==="conflict")expect(server.document.nodes["2"].name).toBe("Theirs");
      else expect(server.document.nodes["2"]).toMatchObject({width:73});
    }
  }finally{stop();}
});

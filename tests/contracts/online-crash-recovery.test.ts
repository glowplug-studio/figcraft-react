import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {IDBFactory} from "fake-indexeddb";
import {expect,it,vi} from "vitest";
import {IndexedDbRecoveryStore} from "../../src/backends/browser/recovery";
import type {OnlineInvitations} from "../../src/backends/online-files";
import type {Document} from "../../src/engine/document";
import {EditorWorkspace} from "../../src/engine/workspace";
import {WorkspaceRecovery} from "../../src/engine/workspace-recovery";
import {OnlineWorkspace} from "../../src/engine/sharing/online-workspace";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import type {LiveAccepted,LiveTransport} from "../../src/engine/sharing/live-transport";
import type {OnlineRecoveryPosition} from "../../src/engine/sharing/online-recovery";

const fixtures=unzipSync(readFileSync(new URL("../fixtures/native-online-recovery.zip",import.meta.url)));
function layers(doc:Document) {
  const page=doc.nodes[doc.pages[0]];
  return "children" in page ? page.children.length : 0;
}
const cases=Object.keys(fixtures).filter(key=>key.endsWith("/welcome.json")).map(key=>key.split("/")[0]);
it.each(cases)("restores the native stored drawing through the ordered live client for %s",async name=>{
  const json=(file:string)=>JSON.parse(strFromU8(fixtures[name+"/"+file+".json"]));
  const blob=(file:string)=>new Blob([new Uint8Array(fixtures[name+"/"+file+".figcraft"])]);
  const stored=json("at") as OnlineRecoveryPosition,current=json("welcome") as OnlineRecoveryPosition;
  const expected=json("result").tabs.slice(1) as {name:string;layers:number;dirty:boolean}[];
  const device=new IndexedDbRecoveryStore({indexedDB:new IDBFactory()}),workspace=new EditorWorkspace();
  const server="wss://share.example/",file="f1",resume={handle:"handle",secret:"fixture-client-secret"};
  await device.onlineFiles("owner",()=>[{file,server,name:"Homepage",created:1,opened:1}]);
  await device.writeWorkspace("owner",{active:0,files:[blob("stored")],online:[{...stored,server,file,resume}]});
  const capture=new WorkspaceRecovery(workspace,device,"owner",()=>{});
  await capture.start();
  const guest={connection:"c",file,openedAsOwner:true as const,access:"edit" as const,room:current.room,client:current.client};
  const host:OnlineInvitations={beginOwned:vi.fn(async()=>({connection:"c",completed:Promise.resolve({session:guest,archive:blob("server")})})),
    showJoin(){},leave:async()=>{},subscribe:()=>()=>{},copyPublished:async()=>{},recoveryKey:()=>resume,
    inspect:()=>({link:"",url:"",address:server,network:true,published:{file,server,name:"Homepage",owner:null,edit:"",view:"",expires:null}})};
  const unavailable=async()=>{throw new Error("Unexpected listing request");};
  const online=new OnlineWorkspace(workspace,{server,device,invitations:host,store:{owned:unavailable,open:unavailable,
    publish:unavailable,rename:unavailable,remove:unavailable}},"owner",()=>true);
  workspace.setInvitations(host);
  workspace.setOnlineWorkspace(online);
  let stop:undefined|(()=>void);
  const batches:LiveAccepted[]=[];
  try {
    const receipt=await workspace.activeEngine!.executeAsync("collab.recoverFile",{
      path:"recovery://workspace/0",server,file,session:stored.room,client:stored.client,seq:stored.sequence,secret:resume.secret,
    });
    expect(receipt).toEqual({session:1,status:"connecting"});
    await vi.waitFor(()=>expect(workspace.getSnapshot().some(t=>t.guest)).toBe(true));
    expect(host.beginOwned).toHaveBeenCalledWith(file,false,expect.objectContaining({name:"Homepage"}),true,resume);
    const engine=workspace.activeEngine!;
    const transport:LiveTransport={identity:current,archive:blob("server"),read:async after=>({
      client:current.client,access:"edit",reset:after===null,checkpointSeq:current.sequence,sequence:batches.at(-1)?.sequence ?? current.sequence,
      lastBatch:batches.at(-1)?.batch ?? "0",refused:[],batches:batches.filter(b=>BigInt(b.sequence)>BigInt(after ?? current.sequence)),
    }),submit:async(batch,_base,changes)=>{
      const sequence=String(BigInt(current.sequence)+BigInt(batches.length)+1n);
      batches.push({batch,sequence,client:current.client,changes:[...changes]});
      return {decision:"accepted",sequence,refused:false};
    }};
    const peer=new LivePeer({current:()=>engine.liveDrawing(),receive:d=>engine.receiveLiveDocument(d),interacting:()=>false,
      recover:(d,p,access)=>workspace.recoverSessionDrawing("c",d,p,access),installed:p=>workspace.installedSessionPosition("c",p),
      subscribe:engine.subscribe,normalise:(_before,after)=>after,history:h=>engine.setLiveHistory(h)},transport,current.client,()=>{});
    stop=peer.start();
    await vi.waitFor(()=>expect(workspace.savedOnlineFiles).toHaveLength(0));
    const actual=workspace.engines.map(e=>{const doc=e.liveDrawing();return {name:doc.name,layers:layers(doc)};});
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expected.map(({name,layers})=>({name,layers})));
    if(expected.length===1 && expected[0].dirty)await vi.waitFor(()=>expect(batches).toHaveLength(1));
    else expect(batches).toHaveLength(0);
    await capture.flush();
    expect((await device.readWorkspace("owner"))?.files).toHaveLength(expected.length);
  } finally {stop?.();capture.dispose();device.close();}
});

it.each(["forgotten","unreachable"] as const)("keeps the whole dirty recovery on %s and retries a failed atomic replacement",async failure=>{
  const title=failure==="forgotten" ? "without_its_record_the_copy_opens_as_any_other" : "a_copy_whose_server_cant_be_reached_opens_as_any_other";
  const blob=new Blob([new Uint8Array(fixtures[title+"/stored.figcraft"])]);
  const server="wss://share.example/",file="f1",resume={handle:"h",secret:"s"};
  const device=new IndexedDbRecoveryStore({indexedDB:new IDBFactory()}),workspace=new EditorWorkspace();
  await device.writeWorkspace("owner",{active:0,files:[blob],online:[{server,file,room:"1",client:1,sequence:"1",resume}]});
  if(failure==="unreachable")await device.onlineFiles("owner",()=>[{file,server,name:"Homepage",created:1,opened:1}]);
  const capture=new WorkspaceRecovery(workspace,device,"owner",()=>{});
  await capture.start();
  const unavailable=async()=>{throw new Error("Unable to reach server");};
  const invitations:OnlineInvitations={beginOwned:vi.fn(unavailable),showJoin(){},copyPublished:unavailable,leave:async()=>{},subscribe:()=>()=>{}};
  const online=new OnlineWorkspace(workspace,{server,device,invitations,store:{owned:unavailable,open:unavailable,
    publish:unavailable,rename:unavailable,remove:unavailable}},"owner",()=>true);
  workspace.setInvitations(invitations);
  try {
    await online.restoreSaved(()=>true);
    expect(workspace.getSnapshot()).toEqual([expect.objectContaining({active:true,dirty:true,name:"Homepage"})]);
    expect(layers(workspace.activeEngine!.liveDrawing())).toBe(failure==="forgotten" ? 1 : 2);
    expect(invitations.beginOwned).toHaveBeenCalledTimes(failure==="forgotten" ? 0 : 1);
    vi.spyOn(device,"writeWorkspace").mockRejectedValueOnce(new Error("Device storage full"));
    await capture.flush();
    const retained=await device.readWorkspace("owner");
    expect(retained?.online?.[0]?.resume).toEqual(resume);
    expect(await retained?.files[0].arrayBuffer()).toEqual(await blob.arrayBuffer());
    await capture.flush();
    const replacement=await device.readWorkspace("owner");
    expect(replacement?.online).toBeUndefined();
    expect(replacement?.files).toHaveLength(1);
  } finally {capture.dispose();device.close();}
});

it.each(["before welcome","after welcome","close live target"] as const)("closes a tab during recovery: %s",async timing=>{
  const workspace=new EditorWorkspace(), file="f1", connection="recovering";
  const sample=Object.keys(fixtures).find(key=>key.endsWith("/server.figcraft"))!;
  const server=new File([new Uint8Array(fixtures[sample])],"server.figcraft");
  await workspace.restore([server],0,()=>false);
  const leave=vi.fn(async()=>{});
  const host:OnlineInvitations={showJoin(){},copyPublished:async()=>{},leave,subscribe:()=>()=>{}};
  workspace.setInvitations(host);
  const session=workspace.beginRecorded(connection,"wss://share.example",file,host);
  workspace.waitForRecoveredFile(connection,workspace.getSnapshot()[0].id,{room:"1",client:1,sequence:"1"});
  if(timing!=="before welcome"){
    await workspace.open(server,{file,connection,access:"edit",client:1,room:"1",openedAsOwner:true});
    expect(workspace.activeEngine!.getSnapshot().editable).toBe(false);
  }
  workspace.execute("file.close",{index:timing==="close live target" ? 1 : 0,force:true});
  if(timing==="before welcome"){
    expect(leave).toHaveBeenCalledWith(connection);
    expect(workspace.wantsRecorded(connection,session)).toBe(false);
  }else{
    expect(workspace.getSnapshot()).toHaveLength(1);
    expect(workspace.activeEngine!.getSnapshot().editable).toBe(true);
    expect(Boolean(workspace.getSnapshot()[0].guest)).toBe(timing==="after welcome");
    expect(workspace.recoverySource("recovery://workspace/0")).toBeUndefined();
  }
});

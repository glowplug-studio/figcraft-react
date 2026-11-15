import {createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import {createBrowserClient} from "@supabase/ssr";
import {browserOnlineHost} from "../../examples/nextjs/lib/sharing/browser-online-host";
import {Editor,EditorWorkspace,IndexedDbRecoveryStore,OnlineWorkspace,type IdentityAdapter} from "@glowplug-studio/figcraft-react";
import {BrowserInvitations} from "../../examples/nextjs/lib/sharing/browser-invites";

const unexpected=async()=>{throw new Error("An online directory command contacted the listing store");};
const store={open:unexpected,owned:unexpected,publish:unexpected,rename:unexpected,remove:unexpected,teamDirectory:unexpected};

/** Inspect the authenticated preview's persisted device state from a fresh embedded editor. */
export async function cachedDirectory(principal:string,server:string) {
  const device=new IndexedDbRecoveryStore();
  try{
    const workspace=new EditorWorkspace();
    workspace.setOnlineWorkspace(new OnlineWorkspace(workspace,{server,device,store},principal,()=>true));
    return await workspace.activeEngine!.executeAsync("collab.files");
  }finally{device.close();}
}

/** Use the editor's actual device record, browser invite adapter and authenticated join endpoint. */
export function recordedEditor(principal:string,server:string) {
  const device=new IndexedDbRecoveryStore(),workspace=new EditorWorkspace();
  const invitations=new BrowserInvitations(device,principal,server,()=>()=>{},()=>{},()=>{});
  workspace.setInvitations(invitations);
  workspace.setOnlineWorkspace(new OnlineWorkspace(workspace,{server,device,store,invitations},principal,()=>true));
  return {
    open:(file:string)=>workspace.activeEngine!.executeAsync("collab.openFile",{file}),
    list:()=>workspace.activeEngine!.executeAsync("collab.files"),
    tabs:()=>workspace.getSnapshot().map(({active,index})=>({active,index})),
    switchAway:()=>workspace.execute("doc.switch",{index:0}),
    close:async()=>{
      try{
        for(const tab of workspace.getSnapshot())if(tab.guest)await invitations.leave(tab.guest.connection);
      }finally{workspace.setEditable(false);device.close();}
    },
  };
}

/** Exercise public commands with the same authorised provider and device store as the Next.js host. */
export async function publicationEditor(principal:string,server:string,key:string) {
  const device=new IndexedDbRecoveryStore(),workspace=new EditorWorkspace();
  const client=createBrowserClient(server,key);
  const host=browserOnlineHost(client,device,principal,server,()=>{},()=>{});
  const online=new OnlineWorkspace(workspace,host,principal,()=>true);
  workspace.setOnlineWorkspace(online);
  workspace.setInvitations(host.invitations,undefined,id=>online.leaveTab(id));
  const unsub=host.invitations.subscribe(async(session,bytes)=>{
    await workspace.open(new File([bytes],"joined.figcraft"),session);
  },(connection,error)=>workspace.joining(connection,error));
  let mounted:Root|undefined,container:HTMLElement|undefined,stopLive:(()=>void)|undefined;
  return {
    command:(name:string,params:Record<string,unknown>={})=>workspace.activeEngine!.executeAsync(name,params),
    state:()=>{
      const snapshot=workspace.activeEngine!.getSnapshot();
      return {document:JSON.stringify(snapshot.document),selection:[...snapshot.selection],tool:snapshot.tool,
        canUndo:snapshot.canUndo,canRedo:snapshot.canRedo,editable:snapshot.editable,dirty:snapshot.dirty,
        hasSaved:snapshot.hasSaved,previewVersionId:snapshot.previewVersionId??null};
    },
    // Render the actual public Editor for local command/UI assertions. Live cases use the explicit subscription below.
    mount:()=>{
      if(mounted)throw new Error("The command fixture is already mounted");
      container=document.createElement("section");container.setAttribute("aria-label","Embedded public command editor");
      Object.assign(container.style,{position:"fixed",inset:"0",zIndex:"100000",background:"white"});
      document.body.append(container);
      const snapshot={status:"authenticated" as const,principal:{id:principal},revision:"fixture"};
      const identity:IdentityAdapter={getSnapshot:()=>snapshot,subscribe:()=>()=>{}};
      mounted=createRoot(container);
      mounted.render(createElement(Editor,{engine:workspace.activeEngine!,identity,capabilities:["document.edit"]}));
    },
    setReadOnly:(readOnly:boolean)=>workspace.activeEngine!.setEditable(!readOnly),
    // Wire the real ordered peer as WorkspaceEditor's GuestSubscription does, without inventing live-history state.
    startLive:()=>{
      if(stopLive)throw new Error("The command fixture already has a live subscription");
      const engine=workspace.activeEngine!,guest=workspace.getSnapshot().find(tab=>tab.active)?.guest;
      const transport=guest&&host.invitations.live(guest.connection),client=transport?.identity?.client??guest?.client;
      if(!guest || !transport || !client)throw new Error("The command fixture has no joined live transport");
      const connection=guest.connection;
      const peer=new LivePeer({current:()=>engine.liveDrawing(),welcome:d=>workspace.confirmedSessionDrawing(connection,d),
        installed:p=>workspace.installedSessionPosition(connection,p),recover:(replica,p,access)=>workspace.recoverSessionDrawing(connection,replica,p,access),
        mergeStranded:(d,id)=>workspace.mergeStrandedDrawing(connection,d,id),receive:(d,restartedClient)=>engine.receiveLiveDocument(d,restartedClient),
        recordsEdit:d=>engine.recordsLiveEdit(d),normalise:(before,after,touched)=>engine.repairLiveDocument(before,after,touched),
        subscribe:engine.subscribe,interacting:()=>engine.interacting,history:h=>engine.setLiveHistory(h)},transport,client,()=>{});
      const stopPeer=peer.start();
      const stopWatch=host.invitations.watch(connection,reason=>{
        const session=workspace.getSnapshot().find(tab=>tab.guest?.connection===connection)?.guest;
        if(session)workspace.setGuestSession({...session,ended:reason});
      },status=>{
        const session=workspace.getSnapshot().find(tab=>tab.guest?.connection===connection)?.guest;
        if(session && !session.ended)workspace.setGuestSession("attempt" in status?{...session,reconnectAttempt:status.attempt}
          :{...session,reconnectAttempt:undefined,...status});
      });
      stopLive=()=>{stopWatch();stopPeer();};
    },
    peers:()=>workspace.activeEngine!.execute("collab.peers"),
    editable:()=>workspace.activeEngine!.getSnapshot().editable,
    close:async()=>{
      stopLive?.();mounted?.unmount();container?.remove();
      try{for(const tab of workspace.getSnapshot())if(tab.guest)await host.invitations.leave(tab.guest.connection);}
      finally{unsub();host.invitations.dispose();workspace.setEditable(false);device.close();}
    },
  };
}

import {createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import {LivePeople} from "../../src/engine/sharing/live-people";
import {createBrowserClient} from "@supabase/ssr";
import {browserOnlineHost} from "../../examples/nextjs/lib/sharing/browser-online-host";
import {Editor,EditorWorkspace,IndexedDbRecoveryStore,OnlineWorkspace,type IdentityAdapter,type OnlineGuestSession,type OnlineOwnerSharing,type OwnerShareSummary} from "@glowplug-studio/figcraft-react";
import {OwnerShareControls} from "../../src/OwnerShareControls";
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

/** Mount the real Share controls over a provider-neutral share whose server hands out only `roles`.
 * This checks the controls against an older or partial group; it is not the bundled host or a stored device record. */
export function shareControls(roles:readonly OnlineGuestSession["access"][],codes=true,refusing?:OnlineGuestSession["access"]) {
  type Access=OnlineGuestSession["access"];
  const order:readonly Access[]=["edit","comment","view"];
  let access:Access="edit",shared=true;
  const selections:Access[]=[],copies:string[]=[],changes:boolean[]=[];
  const summary=():OwnerShareSummary=>({
    codes:shared && codes ? Object.fromEntries(roles.map(role=>[role,"CODE-"+role.toUpperCase()])) : {},
    available:shared ? order.filter(role=>roles.includes(role)) : [],
  });
  const sharing:OnlineOwnerSharing={read:async()=>summary(),access:()=>access,
    selectAccess(_file,next){
      if(next===refusing || !roles.includes(next))throw new Error("This share cannot give that access");
      selections.push(next);access=next;
    },
    change:async(_file,enabled)=>{changes.push(enabled);shared=enabled;return summary();},
    copy:async(_file,role,format)=>{copies.push(format+":"+role);}};
  const container=document.createElement("section");container.setAttribute("aria-label","Embedded share controls");
  Object.assign(container.style,{position:"fixed",inset:"0",zIndex:"100000",background:"white",padding:"16px"});
  document.body.append(container);
  const root=createRoot(container);
  root.render(createElement(OwnerShareControls,{sharing,file:"fixture-file"}));
  return {selections:()=>[...selections],copies:()=>[...copies],changes:()=>[...changes],access:()=>access,
    close:()=>{root.unmount();container.remove();}};
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
  let room:LivePeople|undefined,stopPeople:(()=>void)|undefined,releasePeople:(()=>void)|undefined,welcomePeople:(()=>void)|undefined;
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
    // Wire the real presence transport as WorkspaceEditor does. `hold` withholds the provider's own
    // subscribed callback, which stands in for a host that does not (yet) read signals.
    startPeople:(hold:boolean)=>{
      if(room)throw new Error("The command fixture already has a presence room");
      const engine=workspace.activeEngine!,guest=workspace.getSnapshot().find(tab=>tab.active)?.guest;
      const transport=guest&&host.invitations.live(guest.connection),people=transport?.people,client=transport?.identity?.client??guest?.client;
      if(!people || !client)throw new Error("The command fixture has no joined presence transport");
      let released=!hold,pending:(()=>void)|undefined;
      room=new LivePeople({capture:cursor=>engine.capturePresence(cursor),name:()=>engine.commentName,
        subscribe:changed=>engine.subscribe(changed),follow:other=>engine.followViewport(other.presence.viewport)},{
        get welcome(){return people.welcome;},send:sample=>people.send(sample),
        listen:(receive,ready)=>people.listen(receive,()=>{if(released)ready();else pending=ready;}),
      },client);
      // The package build and this source import declare the same class separately; only its private fields differ nominally.
      engine.setPeople(room as unknown as Parameters<typeof engine.setPeople>[0]);room.setActive(true);
      const leave=room.start();
      stopPeople=()=>{leave();engine.setPeople(undefined);};
      releasePeople=()=>{released=true;pending?.();pending=undefined;};
      welcomePeople=()=>room!.welcome(people.welcome);
    },
    releasePeople:()=>releasePeople!(),
    reconnectPeople:()=>room!.reconnect(),
    welcomePeople:()=>welcomePeople!(),
    presence:()=>({signals:room!.signals,chat:room!.cursorChat,spotlighting:room!.spotlighting}),
    peers:()=>workspace.activeEngine!.execute("collab.peers"),
    editable:()=>workspace.activeEngine!.getSnapshot().editable,
    close:async()=>{
      stopPeople?.();stopLive?.();mounted?.unmount();container?.remove();
      try{for(const tab of workspace.getSnapshot())if(tab.guest)await host.invitations.leave(tab.guest.connection);}
      finally{unsub();host.invitations.dispose();workspace.setEditable(false);device.close();}
    },
  };
}

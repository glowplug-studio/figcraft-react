import {createBrowserClient} from "@supabase/ssr";
import {browserOnlineHost} from "../../examples/nextjs/lib/sharing/browser-online-host";
import {EditorWorkspace,IndexedDbRecoveryStore,OnlineWorkspace} from "@glowplug-studio/figcraft-react";
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
  return {
    command:(name:string,params:Record<string,unknown>={})=>workspace.activeEngine!.executeAsync(name,params),
    peers:()=>workspace.activeEngine!.execute("collab.peers"),
    editable:()=>workspace.activeEngine!.getSnapshot().editable,
    close:async()=>{
      try{for(const tab of workspace.getSnapshot())if(tab.guest)await host.invitations.leave(tab.guest.connection);}
      finally{unsub();host.invitations.dispose();workspace.setEditable(false);device.close();}
    },
  };
}

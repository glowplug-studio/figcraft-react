import {EditorWorkspace,IndexedDbRecoveryStore,OnlineWorkspace} from "@glowplug-studio/figcraft-react";

/** Inspect the authenticated preview's persisted device state from a fresh embedded editor. */
export async function cachedDirectory(principal:string,server:string) {
  const device=new IndexedDbRecoveryStore();
  const unavailable=async()=>{throw new Error("A cached listing contacted the server");};
  try{
    const workspace=new EditorWorkspace();
    workspace.setOnlineWorkspace(new OnlineWorkspace(workspace,{server,device,store:{
      open:unavailable,owned:unavailable,publish:unavailable,rename:unavailable,remove:unavailable,teamDirectory:unavailable,
    }},principal,()=>true));
    return await workspace.activeEngine!.executeAsync("collab.files");
  }finally{device.close();}
}

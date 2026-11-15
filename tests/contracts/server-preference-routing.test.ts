import {expect,it,vi} from "vitest";
import {IDBFactory} from "fake-indexeddb";
import {IndexedDbRecoveryStore} from "../../src/backends/browser/recovery";
import type {OnlineFileInfo,OnlineInvitations,OnlineWorkspaceHost,SessionDetails} from "../../src/backends/online-files";
import {EditorWorkspace} from "../../src/engine/workspace";
import {OnlineWorkspace} from "../../src/engine/sharing/online-workspace";
import {OnlineServerPreference} from "../../src/engine/sharing/server-preference";
import {parseSessionInvite} from "../../src/engine/sharing/invite";

function configuredServers(){
  const workspace=new EditorWorkspace(),device=new IndexedDbRecoveryStore({indexedDB:new IDBFactory()});
  const preference=new OnlineServerPreference("wss://a.example/");
  const unavailable=async()=>{throw new Error("Unexpected network request");};
  function adapter(server:string){
    const grants=new Map<string,SessionDetails>();
    let joins=0;
    const beginJoin=vi.fn((input:string)=>{
      parseSessionInvite(input);
      return {connection:server+"-join-"+(++joins),completed:new Promise<void>(()=>{})};
    });
    const invitations:OnlineInvitations={showJoin(){},leave:vi.fn(async()=>{}),copyPublished:unavailable,
      subscribe:vi.fn(()=>()=>{}),beginJoin,inspect:key=>grants.get(key),
      joinOwned:vi.fn(async(file,_managed,listing,_recorded,connection)=>{
        const key=connection ?? server+"-owned";
        grants.set(key,{network:true,address:server,url:"",link:"fixture",published:{server,file,name:listing!.name,
          owner:null,edit:"fixture-edit",view:"fixture-view",expires:null}});
        return {session:{connection:key,file,client:1,room:"1",access:"edit" as const},archive:new Blob()};
      })};
    const publish=vi.fn(async(id:string,_snapshot:Blob,key?:string):Promise<OnlineFileInfo>=>({
      id,name:"Drawing",created:"2026-01-01T00:00:00Z",...(key && {managedByKey:true}),
    }));
    const host={server,device,serverPreference:preference,supportsServerKey:true,invitations,
      retainOperatorKey:vi.fn(),sharing:{read:async()=>({codes:{}}),change:vi.fn(async()=>({codes:{}})),copy:unavailable},
      store:{publish,owned:unavailable,open:unavailable,rename:unavailable,remove:unavailable}};
    return {host,publish,beginJoin};
  }
  const a=adapter("https://a.example"),b=adapter("https://b.example");
  const forServer=vi.fn((address:string):OnlineWorkspaceHost|undefined=>address==="https://b.example"?b.host:undefined);
  const online=new OnlineWorkspace(workspace,{...a.host,forServer},"owner",()=>true);
  workspace.setInvitations(a.host.invitations);workspace.setOnlineWorkspace(online);
  return {workspace,device,preference,online,a,b,forServer};
}

// Native engine/src/live_share_tests.rs preference routing; ui-egui/src/live_share_tests.rs key isolation.
it("routes a newly selected server to its configured adapter without forwarding the first server's key",async()=>{
  const {workspace,device,online,a,b,preference}=configuredServers(),engine=workspace.activeEngine!;
  try{
    online.setServerKey("OnlyAKey");
    engine.execute("pref.publishServer",{url:"wss://b.example/"});
    const selected=online.preferred();
    expect(selected).not.toBe(online);expect(selected.serverPreference).toBe(preference);
    expect(selected.serverKey).toBe("");expect(online.serverKey).toBe("OnlyAKey");
    await engine.executeAsync("collab.share");
    await vi.waitFor(()=>expect(engine.execute("collab.peers").status).toBe("live"));
    expect(a.publish).not.toHaveBeenCalled();expect(b.publish).toHaveBeenCalledOnce();
    expect(b.publish.mock.calls[0]).toHaveLength(2);
    expect(b.host.retainOperatorKey).not.toHaveBeenCalled();
    const registry=await device.onlineRegistry("owner");
    expect(registry.files).toEqual([expect.objectContaining({server:"https://b.example"})]);
    engine.execute("pref.publishServer",{url:""});
    expect(()=>online.preferred()).toThrow(/online sharing is off/i);
    engine.execute("pref.publishServer");
    expect(online.preferred()).toBe(online);
    expect(online.destination("wss://a.example/")).toBe(online);
    expect(online.destination("wsS://a.example:443/")).toBe(online);
    expect(online.serverKey).toBe("OnlyAKey");
  }finally{online.disposeInvitations();device.close();}
});

it("uses a typed key only for its original adapter, including after reset and transport-equivalent addresses",async()=>{
  const {workspace,device,online,a,b}=configuredServers(),engine=workspace.activeEngine!;
  try{
    online.setServerKey("OnlyAKey");
    engine.execute("pref.publishServer",{url:"wss://a.example:443/"});
    await online.preferred().publish(workspace.getSnapshot()[0].id,"Drawing");
    expect(a.publish).toHaveBeenCalledOnce();expect(a.publish.mock.calls[0][2]).toBe("OnlyAKey");
    workspace.execute("file.new");
    workspace.activeEngine!.execute("pref.publishServer",{url:"wss://b.example/"});
    await online.preferred().publish(workspace.getSnapshot()[1].id,"Drawing");
    expect(b.publish).toHaveBeenCalledOnce();expect(b.publish.mock.calls[0]).toHaveLength(2);
    expect(b.host.retainOperatorKey).not.toHaveBeenCalled();
    workspace.execute("file.new");
    workspace.activeEngine!.execute("pref.publishServer",{url:""});
    expect(()=>online.preferred()).toThrow(/online sharing is off/i);
    workspace.activeEngine!.execute("pref.publishServer");
    await online.preferred().publish(workspace.getSnapshot()[2].id,"Drawing");
    expect(a.publish).toHaveBeenCalledTimes(2);expect(a.publish.mock.calls[1][2]).toBe("OnlyAKey");
    expect(b.publish).toHaveBeenCalledOnce();
  }finally{online.disposeInvitations();device.close();}
});

it("refuses an unsupported selected server before registry, publication or join requests",async()=>{
  const {workspace,device,online,a,b}=configuredServers(),engine=workspace.activeEngine!;
  const registry=vi.spyOn(device,"onlineRegistry");
  try{
    engine.execute("pref.publishServer",{url:"wss://unsupported.example/"});
    await expect(engine.executeAsync("collab.share")).rejects.toThrow("unavailable in the current host");
    expect(()=>engine.execute("collab.join",{code:"K7M-2QX-9TD"})).toThrow("unavailable in the current host");
    expect(registry).not.toHaveBeenCalled();
    expect(a.publish).not.toHaveBeenCalled();expect(b.publish).not.toHaveBeenCalled();
    expect(a.beginJoin).not.toHaveBeenCalled();expect(b.beginJoin).not.toHaveBeenCalled();
    expect(engine.execute("collab.peers").sessions).toEqual([]);
    expect(engine.getSnapshot().editable).toBe(true);
  }finally{online.disposeInvitations();device.close();}
});

// Native engine/src/live_share_tests.rs::joining_takes_a_code_of_either_kind_or_a_link.
it("resolves bare codes through the selected adapter and keeps explicit supported links usable while off",()=>{
  const {workspace,device,online,a,b}=configuredServers(),engine=workspace.activeEngine!;
  try{
    engine.execute("pref.publishServer",{url:"wss://b.example/"});
    expect(engine.execute("collab.join",{code:"  k7m 2qx 9td \n"})).toMatchObject({status:"connecting"});
    expect(a.beginJoin).not.toHaveBeenCalled();
    expect(b.beginJoin).toHaveBeenCalledExactlyOnceWith("figcraft://join?server=wss://b.example/&code=K7M2QX9TD");
    engine.execute("pref.publishServer",{url:""});
    expect(()=>engine.execute("collab.join",{code:"K7M-2QX-9TD"})).toThrow(/online sharing is off/i);
    expect(b.beginJoin).toHaveBeenCalledOnce();
    const explicit="wss://b.example/?file=drawing&token=TokenTokenToken0";
    expect(engine.execute("collab.join",{link:explicit})).toMatchObject({status:"connecting"});
    expect(b.beginJoin).toHaveBeenLastCalledWith(explicit);
    const primary="figcraft://join?server=wss://a.example/&file=drawing&token=TokenTokenToken0";
    engine.execute("collab.join",{link:primary});
    expect(a.beginJoin).toHaveBeenCalledExactlyOnceWith(primary);
    expect(engine.serverPreference.getSnapshot().url).toBe("");
    expect(()=>engine.execute("collab.join",{link:"wss://unsupported.example/?file=drawing&token=TokenTokenToken0"})).toThrow("unavailable in the current host");
    expect(b.beginJoin).toHaveBeenCalledTimes(2);expect(a.beginJoin).toHaveBeenCalledOnce();
  }finally{online.disposeInvitations();device.close();}
});

// Direct UI publication has no public-command session reservation to supply the host.
it("keeps direct publication and replacement sessions bound to their selected transport",async()=>{
  const {workspace,device,online,a,b}=configuredServers(),engine=workspace.activeEngine!;
  const tab=workspace.getSnapshot()[0].id;
  try{
    const first=await online.publishTo(tab,"Drawing","wss://a.example/");
    const firstConnection=workspace.getSnapshot()[0].guest!.connection;
    expect(workspace.sessionInvitations(firstConnection)).toBe(a.host.invitations);
    const second=await online.publishTo(tab,"Drawing","wss://b.example/");
    const secondConnection=workspace.getSnapshot()[0].guest!.connection;
    expect(workspace.sessionInvitations(secondConnection)).toBe(b.host.invitations);
    expect(engine.execute("collab.peers").published).toMatchObject({server:b.host.server,file:second.id});
    expect(a.host.invitations.leave).toHaveBeenCalledExactlyOnceWith(firstConnection);
    expect(b.host.invitations.leave).not.toHaveBeenCalled();
    expect(online.publishedFile(tab)).toBeUndefined();
    expect(online.forTab(tab).publishedFile(tab)).toBe(second.id);
    expect(first.id).not.toBe(second.id);
    const third=await online.publishTo(tab,"Drawing","wss://a.example/");
    expect(online.forTab(tab)).toBe(online);
    expect(online.publishedFile(tab)).toBe(third.id);
    expect(b.host.invitations.leave).toHaveBeenCalledExactlyOnceWith(secondConnection);
    expect(engine.execute("collab.peers").published).toMatchObject({server:a.host.server,file:third.id});
    engine.execute("collab.leave");
    expect(a.host.invitations.leave).toHaveBeenCalledTimes(2);
  }finally{online.disposeInvitations();device.close();}
});

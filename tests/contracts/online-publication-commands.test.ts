import {expect,it,vi} from "vitest";
import native from "../fixtures/native-online-publication-commands.json";
import {IDBFactory} from "fake-indexeddb";
import {IndexedDbRecoveryStore} from "../../src/backends/browser/recovery";
import type {OnlineFileInfo,OnlineInvitations,OnlineOwnerSharing,SessionDetails} from "../../src/backends/online-files";
import {EditorWorkspace} from "../../src/engine/workspace";
import {OnlineWorkspace} from "../../src/engine/sharing/online-workspace";

it("matches native stop receipts on an idle tab, a shared file and its remaining owner session",async()=>{
  const workspace=new EditorWorkspace(),engine=workspace.activeEngine!;
  const unavailable=async()=>{throw new Error("Unexpected network operation");};
  let shared=true;
  const change=vi.fn(async(_file:string,enabled:boolean)=>{shared=enabled;return {codes:{}};});
  const sharing:OnlineOwnerSharing={read:async()=>({codes:shared ? {edit:"K7M-2QX-9TD"} : {}}),change,copy:unavailable};
  const published={server:"https://share.example",file:"f1",name:"Untitled",owner:null,edit:"fixture-edit",view:"fixture-view",expires:null};
  const leave=vi.fn(async()=>{});
  const invitations:OnlineInvitations={showJoin(){},leave,subscribe:()=>()=>{},copyPublished:unavailable,
    inspect:()=>({address:published.server,url:"",link:"",network:true,published})};
  const host={server:published.server,sharing,invitations,device:{onlineFiles:unavailable,onlineRegistry:unavailable},
    store:{publish:unavailable,owned:unavailable,open:unavailable,rename:unavailable,remove:unavailable}};
  workspace.setOnlineWorkspace(new OnlineWorkspace(workspace,host,"owner",()=>true));
  workspace.setInvitations(invitations);
  expect(await engine.executeAsync("collab.stop")).toEqual(native.initialStop);
  workspace.attachGuestSession(workspace.getSnapshot()[0].id,{file:"f1",connection:"owner",access:"edit",openedAsOwner:true});
  change.mockRejectedValueOnce(new Error("unavailable"));
  await expect(engine.executeAsync("collab.stop")).rejects.toThrow("the others can still get in");
  expect(shared).toBe(true);
  expect(await engine.executeAsync("collab.stop")).toEqual(native.stopShared);
  expect(leave).not.toHaveBeenCalled();
  expect(engine.execute("collab.peers").status).toBe(native.afterStop.status);
  expect(shared).toBe(false);
  expect(await engine.executeAsync("collab.stop")).toEqual(native.leaveUnshared);
  expect(leave).toHaveBeenCalledExactlyOnceWith("owner");
  expect(engine.getSnapshot().editable).toBe(true);
});

function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
function publicationHost(){
  const workspace=new EditorWorkspace(),device=new IndexedDbRecoveryStore({indexedDB:new IDBFactory()});
  const gate=deferred<void>(),grants=new Map<string,SessionDetails>();
  const server="https://share.example",unavailable=async()=>{throw new Error("Unexpected request");};
  const store={publish:vi.fn(async(id:string,_snapshot:Blob,key?:string):Promise<OnlineFileInfo>=>{
    await gate.promise;
    return {id,name:"Poster",created:"2025-01-01T00:00:00Z",...(key && {managedByKey:true})};
  }),owned:unavailable,open:unavailable,rename:unavailable,remove:unavailable};
  const invitations:OnlineInvitations={showJoin(){},leave:vi.fn(async()=>{}),subscribe:()=>()=>{},copyPublished:unavailable,
    inspect:key=>grants.get(key),joinOwned:vi.fn(async(file,_key,meta,_recorded,key)=>{
      const connection=key ?? "fresh";
      grants.set(connection,{network:true,address:server,url:"",link:"fixture",published:{file,server,name:meta!.name,owner:null,edit:"fixture",view:"fixture-view",expires:null}});
      return {session:{connection,file,client:1,room:"1",access:"edit" as const},archive:new Blob()};
    })};
  const shareState:NonNullable<SessionDetails["share"]>={...native.afterStop.share,via:"online",access:"edit"};
  const sharing:OnlineOwnerSharing={read:async()=>({codes:{}}),selectAccess(_file,access){shareState.access=access;},
    change:vi.fn(async(file,on)=>{
      shareState.shared=on;
      for(const value of grants.values())if(value.published?.file===file)value.share=shareState;
      return {codes:{}};
    }),copy:unavailable};
  const host={server,device,store,invitations,sharing,supportsServerKey:true,retainOperatorKey:vi.fn()};
  workspace.setInvitations(invitations);
  const online=new OnlineWorkspace(workspace,host,"owner",()=>true);
  workspace.setOnlineWorkspace(online);
  return {workspace,device,store,gate,host,online};
}

it.each(["share","publish"] as const)("matches the native %s connecting receipt and locks only its source document",async action=>{
  const {workspace,device,store,gate,host}=publicationHost(),engine=workspace.activeEngine!;
  try{
    const params=action==="share" ? {} : {server:"wss://share.example/?key=fixture-key",key:"ignored",name:" Poster "};
    const receipt=await engine.executeAsync("collab."+action,params);
    expect(receipt).toEqual(native[action]);
    expect(engine.getSnapshot().editable).toBe(false);
    if(action==="share"){
      const next=await engine.executeAsync("collab.share",{access:"view"});
      expect(next).toMatchObject({session:1,share:{access:"view"},status:"connecting"});
    }
    workspace.execute("file.new");
    expect(workspace.activeEngine!.getSnapshot().editable).toBe(true);
    gate.resolve();
    await vi.waitFor(()=>expect(engine.execute("collab.peers")).toMatchObject({session:1,status:"live",document:0,readOnly:false}));
    expect(engine.getSnapshot().editable).toBe(true);
    expect(workspace.getSnapshot()[1].active).toBe(true);
    expect(store.publish).toHaveBeenCalledTimes(1);
    const file=store.publish.mock.calls[0][0];
    if(action==="share"){
      expect(engine.execute("collab.peers").share).toMatchObject({access:"view",shared:true});
      await engine.executeAsync("collab.share",{access:" CoMmEnT "});
      expect(engine.execute("collab.peers").share).toMatchObject({access:"comment",shared:true});
      expect(store.publish).toHaveBeenCalledTimes(1);
    }else{
      expect(store.publish.mock.calls[0][2]).toBe("fixture-key");
      expect(host.retainOperatorKey).toHaveBeenCalledWith(file,"fixture-key");
      expect((await engine.executeAsync("collab.files")).files).toEqual([]);
    }
  }finally{gate.resolve();device.close();}
});

it("refuses wrong endpoints and discards a late publication welcome after leave",async()=>{
  const {workspace,device,store,gate,host}=publicationHost(),engine=workspace.activeEngine!;
  try{
    await expect(engine.executeAsync("collab.publish",{server:"wss://elsewhere.example/"})).rejects.toThrow("unavailable");
    await expect(engine.executeAsync("collab.share",{via:"local",access:"comment"})).rejects.toThrow("comment code");
    expect(engine.getSnapshot().editable).toBe(true);
    expect(store.publish).not.toHaveBeenCalled();
    const receipt=await engine.executeAsync("collab.publish",{server:"wss://share.example/"});
    await vi.waitFor(()=>expect(store.publish).toHaveBeenCalledOnce());
    expect(engine.execute("collab.leave",{session:receipt.session})).toEqual({ended:true});
    gate.resolve();
    await vi.waitFor(async()=>expect((await engine.executeAsync("collab.files")).files).toHaveLength(1));
    expect(host.invitations.joinOwned).not.toHaveBeenCalled();
    expect(engine.execute("collab.peers").status).toBe("off");
    expect(engine.getSnapshot().editable).toBe(true);
  }finally{gate.resolve();device.close();}
});

it("retains the live owner when link creation fails after the server stored the file",async()=>{
  const {workspace,device,store,gate,host}=publicationHost(),engine=workspace.activeEngine!;
  try{
    vi.mocked(host.sharing.change).mockRejectedValueOnce(new Error("link limit reached"));
    const notices:string[]=[];
    workspace.setInvitations(host.invitations,message=>notices.push(message));
    await engine.executeAsync("collab.share");
    gate.resolve();
    await vi.waitFor(()=>expect(engine.execute("collab.peers")).toMatchObject({status:"live",share:{shared:false},session:1}));
    expect(notices.at(-1)).toContain("link limit reached");
    expect(engine.getSnapshot().editable).toBe(true);
    expect(store.publish).toHaveBeenCalledOnce();
    await engine.executeAsync("collab.share");
    expect(store.publish).toHaveBeenCalledOnce();
    expect(engine.execute("collab.peers").share?.shared).toBe(true);
  }finally{gate.resolve();device.close();}
});

it("replaces only the source session when publishing again during a held upload",async()=>{
  const {workspace,device,store,gate}=publicationHost(),engine=workspace.activeEngine!;
  try{
    const params={server:"wss://share.example/"};
    const first=await engine.executeAsync("collab.publish",params);
    await vi.waitFor(()=>expect(store.publish).toHaveBeenCalledTimes(1));
    const second=await engine.executeAsync("collab.publish",params);
    expect([first.session,second.session]).toEqual([1,2]);
    await vi.waitFor(()=>expect(store.publish).toHaveBeenCalledTimes(2));
    expect(store.publish.mock.calls[0][0]).not.toBe(store.publish.mock.calls[1][0]);
    gate.resolve();
    await vi.waitFor(()=>expect(engine.execute("collab.peers")).toMatchObject({status:"live",sessions:[{session:2,document:0}]}));
    expect(engine.getSnapshot().editable).toBe(true);
  }finally{gate.resolve();device.close();}
});

// Native engine/src/live_share_tests.rs::the_built_in_server_is_the_default_and_can_be_changed_or_turned_off.
it("shares the server preference across existing and new tabs without changing drawings or undo history",()=>{
  const {workspace,device,gate,online}=publicationHost(),first=workspace.activeEngine!;
  try{
    first.execute("shape.rectangle");
    const before=first.getSnapshot();
    workspace.execute("file.new");const second=workspace.activeEngine!,blank=second.getSnapshot();
    expect(first.execute("pref.publishServer",{url:" wss://other.example/ "})).toEqual({url:"wss://other.example/",default:"wss://share.example"});
    expect(first.serverPreference).toBe(online.serverPreference);
    expect(second.serverPreference).toBe(first.serverPreference);
    expect(second.serverPreference.getSnapshot().url).toBe("wss://other.example/");
    workspace.execute("file.new");const third=workspace.activeEngine!;
    expect(third.serverPreference).toBe(first.serverPreference);
    expect(third.serverPreference.getSnapshot().url).toBe("wss://other.example/");
    expect(first.getSnapshot().document).toBe(before.document);
    expect(first.getSnapshot().dirty).toBe(before.dirty);
    expect(second.getSnapshot().document).toBe(blank.document);
    expect(second.getSnapshot().dirty).toBe(blank.dirty);
    expect(second.execute("edit.undo")).toEqual({undone:false});
    expect(first.execute("edit.undo")).toEqual({undone:true});
    expect(first.execute("edit.undo")).toEqual({undone:false});
    expect(third.execute("pref.publishServer")).toEqual({url:"wss://share.example",default:"wss://share.example"});
    expect(first.serverPreference.getSnapshot().url).toBe("wss://share.example");
    expect(third.getSnapshot().dirty).toBe(false);
  }finally{gate.resolve();device.close();}
});

// Native engine/src/live_share_tests.rs::online_sharing_is_off_without_a_server.
it("refuses default sharing while off before staging or starting a session, but permits a one-shot explicit server",async()=>{
  const {workspace,device,store,gate,host}=publicationHost(),engine=workspace.activeEngine!;
  const registry=vi.spyOn(device,"onlineRegistry");
  try{
    engine.execute("pref.publishServer",{url:""});
    await expect(engine.executeAsync("collab.share")).rejects.toThrow(/online sharing is off/i);
    expect(registry).not.toHaveBeenCalled();
    expect(store.publish).not.toHaveBeenCalled();
    expect(host.invitations.joinOwned).not.toHaveBeenCalled();
    expect(engine.execute("collab.peers").sessions).toEqual([]);
    expect(engine.getSnapshot().editable).toBe(true);
    await engine.executeAsync("collab.share",{server:"wss://share.example/"});
    await vi.waitFor(()=>expect(store.publish).toHaveBeenCalledOnce());
    expect(engine.serverPreference.getSnapshot().url).toBe("");
    gate.resolve();
    await vi.waitFor(()=>expect(engine.execute("collab.peers").status).toBe("live"));
    expect(engine.serverPreference.getSnapshot().url).toBe("");
  }finally{gate.resolve();device.close();}
});

it("keeps an existing live share usable after the default is turned off",async()=>{
  const {workspace,device,store,gate,host}=publicationHost(),engine=workspace.activeEngine!;
  try{
    await engine.executeAsync("collab.share");gate.resolve();
    await vi.waitFor(()=>expect(engine.execute("collab.peers").status).toBe("live"));
    const session=engine.execute("collab.peers").session;
    engine.execute("pref.publishServer",{url:""});
    await engine.executeAsync("collab.share",{access:"view"});
    expect(engine.execute("collab.peers")).toMatchObject({session,status:"live",share:{access:"view",shared:true}});
    expect(store.publish).toHaveBeenCalledOnce();
    await engine.executeAsync("collab.stop");
    expect(engine.execute("collab.peers")).toMatchObject({session,status:"live",share:{shared:false}});
    expect(host.invitations.leave).not.toHaveBeenCalled();
    expect(engine.serverPreference.getSnapshot().url).toBe("");
  }finally{gate.resolve();device.close();}
});

it("still requires an explicit collab.publish server when a default server is selected",async()=>{
  const {workspace,device,store,gate}=publicationHost(),engine=workspace.activeEngine!;
  const registry=vi.spyOn(device,"onlineRegistry");
  try{
    expect(engine.serverPreference.getSnapshot().url).toBe("wss://share.example");
    await expect(engine.executeAsync("collab.publish")).rejects.toThrow("Give a server address");
    expect(registry).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();
    expect(engine.execute("collab.peers").status).toBe("off");
  }finally{gate.resolve();device.close();}
});

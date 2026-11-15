import {expect,it,vi} from "vitest";
import native from "../fixtures/native-online-publication-commands.json";
import {IDBFactory} from "fake-indexeddb";
import {IndexedDbRecoveryStore} from "../../src/backends/browser/recovery";
import type {OnlineFileInfo,OnlineInvitations,OnlineManagementAction,OnlineManagementResult,RememberedOnlineFile} from "../../src/backends/online-files";
import {EditorWorkspace} from "../../src/engine/workspace";
import {OnlineWorkspace} from "../../src/engine/sharing/online-workspace";

const server="https://share.example",keyed="https://share.example/?key=secret";
const unavailable=async():Promise<never>=>{throw new Error("Unexpected request");};
const record=(file="f1",address=server):RememberedOnlineFile=>({server:"https://share.example",file,name:"Original",created:1,opened:1,...(address!==server&&{recordedAddress:address})});

function fixture(files:readonly RememberedOnlineFile[]=[record()],management?: (file:string,request:OnlineManagementAction,context:{owner?:string;key?:string;recorded:boolean})=>Promise<OnlineManagementResult>, hostServer=server){
  const workspace=new EditorWorkspace(),device=new IndexedDbRecoveryStore({indexedDB:new IDBFactory()});
  const execute=vi.fn(management ?? (async()=>({done:true} as const)));
  const host={server:hostServer, supportsServerKey:true,device,
    management:{execute},
    store:{publish:unavailable,owned:unavailable,open:unavailable,rename:unavailable,remove:unavailable}};
  const invitations:OnlineInvitations={showJoin(){},leave:vi.fn(async()=>{}),subscribe:()=>()=>{},copyPublished:unavailable,
    inspect:(connection)=> connection.startsWith("same") ? {address:"wss://share.example:443/",url:"",link:"",network:true} :
      connection.startsWith("other") ? {address:"wss://other.example/",url:"",link:"",network:true} : undefined};
  workspace.setInvitations(invitations);
  workspace.setOnlineWorkspace(new OnlineWorkspace(workspace,host,"owner",()=>true));
  const setup=device.onlineRegistry("owner",current=>({...current,files}));
  const engine=workspace.activeEngine!;
  return {workspace,device,execute,engine,ready:setup,invitations};
}
async function command(env:ReturnType<typeof fixture>,params:Record<string,unknown>){await env.ready;return env.engine.executeAsync("collab.manageFile",params);}

it("matches native list and create-link receipts, including default and trimmed inputs",async()=>{
  const env=fixture(undefined,async(_file:string,request:OnlineManagementAction):Promise<OnlineManagementResult>=>{
    if(request.action==="links")return {links:[{id:"fixture-link-id",access:"view",label:"QA view",created:1730000000}]};
    if(request.action==="createLink")return {id:"fixture-link-id",access:request.access,link:"figcraft://join?server=wss://share.example:443/&file=f1&token=SyntheticTestLink001"};
    return {done:true};
  });
  try{
    expect(await command(env,{file:" f1 ",action:" links "})).toEqual(native.list);
    expect(await command(env,{file:"f1",action:"createLink",label:"QA view"})).toEqual(native.createDefault);
    expect(await command(env,{file:"f1",action:"createLink",access:" COMMENT ",label:"QA comment"})).toEqual(native.createComment);
    expect(env.execute.mock.calls.map(call=>call[1])).toEqual([
      {action:"links"},{action:"createLink",access:"view",label:"QA view"},{action:"createLink",access:"comment",label:"QA comment"},
    ]);
  }finally{env.device.close();}
});

function lastContext(env:ReturnType<typeof fixture>){
  const call=env.execute.mock.calls.at(-1);
  if(!call)throw new Error("Expected a management request");
  return call[2]!;
}

it("requires a unique recorded target unless explicit server and owner are supplied",async()=>{
  const absent=fixture([]);
  try{
    await expect(command(absent,{file:"f1",action:"links"})).rejects.toThrow();
    expect(absent.execute).not.toHaveBeenCalled();
    expect(await command(absent,{file:"f1",server,owner:"owner",action:"links"})).toEqual({done:true});
    expect(absent.execute).toHaveBeenCalledWith("f1",{action:"links"},{owner:"owner",key:undefined,recorded:false});
  }finally{absent.device.close();}
  const ambiguous=fixture([record("f1"),{...record("f1"),server:"https://second.example/"}]);
  try{await expect(command(ambiguous,{file:"f1",action:"links"})).rejects.toThrow();expect(ambiguous.execute).not.toHaveBeenCalled();}
  finally{ambiguous.device.close();}
});

it("forwards URL keys only for share and unshare",async()=>{
  const env=fixture([record("f1",keyed)]);
  try{
    for(const action of ["links","createLink","revoke","rename"] as const){
      const params:Record<string,unknown>={file:"f1",action};
      if(action==="revoke")params.link="link-id";
      if(action==="rename")params.name="Renamed";
      if(action==="createLink")params.access="view";
      await command(env,{...params,server:keyed,owner:"owner"});
      expect(lastContext(env).key).toBeUndefined();
    }
    await command(env,{file:"f1",server:keyed,owner:"owner",action:"share"});
    expect(lastContext(env).key).toBe("secret");
    await command(env,{file:"f1",server:keyed,owner:"owner",action:"unshare"});
    expect(lastContext(env).key).toBe("secret");
    await command(env,{file:"f1",server:keyed,owner:"owner",action:"remove"});
    expect(lastContext(env).key).toBeUndefined();
  }finally{env.device.close();}
});

it("rejects keyed cleartext targets before network access and refuses unrecorded unshare",async()=>{
  const env=fixture([],undefined,"http://share.example/");
  try{
    await expect(command(env,{file:"f1",server:"http://share.example/?key=secret",owner:"owner",action:"share"})).rejects.toThrow(/encrypted connection/i);
    await expect(command(env,{file:"f1",server:"http://127.0.0.1:3000/?key=secret",owner:"owner",action:"share"})).rejects.toThrow();
    await expect(command(env,{file:"f1",server:"http://share.example/",owner:"owner",action:"unshare"})).rejects.toThrow(/aren't recorded/);
    expect(env.execute).not.toHaveBeenCalled();
  }finally{env.device.close();}
});

it("renames only matching registry records after success and leaves them intact on failure",async()=>{
  const other:RememberedOnlineFile={...record(),server:"https://other.example"};
  const env=fixture([record(),other],async(_file,request)=>{
    if(request.action==="rename")return {done:true};
    return {done:true};
  });
  try{
    expect(await command(env,{file:"f1",server,owner:"owner",action:"rename",name:" New name "})).toEqual(native.rename);
    let rows=(await env.device.onlineRegistry("owner")).files;
    expect(rows.find(row=>row.server===record().server)?.name).toBe("New name");
    expect(rows.find(row=>row.server===other.server)?.name).toBe(other.name);
    env.execute.mockImplementationOnce(async()=>{throw new Error("rename failed");});
    await expect(command(env,{file:"f1",server,owner:"owner",action:"rename",name:"Nope"})).rejects.toThrow("rename failed");
    rows=(await env.device.onlineRegistry("owner")).files;
    expect(rows.find(row=>row.server===record().server)?.name).toBe("New name");
  }finally{env.device.close();}
});

it("matches native completion receipt for remove",async()=>{
  const env=fixture();
  try{expect(await command(env,{file:"f1",action:"remove"})).toEqual(native.remove);}
  finally{env.device.close();}
});

it("ends only live tabs for the removed server and file",async()=>{
  const env=fixture();
  try{
    const first=env.workspace.getSnapshot()[0];
    env.workspace.attachGuestSession(first.id,{file:"f1",connection:"same-owner",access:"edit"});
    env.workspace.execute("file.new");
    const second=env.workspace.getSnapshot()[1];
    env.workspace.attachGuestSession(second.id,{file:"unrelated",connection:"other-owner",access:"edit"});
    expect(await command(env,{file:"f1",action:"remove"})).toEqual(native.remove);
    expect(env.workspace.getSnapshot()[0].guest).toBeUndefined();
    expect(env.workspace.getSnapshot()[1].guest?.connection).toBe("other-owner");
    expect(env.invitations.leave).toHaveBeenCalledExactlyOnceWith("same-owner");
  }finally{env.device.close();}
});

it("ends an invite copy whose root cleartext server is reported as a bare host",async()=>{
  const env=fixture([{...record(),server:"http://share.example:3000"}],undefined,"http://share.example:3000/");
  try{
    env.invitations.inspect=()=>({address:"share.example:3000",url:"",link:"",network:true});
    const first=env.workspace.getSnapshot()[0];
    env.workspace.attachGuestSession(first.id,{file:"f1",connection:"same-invite",access:"edit"});
    expect(await command(env,{file:"f1",action:"remove"})).toEqual(native.remove);
    expect(env.workspace.getSnapshot()[0].guest).toBeUndefined();
    expect(env.invitations.leave).toHaveBeenCalledExactlyOnceWith("same-invite");
  }finally{env.device.close();}
});

it("preserves recorded files and live copies when removal is not acknowledged",async()=>{
  const env=fixture(undefined,async()=>{throw new Error("Removal acknowledgement lost");});
  try{
    await env.ready;
    const first=env.workspace.getSnapshot()[0];
    const guest={file:"f1",connection:"same-owner",access:"edit" as const};
    env.workspace.attachGuestSession(first.id,guest);
    const before=await env.device.onlineRegistry("owner");
    const engines=env.workspace.engines;
    await expect(command(env,{file:"f1",action:"remove"})).rejects.toThrow("Removal acknowledgement lost");
    expect(await env.device.onlineRegistry("owner")).toEqual(before);
    expect(env.workspace.getSnapshot()).toHaveLength(1);
    expect(env.workspace.engines[0]).toBe(engines[0]);
    expect(env.workspace.getSnapshot()[0].guest).toEqual(guest);
    expect(env.invitations.leave).not.toHaveBeenCalled();
  }finally{env.device.close();}
});

it("preserves the same file id on another server when removal succeeds",async()=>{
  const other={...record(),server:"https://other.example"};
  const env=fixture([record(),other]);
  try{
    const first=env.workspace.getSnapshot()[0];
    env.workspace.attachGuestSession(first.id,{file:"f1",connection:"same-owner",access:"edit"});
    env.workspace.execute("file.new");
    const second=env.workspace.getSnapshot()[1];
    const guest={file:"f1",connection:"other-owner",access:"edit" as const};
    env.workspace.attachGuestSession(second.id,guest);
    const engines=env.workspace.engines;
    expect(await command(env,{file:"f1",server,action:"remove"})).toEqual(native.remove);
    expect((await env.device.onlineRegistry("owner")).files).toEqual([other]);
    const tabs=env.workspace.getSnapshot();
    expect(tabs).toHaveLength(2);
    expect(env.workspace.engines[0]).toBe(engines[0]);
    expect(tabs[0].guest).toBeUndefined();
    expect(env.workspace.engines[1]).toBe(engines[1]);
    expect(tabs[1].guest).toEqual(guest);
    expect(env.invitations.leave).toHaveBeenCalledExactlyOnceWith("same-owner");
  }finally{env.device.close();}
});

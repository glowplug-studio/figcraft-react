import {afterEach,expect,it,vi} from "vitest";
import {BrowserInvitations} from "../../examples/nextjs/lib/sharing/browser-invites";
import {EditorEngine} from "../../src/engine/editor";
import {EditorWorkspace} from "../../src/engine/workspace";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import type {OnlineInvitations,OnlineGuestSession} from "../../src/backends/online-files";

afterEach(()=>vi.unstubAllGlobals());
const server="http://files.example";
const link="ws://files.example/?file=drawing&token=TokenTokenToken0";
function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}

it("starts independent joins, cancels either by numeric handle and releases a late physical grant",async()=>{
  vi.stubGlobal("window",new EventTarget());vi.stubGlobal("location",{hash:"",origin:"https://editor.example"});
  const requests:{connection:string;reply:ReturnType<typeof deferred<Response>>}[]=[],released:string[]=[];
  vi.stubGlobal("fetch",async (url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith("/leave")){released.push(body.connection);return new Response(null,{status:204});}
    const reply=deferred<Response>();requests.push({connection:body.tab,reply});return reply.promise;
  });
  const archive=await encodeFigcraftBlob(EditorEngine.newTab("Shared").getSnapshot().document);
  const workspace=new EditorWorkspace(),host=new BrowserInvitations({readPublishedLinks:async()=>undefined},"me",server,()=>()=>{},()=>{},()=>{});
  workspace.setInvitations(host);
  const unsubscribe=host.subscribe(async(session,bytes,current)=>{
    await workspace.open(new File([bytes],"Shared.figcraft"),session,current);
  },(connection,failed)=>workspace.joining(connection,failed));
  const origin=workspace.activeEngine!;
  try{
    expect(()=>origin.execute("collab.join",{link:"bad!"})).toThrow();
    expect(origin.execute("collab.peers").sessions).toEqual([]);
    const first=origin.execute("collab.join",{link});
    const second=origin.execute("collab.join",{code:link});
    expect(first).toMatchObject({session:1,status:"connecting",document:null});
    expect(second).toMatchObject({session:2,status:"connecting",document:null});
    workspace.execute("file.new");const other=workspace.activeEngine!;
    expect(other.execute("collab.peers").status).toBe("off");
    expect(other.execute("collab.leave",{session:1})).toEqual({ended:true});
    expect(other.execute("collab.leave",{session:1})).toEqual({ended:false});
    expect(()=>other.execute("collab.leave",{session:"2"})).toThrow();
    const reply=()=>new Response(archive,{headers:{"X-Figcraft-Access":"view","X-Figcraft-Client":"2","X-Figcraft-Room":"10000000-0000-4000-8000-000000000001"}});
    requests[0].reply.resolve(reply());requests[1].reply.resolve(reply());
    await vi.waitFor(()=>expect(workspace.activeEngine!.execute("collab.peers")).toMatchObject({
      session:2,status:"live",sessions:[{session:2,document:2}],
    }));
    expect(released).toEqual([requests[0].connection]);
    const copy=workspace.activeEngine!;
    expect(copy.execute("collab.leave")).toEqual({ended:true});
    expect(copy.execute("collab.peers").sessions).toEqual([]);
    expect(copy.getSnapshot().document.name).toBe("Shared");expect(copy.getSnapshot().editable).toBe(true);
  }finally{unsubscribe();}
});

it.each(["leave","sign out"] as const)("discards a decoded archive when the user chooses to %s before attachment",async action=>{
  const workspace=new EditorWorkspace(),gate=deferred<void>(),decoding=deferred<void>();
  const guest:OnlineGuestSession={file:"f",connection:"held",access:"edit",client:2};
  const archive=await encodeFigcraftBlob(EditorEngine.newTab("Private drawing").liveDrawing());
  const original=EditorEngine.prototype.openTabFile;
  const read=vi.spyOn(EditorEngine.prototype,"openTabFile").mockImplementation(async function(this:EditorEngine,file:File){
    const result=await original.call(this,file);
    decoding.resolve();await gate.promise;return result;
  });
  let current=true;
  try{
    const pending=workspace.open(new File([archive],"private.figcraft"),guest,()=>current);
    await decoding.promise;
    if(action==="sign out")workspace.setEditable(false);else current=false;
    gate.resolve();
    await expect(pending).rejects.toThrow(action==="leave"?"The join was cancelled":"identity changed");
    expect(workspace.getSnapshot()).toHaveLength(1);
    expect(workspace.activeEngine!.execute("collab.peers").sessions).toEqual([]);
  }finally{gate.resolve();read.mockRestore();}
});

it("discards a manual rejoin receipt after sign-out",async()=>{
  const receipt=deferred<"edit">(),leave=vi.fn(async()=>{});
  const host:OnlineInvitations={subscribe:()=>()=>{},async copyPublished(){},leave,showJoin(){},rejoin:()=>receipt.promise};
  const workspace=new EditorWorkspace(),notices:string[]=[];
  workspace.setInvitations(host,text=>notices.push(text));
  const guest:OnlineGuestSession={file:"f",connection:"stranded",access:"edit",client:2};
  workspace.attachGuestSession(workspace.getSnapshot()[0].id,guest);
  workspace.setGuestSession({...guest,ended:"unavailable"});
  workspace.activeEngine!.execute("collab.reconnect");
  workspace.setEditable(false);receipt.resolve("edit");
  await vi.waitFor(()=>expect(leave).toHaveBeenCalledWith("stranded"));
  expect(workspace.getSnapshot()[0].guest?.ended).toBe("unavailable");
  expect(notices).toEqual([]);
});

it("retries backoff at once and retains the same handle through a refused or successful manual rejoin",async()=>{
  const rejoin=vi.fn<NonNullable<OnlineInvitations["rejoin"]>>(),retryNow=vi.fn();
  const host:OnlineInvitations={subscribe:()=>()=>{},async copyPublished(){},async leave(){},showJoin(){},retryNow,rejoin};
  const workspace=new EditorWorkspace(),notices:string[]=[];
  workspace.setInvitations(host,text=>notices.push(text));
  const doc=workspace.activeEngine!,guest:OnlineGuestSession={file:"f",connection:"physical",client:5,access:"view"};
  workspace.attachGuestSession(workspace.getSnapshot()[0].id,guest);
  expect(()=>doc.execute("collab.reconnect")).toThrow();
  workspace.setGuestSession({...guest,reconnectAttempt:2});
  expect(doc.execute("collab.reconnect")).toEqual({status:"reconnecting"});expect(retryNow).toHaveBeenCalledWith("physical");
  workspace.setGuestSession({...guest,ended:"unavailable"});
  rejoin.mockRejectedValueOnce(new Error("The invite is unavailable"));
  expect(doc.execute("collab.reconnect")).toEqual({status:"connecting"});
  await vi.waitFor(()=>expect(doc.execute("collab.peers")).toMatchObject({session:1,status:"failed",reason:"The invite is unavailable"}));
  rejoin.mockResolvedValueOnce("comment");
  expect(doc.execute("collab.reconnect")).toEqual({status:"connecting"});
  await vi.waitFor(()=>expect(doc.execute("collab.peers")).toMatchObject({session:1,status:"live",access:"comment",readOnly:true}));
  expect(notices.at(-1)).toBe("Rejoined session");
  workspace.setGuestSession({...guest,ended:"removed"});
  expect(doc.execute("collab.leave")).toEqual({ended:false});
  expect(doc.execute("collab.peers").status).toBe("off");
});

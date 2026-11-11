import {expect,it,vi} from "vitest";
import hostCommands from "../fixtures/native-host-commands.json";
import native from "../fixtures/native-session-summary.json";
import {EditorEngine} from "../../src/engine/editor";
import {EditorWorkspace} from "../../src/engine/workspace";
import {hostingSummary} from "../../src/engine/sharing/live-session-summary";
import {LivePeer} from "../../src/engine/sharing/live-peer";
import {makeLiveCheckpoint} from "../../src/engine/sharing/live-checkpoint";
import {liveReplica} from "../../src/engine/sharing/live-changes";
import {LivePeople} from "../../src/engine/sharing/live-people";
import {encodeFigcraftBlob} from "../../src/engine/file-format";
import type {OnlineGuestSession,OnlineInvitations} from "../../src/backends/online-files";
import type {PeopleWelcome} from "../../src/engine/sharing/live-presence";

const connection="physical-independent", guest:OnlineGuestSession={file:"f",access:"view",client:2,connection};
const link="figcraft://join?host=127.0.0.1:47900&file=f&token=t";
const host:OnlineInvitations={
  inspect:()=>({link,url:"ws://127.0.0.1:47900/?file=f&token=t",address:"127.0.0.1:47900",network:false}),
  subscribe:()=>()=>{},showJoin(){},async copyPublished(){},async leave(){},
};
const welcome:PeopleWelcome={me:{client:2,name:"Me",colour:"#0D99FF",generation:"2"},
  peers:[{client:1,name:"Hana",colour:"#9747FF",generation:"1"}]};
const archive=async()=>new File([await encodeFigcraftBlob(EditorEngine.newTab("Team file").getSnapshot().document)],"f.figcraft");

it("replays every field of the native browser session command across nine lifecycle states",async()=>{
  const workspace=new EditorWorkspace();
  const check=(stage:string)=>{
    const fixture=native.find(row=>row.stage===stage)!.result;
    // The provider gives the specific server-supplied reason in both summary positions.
    const expected=stage==="failed" ? {...fixture,reason:"Sharing was stopped",
      sessions:fixture.sessions.map(s=>({...s,reason:"Sharing was stopped"}))} : fixture;
    expect(workspace.activeEngine!.execute("collab.peers"),stage).toEqual(expected);
  };
  check("unavailable");
  workspace.setInvitations(host);
  check("off");
  workspace.joining(connection);
  check("connecting");
  await workspace.open(await archive(),guest);
  const engine=workspace.activeEngine!;
  let receive!:(input:unknown)=>void;
  const room=new LivePeople({capture:cursor=>engine.capturePresence(cursor),name:()=>"Me",subscribe:()=>()=>{},follow(){}},
    {welcome,listen(handler){receive=handler;return ()=>{};},async send(){return welcome.me;}},2);
  const stop=room.start();
  try {
    engine.setPeople(room);
    check("view");
    receive({...welcome.peers[0],sequence:2,hello:false,left:false,spotlight:false,chat:"Hi",
      presence:{selection:[],viewport:["1",10,20,40,60]}});
    check("presence");
    workspace.execute("file.new",{name:"Local"});
    check("background");
    workspace.execute("doc.switch",{index:1});
    workspace.setGuestSession({...guest,reconnectAttempt:2});room.reconnect();
    check("reconnecting");
    workspace.setGuestSession({...guest,ended:"stopped"});engine.setPeople(undefined);
    check("failed");
    workspace.leaveSession(connection);
    check("left");
  } finally {stop();}
});

it("keeps stable handles when tabs move and forgets synchronously on close or sign-out",async()=>{
  const workspace=new EditorWorkspace();workspace.setInvitations(host);
  const bytes=await archive();
  await workspace.open(bytes,guest);
  await workspace.open(bytes,{...guest,connection:"second",file:"g"});
  const second=workspace.activeEngine!;
  workspace.execute("file.moveTab",{from:2,to:0});
  const result=second.execute("collab.peers");
  expect(result.sessions.map(s=>[s.session,s.document])).toEqual([[1,2],[2,0]]);
  workspace.execute("file.close",{index:0,force:true});
  expect(second.execute("collab.peers").available).toBe(false);
  const first=workspace.engines[1];
  expect(first.execute("collab.peers").sessions.map(s=>s.session)).toEqual([1]);
  workspace.setEditable(false);
  expect(first.execute("collab.peers")).toEqual(native[0].result);
});
it("keeps failed joins on their initiating tab and gives an existing synced file precedence",async()=>{
  const workspace=new EditorWorkspace();workspace.setInvitations(host);
  const source=workspace.activeEngine!;
  workspace.joining("declined");
  workspace.execute("file.new");
  workspace.joining("declined","Invite revoked");
  expect(source.execute("collab.peers")).toMatchObject({session:1,status:"failed",document:null,reason:"Invite revoked"});
  await workspace.open(await archive(),guest);
  workspace.joining("pending");
  expect(workspace.activeEngine!.execute("collab.peers")).toMatchObject({session:2,status:"live"});
});

it("moves an unfinished join to the remaining tab when its initiating file closes",async()=>{
  const workspace=new EditorWorkspace();workspace.setInvitations(host);
  workspace.execute("file.new");
  workspace.joining(connection);
  workspace.execute("file.close",{index:1,force:true});
  expect(workspace.activeEngine!.execute("collab.peers")).toMatchObject({session:1,status:"connecting"});
  await workspace.open(await archive(),guest);
  expect(workspace.activeEngine!.execute("collab.peers")).toMatchObject({session:1,status:"live"});
});

it("reports the local and remote text layer, Unicode caret and full-width node identifiers",async()=>{
  const workspace=new EditorWorkspace();workspace.setInvitations(host);
  await workspace.open(await archive(),{...guest,access:"edit"});
  const engine=workspace.activeEngine!;
  const {id}=await engine.executeAsync("text.create",{text:"A🙂bc",x:5,y:10});
  const edit=engine.beginTextEdit({id:String(id)});edit.select(1,3);
  const local=engine.execute("collab.peers").editing;
  expect(local).toMatchObject({node:Number(id),layer:engine.getTextRange()!.node.name,caret:3,selection:[1,3]});
  let receive!:(input:unknown)=>void;
  const room=new LivePeople({capture:cursor=>engine.capturePresence(cursor),name:()=>"Me",subscribe:()=>()=>{},follow(){}},
    {welcome,listen(handler){receive=handler;return ()=>{};},async send(){return welcome.me;}},2);
  engine.setPeople(room);const stop=room.start();
  try{
    const large="18446744073709551615";
    receive({...welcome.peers[0],sequence:1,hello:false,left:false,spotlight:false,chat:"",
      presence:{cursor:[large,10,12],selection:[large],editingText:{node:String(id),caret:3,selection:[1,3]}}});
    expect(engine.execute("collab.peers").peers[0]).toMatchObject({editing:local,presence:{cursor:[large,10,12],
      selection:[large],editing_text:{node:Number(id),caret:3,selection:[1,3]}}});
  }finally{stop();edit.finish();}
});

it("takes the welcome title and pages from the confirmed checkpoint and its ordered suffix",async()=>{
  const workspace=new EditorWorkspace();workspace.setInvitations(host);
  const original=await archive();await workspace.open(original,guest);
  const engine=workspace.activeEngine!;
  const other=EditorEngine.newTab("Compacted title");
  other.execute("page.rename",{id:"1",name:"Shared page"});
  const checkpoint=await makeLiveCheckpoint(liveReplica(other.getSnapshot().document));
  const stop=new LivePeer({current:()=>engine.liveDrawing(),receive:d=>engine.receiveLiveDocument(d),subscribe:engine.subscribe,
    welcome:d=>workspace.confirmedSessionDrawing(connection,d),interacting:()=>false,normalise:(_d,result)=>result,history(){}},
    {archive:original,async read(after){return {client:2,access:"view",sequence:"4",lastBatch:"0",refused:[],reset:after===null,
      checkpoint,checkpointSeq:"3",batches:after===null ? [{sequence:"4",client:6,batch:"1",changes:[
        {type:"setDoc",prop:"name",value:JSON.stringify("Confirmed title")}]}] : []};},
      async submit(){throw new Error("A view guest submitted an edit");}},2,()=>{}).start();
  try{
    await vi.waitFor(()=>expect(engine.execute("collab.peers")).toMatchObject({
      fileName:"Confirmed title",pages:[{id:1,name:"Shared page"}],sessions:[{fileName:"Confirmed title"}],
    }));
  }finally{stop();}
});

it("only an authorised live editor can remove a named peer and waits for the provider receipt",async()=>{
  const removePerson=vi.fn(async()=>({removed:1,name:"Hana"}));
  const workspace=new EditorWorkspace();
  workspace.setInvitations({...host,removePerson});
  await expect(workspace.activeEngine!.executeAsync("collab.removePerson",{client:1})).rejects.toThrow("live session");
  await workspace.open(await archive(),guest);
  const editor=workspace.activeEngine!;
  const room=new LivePeople({capture:cursor=>editor.capturePresence(cursor),name:()=>"Me",subscribe:()=>()=>{},follow(){}},
    {welcome,listen:()=>()=>{},async send(){return welcome.me;}},2);
  const stop=room.start();editor.setPeople(room);
  try{
    const remove=(client:unknown)=>editor.executeAsync("collab.removePerson",{client});
    for(const invalid of [-1,"1",2**32])await expect(remove(invalid)).rejects.toThrow("client id");
    for(const absent of [2,99])await expect(remove(absent)).rejects.toThrow("Nobody with client id");
    await expect(remove(1)).rejects.toThrow("owner");
    expect(removePerson).not.toHaveBeenCalled();
    workspace.setGuestSession({...guest,canRemovePeople:true});
    expect(editor.canRemovePeople).toBe(true);
    await expect(remove(1)).resolves.toEqual({removed:1,name:"Hana"});
    expect(removePerson).toHaveBeenCalledWith(connection,1);
    // The roster reflects the server's departure event, including after a refusal.
    expect(editor.execute("collab.peers").peers).toHaveLength(1);
    removePerson.mockRejectedValueOnce(new Error("Server unavailable"));
    await expect(remove(1)).rejects.toThrow("Server unavailable");
    workspace.setGuestSession({...guest,canRemovePeople:true,reconnectAttempt:1});
    expect(editor.canRemovePeople).toBe(false);
    await expect(remove(1)).rejects.toThrow("live session");
  }finally{stop();}
});

it("queues one cleaned participant report and attributes the server receipt to the same session",async()=>{
  const workspace=new EditorWorkspace(),notice=vi.fn();
  const report=vi.fn<(key:string,text:string)=>Promise<void>>();
  let metadata=false;
  const details={open:true,operator:"",terms:"",idleDays:null,maxFileMb:4,expires:null};
  workspace.setInvitations({...host,report,inspect:key=>({...host.inspect!(key)!,hosting:metadata ? details : undefined})},notice);
  const send=(engine:EditorEngine,reason:unknown)=>engine.execute("collab.report",{reason});
  expect(()=>send(workspace.activeEngine!,3)).toThrow("text");
  expect(()=>send(workspace.activeEngine!," \t ")).toThrow("few words");
  expect(()=>send(workspace.activeEngine!,"spam")).toThrow("Join a file");
  await workspace.open(await archive(),guest);
  const engine=workspace.activeEngine!;
  expect(()=>send(engine,"spam")).toThrow("doesn't take reports");
  expect(report).not.toHaveBeenCalled();
  metadata=true;
  let accept!:()=>void;
  report.mockImplementationOnce(()=>new Promise(done=>{accept=done;}));
  expect(send(engine,"　a\u0000"+"🎨".repeat(505)+"  ")).toEqual({sent:true});
  expect(report.mock.calls).toEqual([[connection,"a "+"🎨".repeat(498)]]);
  expect(notice).not.toHaveBeenCalled();
  accept();await Promise.resolve();
  expect(notice).toHaveBeenLastCalledWith("Your report was sent to the server's operator");
  report.mockRejectedValueOnce(new Error("Quota reached"));
  expect(send(engine,"second")).toEqual({sent:true});await Promise.resolve();
  expect(notice).toHaveBeenLastCalledWith("The report wasn't sent: Quota reached");
  report.mockRejectedValueOnce(new Error("Reports disabled"));
  await expect(engine.executeAsync("collab.report",{reason:"third"})).rejects.toThrow("Reports disabled");
  expect(notice).toHaveBeenCalledTimes(2);
  workspace.setGuestSession({...guest,reconnectAttempt:1});
  expect(()=>send(engine,"offline")).toThrow("Join a file");
  workspace.setGuestSession(guest);
  report.mockImplementationOnce(()=>new Promise(done=>{accept=done;}));
  send(engine,"stale");
  workspace.leaveSession(connection);
  accept();await Promise.resolve();expect(notice).toHaveBeenCalledTimes(2);
});

it("asks the selected server without joining and returns the native hosting fields",async()=>{
  const workspace=new EditorWorkspace(),engine=workspace.activeEngine!;
  const server="wss://studio.example/";
  const info={idleSeconds:"90000",expires:"18446744073709551615",open:false,maxFileMb:300,
    terms:"  https://site.example/te\u0000rms\u3000",operator:"\u3000St\u0080udio"+"🎨".repeat(125)};
  const serverInfo=vi.fn(async()=>info);
  await expect(engine.executeAsync("collab.serverInfo",{server})).rejects.toThrow("unavailable");
  workspace.setInvitations({...host,serverInfo});
  await expect(engine.executeAsync("collab.serverInfo",{server:4})).rejects.toThrow("server address");
  expect(serverInfo).not.toHaveBeenCalled();
  await expect(engine.executeAsync("collab.serverInfo",{server:" "+server+" "})).resolves.toEqual({open:false,
    maxFileMb:300,idleDays:1.04,expires:info.expires,operator:"Studio"+"🎨".repeat(114),terms:"https://site.example/terms"});
  expect(serverInfo).toHaveBeenCalledWith(server);
  for(const terms of ["HTTPS://host/","https://host/a\u0085b c","javascript:alert(1)"]){
    serverInfo.mockResolvedValueOnce({...info,terms,idleSeconds:"0",expires:"1800000000"});
    await expect(engine.executeAsync("collab.serverInfo",{server})).resolves.toMatchObject({terms:"",idleDays:null,expires:1800000000});
  }
  serverInfo.mockRejectedValueOnce(new Error("Offline"));
  await expect(engine.executeAsync("collab.serverInfo",{server})).rejects.toThrow("Offline");
});

it("replays native hosting and report results on a joined view-only tab",async()=>{
  const workspace=new EditorWorkspace(),report=vi.fn(async()=>{});
  const info={idleSeconds:"90000",expires:"1800000000",open:false,maxFileMb:300,
    terms:"  https://site.example/te\u0000rms　",operator:"　St\u0080udio🎨　"};
  workspace.setInvitations({...host,serverInfo:async()=>info,report,inspect:key=>({...host.inspect!(key)!,hosting:hostingSummary(info)})});
  await workspace.open(await archive(),guest);
  const engine=workspace.activeEngine!;
  expect(engine.execute("collab.peers").hosting).toEqual(hostCommands.hosting);
  await expect(engine.executeAsync("collab.serverInfo",{server:"wss://studio.example/"})).resolves.toEqual(hostCommands.server);
  expect(engine.execute("collab.report",{reason:"　Spam\u0000today🎨　"})).toEqual(hostCommands.report);
  expect(report).toHaveBeenCalledWith(connection,hostCommands.reason);
});

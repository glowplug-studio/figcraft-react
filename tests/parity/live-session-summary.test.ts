import {expect,it} from "vitest";
import native from "../fixtures/native-session-summary.json";
import {EditorEngine} from "../../src/engine/editor";
import {EditorWorkspace} from "../../src/engine/workspace";
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

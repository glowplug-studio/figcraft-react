import {readFileSync} from "node:fs";
import {afterEach,expect,it,vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {LivePeople} from "../../src/engine/sharing/live-people";
import {cleanPresenceSignal,presenceColours,readPeerIdentity,readPeerMessage,readPeerSample,readPeopleWelcome,readPresence,type LivePeerMessage,type LivePeerSample} from "../../src/engine/sharing/live-presence";

const empty={cursor:null,viewport:null,selection:null,editingText:null};
function message(overrides:Partial<LivePeerMessage>={}):LivePeerMessage {
  return {name:"Bea",chat:"",hello:false,left:false,spotlight:false,sequence:1,client:2,colour:presenceColours[1],generation:"100",presence:empty,...overrides};
}
function session(editor=new EditorEngine()) {
  let receive:(packet:unknown)=>void=()=>{}, ready=()=>{};
  const send=vi.fn(async (_:LivePeerSample)=>({client:1,name:"Ari",colour:presenceColours[0],generation:"101"}));
  const room=new LivePeople({
    capture:p=>editor.capturePresence(p),name:()=>editor.commentName,
    subscribe:changed=>editor.subscribe(changed),follow:p=>editor.followViewport(p.presence.viewport),
  },{send,listen:(fn,subscribed)=>{receive=fn;ready=subscribed;return ()=>{};}},1);
  editor.setPeople(room);room.setActive(true);
  const stop=room.start();
  return {editor,room,send,receive,ready,stop};
}
afterEach(()=>vi.useRealTimers());

it("matches all 14 signals cleaned by the separately built pinned Rust protocol",()=>{
  const cases=JSON.parse(readFileSync(new URL("../fixtures/native-presence-signals.json",import.meta.url),"utf8")) as {input:unknown;cleaned:unknown}[];
  for(const row of cases)expect(cleanPresenceSignal(row.input)).toEqual(row.cleaned);
});

it("sanitises pinned wire fields without rounding large identifiers or splitting scalar values",()=>{
  const max="18446744073709551615";
  expect(readPresence({cursor:[max,Infinity,0],viewport:[max,0,0,-1,1],selection:Array(10001).fill(max),
    editingText:{node:max,caret:2,selection:[1,2]}})).toEqual({...empty,selection:Array(10000).fill(max),editingText:{node:max,caret:2,selection:[1,2]}});
  expect(()=>readPresence({selection:["18446744073709551616"]})).toThrow();
  expect(cleanPresenceSignal({kind:"name",text:"🙂".repeat(63)+" z"})).toEqual({kind:"name",text:"🙂".repeat(63)});
  expect(cleanPresenceSignal({kind:"chat",text:"a\nb"+"𐐷".repeat(120)})?.text).toBe("a b"+"𐐷".repeat(97));
  expect(cleanPresenceSignal({kind:"chat",text:"🙂".repeat(256)})).toBeNull();
  expect(()=>readPeerMessage(message({generation:"1e7"}))).toThrow();
});

it("coalesces pointers at 33 ms, reintroduces on subscription and clears inactive presence",async()=>{
  vi.useFakeTimers();const {room,send,ready,stop}=session();
  try{
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls[0][0]).toMatchObject({hello:true,presence:{viewport:expect.any(Array)}});
    room.point({x:4,y:7});room.point({x:6,y:8});
    await vi.advanceTimersByTimeAsync(30);expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3);expect(send.mock.calls[1][0].presence.cursor?.slice(1)).toEqual([6,8]);
    ready();await vi.advanceTimersByTimeAsync(34);expect(send.mock.lastCall![0].hello).toBe(true);
    room.setActive(false);await vi.advanceTimersByTimeAsync(34);expect(send.mock.lastCall![0].presence).toEqual(empty);
  }finally{stop();}
  expect(send.mock.lastCall![0].left).toBe(true);
});

it("rejects delayed packets across leave, expiry and physical replacement",async()=>{
  vi.useFakeTimers();const {room,receive,stop}=session();
  try {
    receive(message({sequence:2,left:true}));receive(message());expect(room.getSnapshot()).toEqual([]);
    receive(message({sequence:1,generation:"101"}));expect(room.getSnapshot()).toHaveLength(1);
    receive(message({sequence:99,left:true}));expect(room.getSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60001);expect(room.getSnapshot()).toEqual([]);
    receive(message({sequence:1,generation:"101"}));expect(room.getSnapshot()).toEqual([]);
    receive(message({sequence:2,generation:"101"}));expect(room.getSnapshot()).toHaveLength(1);
  }finally{stop();}
});

it("fits the peer viewport locally and stops following on pan or when the spotlight ends",()=>{
  vi.useFakeTimers();const {room,editor,receive,stop}=session();
  const drawing=editor.liveDrawing(),page=drawing.currentPage;
  const presence={...empty,viewport:[page,20,40,100,50] as [string,number,number,number,number]};
  try {
    receive(message({presence,spotlight:true}));
    expect(room.following).toBe(2);
    expect(editor.getView()).toMatchObject({cx:70,cy:65,zoom:Math.min(editor.getView().vw/100,editor.getView().vh/50)});
    editor.updateView({...editor.getView(),cx:71});expect(room.following).toBeUndefined();
    room.setFollow(2);expect(room.following).toBe(2);
    receive(message({presence,sequence:2}));expect(room.following).toBeUndefined();
    expect(editor.liveDrawing()).toBe(drawing);
    expect(editor.getSnapshot().canUndo).toBe(false);
  }finally{stop();}
});

it("hands a spotlight between presenters, keeps the banner after unfollow and clears the departed presenter",()=>{
  vi.useFakeTimers();const {room,receive,stop}=session();
  try {
    room.setSpotlight(true);
    receive(message({spotlight:true}));
    expect([room.spotlighting,room.presenter,room.following]).toEqual([false,2,2]);
    room.setFollow();
    expect([room.presenter,room.following]).toEqual([2,undefined]);
    receive(message({client:3,spotlight:true}));
    receive(message({sequence:2,spotlight:false}));
    expect([room.presenter,room.following]).toEqual([3,3]);
    receive(message({client:3,sequence:Number.MAX_SAFE_INTEGER,left:true}));
    receive(message({client:3,sequence:10,spotlight:true}));
    expect([room.presenter,room.following]).toEqual([undefined,undefined]);
    expect(room.getSnapshot().map(p=>p.client)).toEqual([2]);
  }finally{stop();}
});

it("follows a different page locally while a later shared edit and the native archive keep the original active page",()=>{
  const editor=new EditorEngine();
  editor.execute("page.add",{name:"Other"});
  const shared=editor.liveDrawing();
  editor.setLiveHistory({canUndo:false,canRedo:false,travel:()=>false});
  editor.setEditable(false);
  editor.followViewport(["1",-20,30,200,180]);
  expect(editor.getSnapshot().document.currentPage).toBe("1");
  expect(editor.liveDrawing()).toEqual(shared);
  editor.receiveLiveDocument({...shared,name:"Joined drawing"});
  expect(editor.getSnapshot().document).toMatchObject({currentPage:"1",name:"Joined drawing"});
  expect(editor.liveDrawing()).toMatchObject({currentPage:shared.currentPage,name:"Joined drawing"});
  expect(editor.capturePresence({x:5,y:7})).toMatchObject({cursor:["1",5,7],selection:[]});
  expect(editor.getSnapshot().canUndo).toBe(false);
});

it("runs the native pointer, cursor chat, follow and spotlight commands through the editor",()=>{
  vi.useFakeTimers();const editor=new EditorEngine();
  expect(editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
  expect(()=>editor.execute("collab.cursorChat",{text:"hi"})).toThrow();
  expect(editor.execute("collab.cursor",{x:2,y:5})).toEqual({cursor:null});
  const {receive,room,stop}=session(editor);
  try{
    expect(editor.execute("collab.cursor",{x:2,y:5})).toEqual({cursor:[2,5]});
    expect(()=>editor.execute("collab.cursor",{x:3})).toThrow();
    const open=vi.fn();room.onChat(open);
    expect(editor.execute("collab.cursorChat")).toEqual({open:true,chat:""});expect(open).toHaveBeenCalledOnce();
    expect(editor.execute("collab.cursorChat",{text:"hi\nthere"})).toEqual({chat:"hi there"});
    expect(()=>editor.execute("collab.follow",{client:2})).toThrow();
    receive(message());expect(editor.execute("collab.follow",{client:2})).toEqual({follow:2});
    expect(editor.execute("collab.spotlight")).toEqual({spotlighting:true});expect(room.following).toBeUndefined();
    expect(editor.execute("collab.spotlight",{on:false})).toEqual({spotlighting:false});
    expect(editor.execute("collab.follow")).toEqual({follow:null});
    expect(editor.execute("collab.cursor")).toEqual({cursor:null});
  }finally{stop();}
});


it("bounds incoming names and colours by Unicode scalars without outgoing cleaning",()=>{
  for(const length of [255,256,257]) {
    const name="𐐷".repeat(length);
    expect(readPeerIdentity(message({name})).name).toBe("𐐷".repeat(Math.min(length,256)));
  }
  for(const length of [31,32,33]) {
    const colour="🙂".repeat(length);
    expect(readPeerIdentity(message({colour})).colour).toBe("🙂".repeat(Math.min(length,32)));
  }
  const name=" \t\n"+"e\u0301".repeat(127)+"ignored";
  expect(readPeerMessage(message({name,colour:"not a palette colour",chat:"a\nb"}))).toMatchObject({
    name:" \t\n"+"e\u0301".repeat(126)+"e",colour:"not a palette colour",chat:"a b",
  });
  expect(readPeerIdentity(message({name:"",colour:""}))).toMatchObject({name:"",colour:""});
  expect(readPeerIdentity(message({name:"x".repeat(100000),colour:"y".repeat(100000)}))).toMatchObject({name:"x".repeat(256),colour:"y".repeat(32)});
  const multibyte="𐐷".repeat(256);
  expect(new TextEncoder().encode("name"+multibyte).length).toBeGreaterThan(1024);
  expect(readPeerMessage(message({name:multibyte})).name).toBe(multibyte);
  expect(readPeerSample(message({name:"🙂".repeat(65)})).name).toBe("🙂".repeat(64));
  expect(()=>readPeerSample(message({name:multibyte}))).toThrow();
  expect(cleanPresenceSignal({kind:"name",text:multibyte})).toBeNull();
});

it("rejects malformed retained identities but does not inspect strings beyond their scalar prefix",()=>{
  for(const value of [null,1,{},[]]) {
    expect(()=>readPeerIdentity({...message(),name:value})).toThrow();
    expect(()=>readPeerIdentity({...message(),colour:value})).toThrow();
  }
  for(const invalid of ["\ud800","\udfff","ok\ud800x"]) {
    expect(()=>readPeerIdentity(message({name:invalid}))).toThrow();
    expect(()=>readPeerMessage(message({colour:invalid}))).toThrow();
  }
  expect(readPeerIdentity(message({name:"🙂".repeat(256)+"\ud800",colour:"🙂".repeat(32)+"\udfff"}))).toMatchObject({name:"🙂".repeat(256),colour:"🙂".repeat(32)});
});

it("keeps the first 4096 welcome entries and ignores malformed entries outside that prefix",()=>{
  const peers=Array.from({length:4096},(_,i)=>message({client:i+2,name:"n".repeat(257),colour:"c".repeat(33)}));
  const trailing={get name():never{throw new Error("outside retained roster");}};
  const welcome=readPeopleWelcome({me:message({client:1}),peers:[...peers,trailing,null]});
  expect(welcome.peers).toHaveLength(4096);
  expect(welcome.peers.map(p=>p.client)).toEqual(peers.map(p=>p.client));
  expect(welcome.peers.every(p=>p.name==="n".repeat(256)&&p.colour==="c".repeat(32))).toBe(true);
  expect(welcome.peers).not.toBe(peers);
  expect(welcome.peers[0]).not.toBe(peers[0]);
  expect(()=>readPeopleWelcome({me:message({client:1}),peers:[null,...peers]})).toThrow();
});

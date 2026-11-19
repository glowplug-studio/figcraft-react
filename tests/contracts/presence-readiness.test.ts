import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {LivePeople} from "../../src/engine/sharing/live-people";
import type {LivePeerMessage,LivePeerSample,PeerIdentity,PeopleWelcome} from "../../src/engine/sharing/live-presence";
import type {LiveTransport} from "../../src/engine/sharing/live-transport";

// Exact text of the pinned native `EngineError::Disabled` and `BadParams` displays for
// `signal_blocker`, `cursor_chat` and `spotlight`; written here independently of the product source.
const needsLive="cursor chat and spotlight need a live session";
const olderHost="the session's host runs an older version without cursor chat and spotlight";
const disabled=(command:string,why:string)=>"command `"+command+"` is not available right now: "+why;
const badText="invalid parameters for `collab.cursorChat`: `text` must be a string (empty closes the chat)";
const badOn="invalid parameters for `collab.spotlight`: `on` must be true or false";

const empty={cursor:null,viewport:null,selection:null,editingText:null};
const identity=(client=1,name="Ari",generation="100"):PeerIdentity=>({client,name,colour:"#3366ff",generation});
const packet=(client:number,sequence=1,overrides:Partial<LivePeerMessage>={}):LivePeerMessage=>({
  ...identity(client,"Bea"),sequence,chat:"",hello:false,left:false,spotlight:false,presence:empty,...overrides,
});
const joined=():PeopleWelcome=>({me:identity(),peers:[identity(2,"Bea")]});
type PeopleTransport=NonNullable<LiveTransport["people"]>;

/** A provider-neutral host whose subscribed/ready callback is released only by the test. */
function host(welcome?:PeopleWelcome,editor=new EditorEngine()) {
  let receive:(input:unknown)=>void=()=>{},ready=()=>{};
  const samples:LivePeerSample[]=[];
  const transport:PeopleTransport={welcome,
    async send(sample){samples.push(sample);return identity();},
    listen(fn,subscribed){receive=fn;ready=subscribed;return ()=>{};},
  };
  const room=new LivePeople({capture:cursor=>editor.capturePresence(cursor),name:()=>"Ari",
    subscribe:changed=>editor.subscribe(changed),follow:peer=>editor.followViewport(peer.presence.viewport)},transport,1);
  editor.setPeople(room);
  const opened=vi.fn();room.onChat(opened);
  const stop=room.start();
  return {editor,room,samples,opened,stop,receive:(input:unknown)=>receive(input),ready:()=>ready()};
}
function refusal(run:()=>unknown) {
  try{run();}catch(error){return error instanceof Error?error.message:String(error);}
  return "accepted";
}
const settle=()=>vi.advanceTimersByTimeAsync(100);
const state=(h:ReturnType<typeof host>)=>({chat:h.room.cursorChat,spotlighting:h.room.spotlighting,following:h.room.following,
  presenter:h.room.presenter,signals:h.room.signals,opened:h.opened.mock.calls.length,sent:h.samples.length,
  document:h.editor.getSnapshot().document,canUndo:h.editor.getSnapshot().canUndo});

beforeEach(()=>{vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();});

it("outside a session opens nothing, closes harmlessly and refuses new chat or a spotlight",()=>{
  const editor=new EditorEngine();
  expect(editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
  expect(editor.execute("collab.cursorChat",{text:null})).toEqual({open:false,chat:""});
  for(const text of [""," \t ","\n\u0001\u007f","🙂".repeat(256)])expect(editor.execute("collab.cursorChat",{text})).toEqual({chat:""});
  expect(refusal(()=>editor.execute("collab.cursorChat",{text:"hi"}))).toBe(disabled("collab.cursorChat",needsLive));
  for(const params of [{on:true},{},{on:null}])
    expect(refusal(()=>editor.execute("collab.spotlight",params))).toBe(disabled("collab.spotlight",needsLive));
  expect(editor.execute("collab.spotlight",{on:false})).toEqual({spotlighting:false});
  expect(refusal(()=>editor.execute("collab.cursorChat",{text:5}))).toBe(badText);
  for(const on of ["yes",1,0,"true"])expect(refusal(()=>editor.execute("collab.spotlight",{on}))).toBe(badOn);
});

it("a welcomed room whose host has not said it reads signals refuses with the older-host reason and changes nothing",async()=>{
  const h=host(joined());
  try{
    await settle();
    h.room.setFollow(2);
    const before=state(h);
    expect(before).toMatchObject({signals:false,following:2,chat:"",spotlighting:false,opened:0});
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
    expect(h.editor.execute("collab.cursorChat",{text:null})).toEqual({open:false,chat:""});
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"hi"}))).toBe(disabled("collab.cursorChat",olderHost));
    for(const params of [{on:true},{},{on:null}])
      expect(refusal(()=>h.editor.execute("collab.spotlight",params))).toBe(disabled("collab.spotlight",olderHost));
    // Malformed parameters are parameter errors, never readiness errors.
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:5}))).toBe(badText);
    expect(refusal(()=>h.editor.execute("collab.spotlight",{on:"yes"}))).toBe(badOn);
    // Cleaned-empty chat while already empty and spotlight-off while off stay successful no-ops.
    for(const text of [""," ","\n","🙂".repeat(256)])expect(h.editor.execute("collab.cursorChat",{text})).toEqual({chat:""});
    expect(h.editor.execute("collab.spotlight",{on:false})).toEqual({spotlighting:false});
    // Direct calls cannot bypass the public dispatch.
    expect(refusal(()=>h.room.setChat("hi"))).toBe(disabled("collab.cursorChat",olderHost));
    expect(refusal(()=>h.room.setSpotlight(true))).toBe(disabled("collab.spotlight",olderHost));
    expect(h.room.openChat()).toBe(false);
    await settle();
    expect(state(h)).toEqual(before);
  }finally{h.stop();}
});

it("only this room's own host callback grants readiness",async()=>{
  const h=host(joined()),other=host(joined());
  try{
    await settle();
    // Another client's packet, and another document's ready session, are not this host speaking to you.
    h.receive(packet(2,1,{hello:true}));other.ready();await settle();
    expect([h.room.signals,other.room.signals]).toEqual([false,true]);
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"hi"}))).toBe(disabled("collab.cursorChat",olderHost));
    expect(other.editor.execute("collab.cursorChat",{text:"hi"})).toEqual({chat:"hi"});
    expect(h.room.cursorChat).toBe("");
    h.ready();
    expect(h.room.signals).toBe(true);
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:true,chat:""});
    expect(h.opened).toHaveBeenCalledOnce();
    expect(h.editor.execute("collab.cursorChat",{text:"hello\nthere"})).toEqual({chat:"hello there"});
    h.room.setFollow(2);
    expect(h.editor.execute("collab.spotlight")).toEqual({spotlighting:true});
    expect([h.room.following,h.room.presenter]).toEqual([undefined,undefined]);
  }finally{h.stop();other.stop();}
});

it("a room without an authoritative identity is not yet live even when the channel is subscribed",async()=>{
  const h=host();
  try{
    h.ready();
    expect(h.room.signals).toBe(false);
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"hi"}))).toBe(disabled("collab.cursorChat",needsLive));
    expect(refusal(()=>h.editor.execute("collab.spotlight",{on:true}))).toBe(disabled("collab.spotlight",needsLive));
    await settle();
    // The first acknowledged sample confirms who this client is.
    expect(h.room.signals).toBe(true);
    expect(h.editor.execute("collab.spotlight",{on:true})).toEqual({spotlighting:true});
  }finally{h.stop();}
});

it("sends cleaned chat once per change, including the close, and a spotlight once per state",async()=>{
  const h=host(joined());
  try{
    h.ready();await settle();
    const chats=()=>h.samples.map(sample=>sample.chat).filter((chat,i,all)=>i===0 || chat!==all[i-1]);
    expect(h.editor.execute("collab.cursorChat",{text:"hello\nthere"})).toEqual({chat:"hello there"});await settle();
    let sent=h.samples.length;
    expect(h.editor.execute("collab.cursorChat",{text:"hello there"})).toEqual({chat:"hello there"});await settle();
    expect(h.samples.length).toBe(sent);
    expect(h.editor.execute("collab.cursorChat",{text:"x".repeat(500)})).toEqual({chat:"x".repeat(100)});await settle();
    // Oversized text cleans to the default empty signal, which closes an open chat.
    expect(h.editor.execute("collab.cursorChat",{text:"x".repeat(100)})).toEqual({chat:"x".repeat(100)});
    expect(h.editor.execute("collab.cursorChat",{text:"🙂".repeat(256)})).toEqual({chat:""});await settle();
    sent=h.samples.length;
    expect(h.editor.execute("collab.cursorChat",{text:""})).toEqual({chat:""});await settle();
    expect(h.samples.length).toBe(sent);
    expect(chats()).toEqual(["","hello there","x".repeat(100),""]);
    expect(h.editor.execute("collab.spotlight",{on:true})).toEqual({spotlighting:true});await settle();
    sent=h.samples.length;
    expect(h.editor.execute("collab.spotlight",{on:true})).toEqual({spotlighting:true});await settle();
    expect(h.samples.length).toBe(sent);
    expect(h.samples.at(-1)).toMatchObject({spotlight:true});
  }finally{h.stop();}
});

it("a reconnecting room forgets chat, keeps your spotlight intent and refuses anything new",async()=>{
  const h=host(joined());
  try{
    h.ready();await settle();
    h.editor.execute("collab.cursorChat",{text:"hi"});h.editor.execute("collab.spotlight",{on:true});await settle();
    h.room.reconnect();
    const sent=h.samples.length;
    expect([h.room.cursorChat,h.room.signals,h.room.spotlighting]).toEqual(["",false,true]);
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
    expect(h.opened).not.toHaveBeenCalled();
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"new"}))).toBe(disabled("collab.cursorChat",needsLive));
    expect(h.editor.execute("collab.cursorChat",{text:""})).toEqual({chat:""});
    // The same state is compared before the blocker: on while already on succeeds.
    expect(h.editor.execute("collab.spotlight",{on:true})).toEqual({spotlighting:true});
    // Stopping needs no live session, and the stopped intent is not announced after resuming.
    expect(h.editor.execute("collab.spotlight",{on:false})).toEqual({spotlighting:false});
    expect(refusal(()=>h.editor.execute("collab.spotlight",{on:true}))).toBe(disabled("collab.spotlight",needsLive));
    expect(refusal(()=>h.editor.execute("collab.spotlight"))).toBe(disabled("collab.spotlight",needsLive));
    await settle();
    expect(h.samples.length).toBe(sent);
    h.room.welcome({me:identity(1,"Ari","200"),peers:[]});h.ready();await settle();
    expect(h.samples.length).toBeGreaterThan(sent);
    expect(h.samples.slice(sent).some(sample=>sample.spotlight)).toBe(false);
  }finally{h.stop();}
});

it("after the welcome returns the reason becomes the older host until it reads signals again, then your spotlight goes out once",async()=>{
  const h=host(joined());
  try{
    h.ready();await settle();
    h.editor.execute("collab.cursorChat",{text:"hi"});h.editor.execute("collab.spotlight",{on:true});await settle();
    h.room.reconnect();
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"new"}))).toBe(disabled("collab.cursorChat",needsLive));
    h.room.welcome({me:identity(1,"Ari","200"),peers:[identity(2,"Bea")]});await settle();
    expect([h.room.signals,h.room.spotlighting,h.room.cursorChat]).toEqual([false,true,""]);
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:false,chat:""});
    expect(refusal(()=>h.editor.execute("collab.cursorChat",{text:"new"}))).toBe(disabled("collab.cursorChat",olderHost));
    expect(h.editor.execute("collab.spotlight",{on:true})).toEqual({spotlighting:true});
    const sent=h.samples.length;
    h.ready();await settle();
    expect(h.samples.slice(sent)).toHaveLength(1);
    expect(h.samples.at(-1)).toMatchObject({spotlight:true,hello:true,chat:""});
    expect(h.editor.execute("collab.cursorChat")).toEqual({open:true,chat:""});
    expect(h.editor.execute("collab.cursorChat",{text:"back"})).toEqual({chat:"back"});
    expect(h.editor.execute("collab.spotlight")).toEqual({spotlighting:false});
    expect(h.editor.execute("collab.spotlight")).toEqual({spotlighting:true});
  }finally{h.stop();}
});

it("a stopped room forgets its chat and spotlight and cannot be driven through a retained reference",async()=>{
  const h=host(joined());
  h.ready();await settle();
  h.editor.execute("collab.cursorChat",{text:"hi"});h.editor.execute("collab.spotlight",{on:true});await settle();
  h.stop();h.editor.setPeople(undefined);
  await settle();
  const sent=h.samples.length;
  expect(h.samples.at(-1)).toMatchObject({left:true});
  expect([h.room.signals,h.room.cursorChat,h.room.spotlighting]).toEqual([false,"",false]);
  expect(h.room.openChat()).toBe(false);
  expect(h.opened).not.toHaveBeenCalled();
  expect(refusal(()=>h.room.setChat("again"))).toBe(disabled("collab.cursorChat",needsLive));
  expect(refusal(()=>h.room.setSpotlight(true))).toBe(disabled("collab.spotlight",needsLive));
  // Local closes stay harmless.
  expect(h.room.setChat("")).toBe("");
  expect(refusal(()=>h.room.setSpotlight(false))).toBe("accepted");
  h.ready();await settle();
  expect([h.room.signals,h.room.cursorChat,h.room.spotlighting,h.samples.length]).toEqual([false,"",false,sent]);
});

import {afterEach,expect,it,vi} from "vitest";
import {LivePeople} from "../../src/engine/sharing/live-people";
import {readPeopleWelcome,type LivePeerMessage,type LivePeerSample,type PeerIdentity,type PeopleWelcome} from "../../src/engine/sharing/live-presence";
import type {LiveTransport} from "../../src/engine/sharing/live-transport";

const empty={cursor:null,viewport:null,selection:null,editingText:null};
const identity=(client=1,name="Ari",colour="arbitrary colour",generation="100"):PeerIdentity=>({client,name,colour,generation});
const packet=(client:number,sequence=1,overrides:Partial<LivePeerMessage>={}):LivePeerMessage=>({
  ...identity(client),sequence,chat:"",hello:false,left:false,spotlight:false,presence:empty,...overrides,
});
type PeopleTransport=NonNullable<LiveTransport["people"]>;
function host(welcome?:PeopleWelcome,ack:()=>Promise<PeerIdentity>=async()=>identity()) {
  let receive:(input:unknown)=>void=()=>{},ready=()=>{};
  let listens=0,sends=0;
  const transport:PeopleTransport={welcome,
    send(_sample:LivePeerSample){expect(this).toBe(transport);sends++;return ack();},
    listen(fn,subscribed){expect(this).toBe(transport);listens++;receive=fn;ready=subscribed;return ()=>{};},
  };
  const room=new LivePeople({capture:()=>empty,name:()=>"Ari",subscribe:()=>()=>{},follow:()=>{}},transport,1);
  const stop=room.start();
  return {room,transport,stop,receive:(p:unknown)=>receive(p),ready:()=>ready(),counts:()=>({listens,sends})};
}
/** Inspect retained core data, including internal entries and cached snapshots, without assuming field names. */
function retained(root:unknown):unknown[] {
  const result:unknown[]=[],seen=new Set<object>();
  function visit(value:unknown) {
    result.push(value);
    if(!value||typeof value!=="object"||seen.has(value))return;
    seen.add(value);
    if(value instanceof Map){for(const [key,item] of value){visit(key);visit(item);}}
    else if(value instanceof Set){for(const item of value)visit(item);}
    else for(const item of Object.values(value))visit(item);
  }
  visit(root);return result;
}
function expectBounded(room:LivePeople,raw:PeopleWelcome) {
  const values=new Set(retained(room));
  expect(values.has(raw)).toBe(false);
  expect(values.has(raw.peers)).toBe(false);
  for(const peer of [raw.me,...raw.peers]) {
    if(peer.name.length>512)expect(values.has(peer.name)).toBe(false);
    if(peer.colour.length>64)expect(values.has(peer.colour)).toBe(false);
  }
}
afterEach(()=>vi.useRealTimers());

it("bounds a custom host welcome before core retention and preserves method receivers",async()=>{
  vi.useFakeTimers();
  const longName="n".repeat(10000),longColour="z".repeat(10000);
  const raw={me:identity(1,"🙂".repeat(10000),"c".repeat(10000)),peers:Array.from({length:4097},(_,i)=>identity(i+2,longName,longColour))};
  // A provider must retain the bounded replacement. Core still validates a host which bypasses that contract.
  const provider=readPeopleWelcome(raw);
  expect(provider.peers).toHaveLength(4096);
  expect(provider.me.name).toBe("🙂".repeat(256));
  expect(retained(provider)).not.toContain(raw.peers[0].name);
  const h=host(raw);
  try {
    expect(h.room.confirmedName).toBe("🙂".repeat(256));
    expect(h.room.getSnapshot()).toHaveLength(4096);
    expect(h.room.getSnapshot()[4095].client).toBe(4097);
    expectBounded(h.room,raw);
    expect(retained(h.room)).not.toContain(h.transport);
    h.ready();await vi.advanceTimersByTimeAsync(1);
    expect(h.counts()).toEqual({listens:1,sends:1});
  }finally{h.stop();}
});

it("bounds direct reconnect welcomes, ignores an invalid trailing peer and rejects a malformed retained identity atomically",()=>{
  vi.useFakeTimers();const h=host({me:identity(),peers:[identity(2)]});
  try {
    h.room.reconnect();
    const longName="r".repeat(5000),longColour="q".repeat(5000);
    const peers=Array.from({length:4096},(_,i)=>identity(i+3,longName,longColour));
    const raw={me:identity(1,"new".repeat(1000),"m".repeat(1000),"200"),peers:[...peers,null]} as unknown as PeopleWelcome;
    h.room.welcome(raw);
    expect(h.room.confirmedName).toBe("new".repeat(85)+"n");
    expect(h.room.getSnapshot()).toHaveLength(4096);
    expect(h.room.getSnapshot()[0].client).toBe(3);
    // Ignore malformed excess entries before touching them; inspect retained core values separately.
    expect(retained(h.room)).not.toContain(raw);
    expect(retained(h.room)).not.toContain(peers[0].name);
    const before=h.room.getSnapshot();
    h.room.welcome({me:identity(1,"changed"),peers:[identity(9000),{...identity(9001),colour:3}]} as unknown as PeopleWelcome);
    expect(h.room.confirmedName).toBe("new".repeat(85)+"n");
    expect(h.room.getSnapshot()).toEqual(before);
  }finally{h.stop();}
});

it("updates existing peers at capacity and admits another peer after departure",()=>{
  vi.useFakeTimers();const h=host({me:identity(),peers:Array.from({length:4096},(_,i)=>identity(i+2))});
  try {
    h.receive(packet(2,1,{name:"renamed".repeat(1000),colour:"u".repeat(1000)}));
    expect(h.room.getSnapshot()[0]).toMatchObject({name:("renamed".repeat(36)+"rena"),colour:"u".repeat(32)});
    h.receive(packet(5000));expect(h.room.getSnapshot()).toHaveLength(4096);
    expect(h.room.getSnapshot().some(p=>p.client===5000)).toBe(false);
    h.receive(packet(3,2,{left:true}));h.receive(packet(5000));
    expect(h.room.getSnapshot()).toHaveLength(4096);
    expect(h.room.getSnapshot().some(p=>p.client===3)).toBe(false);
    expect(h.room.getSnapshot().some(p=>p.client===5000)).toBe(true);
    h.receive(packet(3,1));expect(h.room.getSnapshot().some(p=>p.client===3)).toBe(false);
  }finally{h.stop();}
});

it("bounds self broadcasts and acknowledgements without adding self to other peers",async()=>{
  vi.useFakeTimers();const raw=identity(1,"a".repeat(10000),"b".repeat(10000));
  const h=host({me:identity(),peers:[]},async()=>raw);
  try {
    h.ready();await vi.advanceTimersByTimeAsync(1);
    expect(h.room.confirmedName).toBe("a".repeat(256));
    expect(h.room.confirmedColour).toBe("b".repeat(32));
    expect(retained(h.room)).not.toContain(raw.name);
    h.receive(packet(1,5,{name:"𐐷".repeat(300),colour:"",generation:"101"}));
    expect(h.room.confirmedName).toBe("𐐷".repeat(256));
    expect(h.room.confirmedColour).toBe("");
    expect(h.room.getSnapshot()).toEqual([]);
    h.receive(packet(1,4,{name:"stale",generation:"101"}));
    h.receive(packet(1,99,{name:"older generation",generation:"100"}));
    expect(h.room.confirmedName).toBe("𐐷".repeat(256));
  }finally{h.stop();}
});

it("does not restore stale asynchronous acknowledgements after reconnect or disposal",async()=>{
  vi.useFakeTimers();let resolve!:(value:PeerIdentity)=>void;
  const h=host({me:identity(),peers:[]},()=>new Promise<PeerIdentity>(done=>{resolve=done;}));
  try {
    h.ready();await vi.advanceTimersByTimeAsync(1);
    h.room.reconnect();h.room.welcome({me:identity(1,"reconnected","new colour","200"),peers:[]});
    resolve(identity(1,"stale".repeat(1000),"stale colour","100"));
    await Promise.resolve();await Promise.resolve();
    expect(h.room.confirmedName).toBe("reconnected");
    expect(h.room.confirmedColour).toBe("new colour");
    await vi.advanceTimersByTimeAsync(34);
    const pendingBeforeDisposal=resolve;
    h.stop();pendingBeforeDisposal(identity(1,"disposed","disposed colour","300"));
    h.receive(packet(2,1,{name:"late peer"}));
    expect(h.room.getSnapshot()).toEqual([]);
    await Promise.resolve();await Promise.resolve();
    expect(h.room.confirmedName).toBe("reconnected");
    expect(h.room.confirmedColour).toBe("new colour");
  }finally{h.stop();}
});

it("rejects malformed and mismatched self acknowledgements without changing confirmed identity",async()=>{
  vi.useFakeTimers();let receipt=identity(2,"wrong client");
  const h=host({me:identity(1,"confirmed","confirmed colour","100"),peers:[]},async()=>receipt);
  try {
    h.ready();await vi.advanceTimersByTimeAsync(1);
    expect(h.room.confirmedName).toBe("confirmed");
    receipt={...identity(1,"malformed"),colour:5} as unknown as PeerIdentity;
    h.ready();await vi.advanceTimersByTimeAsync(34);
    expect(h.room.confirmedName).toBe("confirmed");
    expect(h.room.confirmedColour).toBe("confirmed colour");
    receipt=identity(1,"old generation","old colour","99");
    h.ready();await vi.advanceTimersByTimeAsync(34);
    expect(h.room.confirmedName).toBe("confirmed");
  }finally{h.stop();}
});

it("keeps a direct welcome identity when an earlier same-generation acknowledgement arrives",async()=>{
  vi.useFakeTimers();let resolve!:(receipt:PeerIdentity)=>void;
  const h=host({me:identity(),peers:[]},()=>new Promise<PeerIdentity>(done=>{resolve=done;}));
  try {
    h.ready();await vi.advanceTimersByTimeAsync(1);
    h.room.welcome({me:identity(1,"new welcome","new welcome colour"),peers:[]});
    resolve(identity(1,"earlier receipt","earlier receipt colour"));
    await Promise.resolve();await Promise.resolve();
    expect(h.room.confirmedName).toBe("new welcome");
    expect(h.room.confirmedColour).toBe("new welcome colour");
  }finally{h.stop();}
});

it("clears a replaced presenter's spotlight follow while retaining an independent manual follow",()=>{
  vi.useFakeTimers();const h=host({me:identity(),peers:[identity(2),identity(3)]});
  try {
    h.receive(packet(2,1,{spotlight:true}));
    expect([h.room.presenter,h.room.following]).toEqual([2,2]);
    h.room.welcome({me:identity(),peers:[identity(2,"replacement","colour","101"),identity(3)]});
    expect([h.room.presenter,h.room.following]).toEqual([undefined,undefined]);
    expect(h.room.getSnapshot().find(p=>p.client===2)?.spotlight).toBe(false);

    h.receive(packet(2,1,{spotlight:true,generation:"101"}));
    h.room.setFollow(3);
    expect([h.room.presenter,h.room.following]).toEqual([2,3]);
    h.room.welcome({me:identity(),peers:[identity(2,"another replacement","colour","102"),identity(3)]});
    expect([h.room.presenter,h.room.following]).toEqual([undefined,3]);
  }finally{h.stop();}
});

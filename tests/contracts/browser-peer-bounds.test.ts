import {afterEach,expect,it,vi} from "vitest";
import {BrowserInvitations} from "../../examples/nextjs/lib/sharing/browser-invites";
import type {GuestSessionEnd} from "../../src/backends/online-files";
import type {PeopleWelcome} from "../../src/engine/sharing/live-presence";

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it("retains only the bounded browser welcome in initial and reconnected grants and transport views",async()=>{
  vi.useFakeTimers();
  vi.stubGlobal("window",new EventTarget());
  vi.stubGlobal("location",{hash:"",origin:"https://editor.example"});
  const room="10000000-0000-4000-8000-000000000001",rawTail="RAW_IDENTITY_TAIL_MUST_NOT_BE_RETAINED";
  const rawWelcome=(reconnected:boolean)=>{
    const prefix=reconnected?"Reconnected 🙂":"Initial 🙂";
    const identity={name:prefix.repeat(10_000)+rawTail,colour:"arbitrary-colour-".repeat(10_000)+rawTail,generation:reconnected?"2":"1"};
    return {me:{...identity,client:42},peers:[...Array.from({length:4096},(_,index)=>({
      ...identity,client:1000+index,name:index===0?identity.name:"Retained "+index,colour:index===0?identity.colour:"#123456",
    })),{client:null,name:"Discarded \ud800",colour:null,generation:null},null]};
  };
  const raw=[rawWelcome(false),rawWelcome(true)];
  const physical:string[]=[],released:string[]=[];
  let disconnected:((reason:GuestSessionEnd)=>void)|undefined,connection="",welcomeIndex=0;
  const monitor=vi.fn((_physical:string,ended:(reason:GuestSessionEnd)=>void)=>{
    disconnected=ended;
    return ()=>{};
  });
  vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith("/leave")){
      released.push(body.connection);
      return new Response(null,{status:204});
    }
    if(url.endsWith("/join")){
      physical.push(body.tab);
      return new Response("archive",{headers:{"X-Figcraft-Access":"edit","X-Figcraft-Client":"42","X-Figcraft-Room":room}});
    }
    if(url.endsWith("/presence") && body.action==="welcome")return Response.json(raw[welcomeIndex++]);
    throw new Error("Unexpected browser provider request: "+url);
  });
  // Metadata enables the provider's real presence-welcome request after redeem.
  const host=new BrowserInvitations({readPublishedLinks:async()=>undefined},"guest","http://files.example",monitor,
    ()=>{},()=>{},undefined,{hosting:async()=>({idleSeconds:"0",expires:null,open:true}),sharing:()=>undefined,loadSharing:async()=>undefined});
  const unsubscribe=host.subscribe(async session=>{connection=session.connection;});
  let stop:(()=>void)|undefined;
  const retained=()=>{
    // Inspect actual provider storage as well as its public projections: the UI alone cannot establish this boundary.
    const tabs=(host as unknown as {tabs:Map<string,{welcome?:PeopleWelcome;physical:string}>}).tabs;
    const grant=tabs.get(connection)!;
    expect(tabs.size).toBe(1);
    return grant;
  };
  const assertBounded=(index:number)=>{
    const grant=retained(),welcome=grant.welcome!;
    expect(welcome.peers).toHaveLength(4096);
    expect(welcome.peers.map(peer=>peer.client)).toEqual(Array.from({length:4096},(_,i)=>1000+i));
    expect(welcome.me.name).toBe([...raw[index].me.name].slice(0,256).join(""));
    expect(welcome.me.colour).toBe([...raw[index].me.colour].slice(0,32).join(""));
    expect(welcome.peers[0]).toEqual({...welcome.me,client:1000});
    expect(welcome.peers[4095].name).toBe("Retained 4095");
    for(const peer of [welcome.me,...welcome.peers]){
      expect([...peer.name].length).toBeLessThanOrEqual(256);
      expect([...peer.colour].length).toBeLessThanOrEqual(32);
    }
    expect(host.live(connection)?.people?.welcome).toBe(welcome);
    expect(host.inspect(connection)?.identity).toEqual({name:welcome.me.name,colour:welcome.me.colour});
    expect(JSON.stringify(grant)).not.toContain(rawTail);
    expect(JSON.stringify(grant)).not.toContain("Discarded");
    return welcome;
  };
  try{
    await host.join("ws://files.example/?file=drawing&token=abcdefghijklmnop");
    const initial=assertBounded(0),transport=host.live(connection)!;
    const changed=vi.fn(),ended=vi.fn();
    stop=host.watch(connection,ended,changed);
    disconnected!("unavailable");
    expect(changed).toHaveBeenCalledWith({attempt:1});
    host.retryNow(connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({access:"edit",client:42,room,canRemovePeople:false});
    expect(changed).toHaveBeenCalledTimes(2);
    expect(ended).not.toHaveBeenCalled();
    const recovered=assertBounded(1);
    expect(recovered).not.toBe(initial);
    expect(recovered.me.name).not.toBe(initial.me.name);
    expect(recovered.peers[0].name).not.toBe(initial.peers[0].name);
    // Previously handed-out transports expose the replacement bounded grant too.
    expect(transport.people?.welcome).toBe(recovered);
    expect(retained().physical).toBe(physical[1]);
    expect(physical).toHaveLength(2);
    expect(physical[1]).not.toBe(physical[0]);
    expect(released).toContain(physical[0]);
    expect(monitor).toHaveBeenCalledTimes(2);
    expect(welcomeIndex).toBe(2);
  }finally{
    stop?.();
    await host.leave(connection);
    unsubscribe();
    host.dispose();
  }
  expect(released).toEqual(physical);
});

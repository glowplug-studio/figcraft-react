import type {Point} from "../geometry";
import type {LiveTransport} from "./live-transport";
import {cleanPresenceSignal,readPeerMessage,readPeerIdentity,readPeopleWelcome,maxPeople,presenceInterval,presenceColours,type PeerIdentity,type LivePeerMessage,type LivePresence,type PeopleWelcome} from "./live-presence";

const empty:LivePresence={cursor:null,selection:null,viewport:null,editingText:null};
interface PeopleEditor {
  capture(cursor:Point|null):LivePresence;
  name():string;
  subscribe(changed:()=>void):()=>void;
  follow(peer:LivePeerMessage):void;
}
type ListEntry={message:LivePeerMessage;heard:number};

/** One ephemeral session per physical connection. Delivery, drawing edits and undo are independent. */
export class LivePeople {
  private entries=new Map<number,ListEntry>();
  private departed=new Map<number,{generation:string;sequence:number}>();
  private readyEpoch=0;
  private listeners=new Set<()=>void>();
  private list?:readonly LivePeerMessage[];
  private rosterVersion=0;
  private timer?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastSend=-Infinity;
  private previous="";
  private sequence=0;
  private sending=false;
  private suspended=false;
  private signalReady=false;
  private resend=true;
  private hello=true;
  private active=false;
  private alive=false;
  private cursor:Point|null=null;
  private retainedName="";
  private ownColour:string=presenceColours[0];
  private identity?:PeerIdentity;
  private identitySequence=-1;
  private initialWelcome?:PeopleWelcome;
  private sendSample:NonNullable<LiveTransport["people"]>["send"];
  private listen:NonNullable<LiveTransport["people"]>["listen"];
  get confirmedName(){return this.identity?.name;}
  get confirmedColour(){return this.identity?.colour;}
  get signals(){return this.signalReady && this.identity!==undefined;}
  get colour(){return this.ownColour;}
  private followed?:number;
  private chat="";
  private spotlight=false;
  private presenterId?:number;
  constructor(private editor:PeopleEditor,transport:NonNullable<LiveTransport["people"]>,private client:number){
    // Keep a bounded snapshot, not a second raw welcome. Operations preserve the
    // provider's receiver; providers must bound their own retained welcome too.
    try{if(transport.welcome)this.initialWelcome=readPeopleWelcome(transport.welcome);}catch{}
    this.sendSample=transport.send.bind(transport);
    this.listen=transport.listen.bind(transport);
  }
  getSnapshot=()=>this.list??=(Array.from(this.entries.values(),entry=>entry.message).sort((a,b)=>a.client-b.client));
  subscribe=(f:()=>void)=>{this.listeners.add(f);return ()=>{this.listeners.delete(f);};};
  rosterKey=()=>this.rosterVersion;
  private chatListeners=new Set<()=>void>();
  onChat(f:()=>void){this.chatListeners.add(f);return ()=>{this.chatListeners.delete(f);};}
  openChat(){this.chatListeners.forEach(f=>f());}
  refreshName(){this.changed();}
  typingHint(node:string) {
    const names=this.getSnapshot().filter(p=>p.presence.editingText?.node===node).map(p=>p.name);
    if(!names.length)return;
    if(names.length===1)return names[0]+" is editing this text";
    if(names.length===2)return names[0]+" and "+names[1]+" are editing this text";
    return names[0]+" and "+(names.length-1)+" others are editing this text";
  }
  get following(){return this.followed;}
  get presenter(){return this.presenterId;}
  get spotlighting(){return this.spotlight;}
  get cursorChat(){return this.chat;}
  setFollow(id?:number) {
    const peer=id===undefined?undefined:this.entries.get(id)?.message;
    this.followed=peer?.client;
    if(peer)this.editor.follow(peer);
    this.publish();
  }
  setSpotlight(on:boolean){
    if(on===this.spotlight)return;
    if(on){this.followed=undefined;this.presenterId=undefined;}
    this.spotlight=on;this.changed();this.publish();
  }
  setChat(value:string){const signal=cleanPresenceSignal({kind:"chat",text:value});if(signal){this.chat=signal.text;this.changed();}}
  setActive(on:boolean){if(this.active===on)return;this.active=on;this.cursor=null;this.changed();}
  point(p:Point|null){this.cursor=p;this.changed();}
  private publish(rosterChanged=true){
    this.list=undefined;
    if(rosterChanged)this.rosterVersion++;
    this.listeners.forEach(f=>f());
  }
  private rememberDeparture(peer:LivePeerMessage) {
    this.departed.delete(peer.client);
    this.departed.set(peer.client,{generation:peer.generation,sequence:peer.sequence});
    if(this.departed.size>maxPeople)this.departed.delete(this.departed.keys().next().value!);
  }
  private confirmIdentity(peer:PeerIdentity,sequence:number){
    if(peer.client!==this.client)return;
    if(this.identity && (BigInt(peer.generation)<BigInt(this.identity.generation) ||
      peer.generation===this.identity.generation && sequence<=this.identitySequence))return;
    const changed=this.identity?.name!==peer.name || this.ownColour!==peer.colour;
    this.identity={client:peer.client,name:peer.name,colour:peer.colour,generation:peer.generation};
    this.identitySequence=sequence;this.ownColour=peer.colour;
    if(changed)this.publish();
  }
  private accept=(input:unknown)=>{
    if(this.suspended || !this.alive)return;
    let peer:LivePeerMessage;
    try{peer=readPeerMessage(input);}catch{return;}
    if(peer.client===this.client){if(!peer.left)this.confirmIdentity(peer,peer.sequence);return;}
    const old=this.entries.get(peer.client)?.message, previousFollow=this.followed, previousPresenter=this.presenterId;
    const last=old??this.departed.get(peer.client);
    if(last && (BigInt(peer.generation)<BigInt(last.generation) || peer.generation===last.generation && peer.sequence<=last.sequence))return;
    if(peer.left) {
      this.rememberDeparture(peer);
      if(!old)return;
      this.entries.delete(peer.client);
      if(this.presenterId===peer.client)this.presenterId=undefined;
      if(this.followed===peer.client)this.followed=undefined;
    } else {
      if(!old && this.entries.size>=maxPeople)return;
      this.departed.delete(peer.client);
      this.entries.set(peer.client,{message:peer,heard:performance.now()});
      if(peer.hello){this.resend=true;this.changed();}
      if(peer.spotlight && (!old?.spotlight || old.generation!==peer.generation)){
        this.presenterId=peer.client;
        this.followed=peer.client;
        if(this.spotlight){this.spotlight=false;this.changed();}
      }
      if(!peer.spotlight && this.presenterId===peer.client){
        this.presenterId=undefined;
        if(this.followed===peer.client)this.followed=undefined;
      }
      if(this.followed===peer.client)this.editor.follow(peer);
    }
    this.publish(!old || peer.left || old.name!==peer.name || old.colour!==peer.colour || previousFollow!==this.followed || previousPresenter!==this.presenterId);
  };
  hasPresence(client:number){return (this.entries.get(client)?.message.sequence ?? -1)>=0;}
  reconnect(){
    if(this.suspended)return;
    this.suspended=true;this.readyEpoch++;this.signalReady=false;
    this.entries.clear();this.departed.clear();this.chat="";this.presenterId=undefined;
    this.publish();
  }
  welcome(welcome?:PeopleWelcome) {
    if(!this.alive)return;
    let bounded:PeopleWelcome|undefined;
    try{if(welcome)bounded=readPeopleWelcome(welcome);}catch{return;}
    if(bounded && bounded.me.client!==this.client)return;
    // A fresh authoritative welcome supersedes acknowledgements already in flight,
    // including providers which deliver it without a separate reconnect event.
    this.readyEpoch++;
    this.suspended=false;this.hello=true;this.resend=true;
    if(bounded){
      this.identity=bounded.me;this.identitySequence=-1;this.ownColour=bounded.me.colour;
      const heard=performance.now();
      const entries=new Map<number,ListEntry>();
      for(const peer of bounded.peers) {
        if(peer.client===this.client)continue;
        const old=this.entries.get(peer.client)?.message;
        const sample=old?.generation===peer.generation?old:{sequence:-1,chat:"",spotlight:false,hello:false,left:false,presence:empty};
        entries.set(peer.client,{heard,message:{...sample,...peer}});
      }
      this.entries=entries;
      if(this.followed!==undefined && !this.entries.has(this.followed))this.followed=undefined;
      if(this.presenterId!==undefined && !this.entries.get(this.presenterId)?.message.spotlight){
        if(this.followed===this.presenterId)this.followed=undefined;
        this.presenterId=undefined;
      }
    }
    this.publish();this.changed();
  }
  start() {
    this.alive=true;
    this.welcome(this.initialWelcome);this.initialWelcome=undefined;
    const unlisten=this.listen(this.accept,()=>{if(!this.alive || this.suspended)return;this.readyEpoch++;this.signalReady=true;this.hello=true;this.resend=true;this.changed();}),unwatch=this.editor.subscribe(this.changed);
    this.changed();
    this.heartbeat=setInterval(()=>{
      const cutoff=performance.now()-45000;
      let expired=false;
      for(const [id,entry] of this.entries){
        if(entry.heard>=cutoff)continue;
        this.rememberDeparture(entry.message);
        this.entries.delete(id);
        if(this.presenterId===id)this.presenterId=undefined;
        if(this.followed===id)this.followed=undefined;
        expired=true;
      }
      if(expired)this.publish();
      this.resend=true;this.changed();
    },15000);
    return ()=>{
      this.alive=false;clearTimeout(this.timer);clearInterval(this.heartbeat);unwatch();unlisten();
      if(this.sequence)void this.sendSample({...this.sample(),sequence:++this.sequence,left:true}).catch(()=>{});
      this.entries.clear();this.followed=undefined;this.presenterId=undefined;this.publish();
    };
  }
  private sample() {
    const name=this.editor.name();
    if(name && name!=="You")this.retainedName=name;
    return {name:this.retainedName,chat:this.chat,spotlight:this.spotlight,
      presence:this.active?this.editor.capture(this.cursor):empty,hello:this.hello,left:false};
  }
  private changed=()=>{
    if(!this.alive || this.suspended || this.sending || this.timer!==undefined)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.send();},Math.max(0,this.lastSend+presenceInterval-performance.now()));
  };
  private async send(){
    if(this.suspended || !this.alive)return;
    const epoch=this.readyEpoch,sample=this.sample(),key=JSON.stringify(sample);
    if(!this.resend && key===this.previous)return;
    this.sending=true;this.resend=false;this.lastSend=performance.now();
    let failed=false;
    try{
      const sequence=++this.sequence,receipt=await this.sendSample({...sample,sequence});
      if(this.alive && !this.suspended && epoch===this.readyEpoch){
        this.confirmIdentity(readPeerIdentity(receipt),sequence);
      }
      if(epoch===this.readyEpoch)this.hello=false;this.previous=JSON.stringify({...sample,hello:false});
    }catch{this.resend=true;failed=true;}
    finally{
      this.sending=false;
      if(failed && this.alive)this.timer=setTimeout(()=>{this.timer=undefined;this.changed();},1000);
      else this.changed();
    }
  }
}

export const peopleCommands={
  "collab.peers":{label:"People in this file",undo:false},
  "collab.cursor":{label:"Show cursor at",undo:false},
  "collab.cursorChat":{label:"Cursor chat",undo:false},
  "collab.follow":{label:"Follow",undo:false},
  "collab.spotlight":{label:"Spotlight me",undo:false},
};

export function executePeople(room:LivePeople|undefined,command:string,params:Record<string,unknown>) {
  if(command==="collab.cursor"){
    let cursor:Point|null=null;
    if(params.x!==undefined || params.y!==undefined){
      if(typeof params.x!=="number" || typeof params.y!=="number" || !Number.isFinite(params.x) || !Number.isFinite(params.y))
        throw new Error("Give both x and y in page coordinates, or neither to hide the cursor");
      cursor={x:params.x,y:params.y};
    }
    room?.point(cursor);
    return {cursor:room && cursor?[cursor.x,cursor.y]:null};
  }
  if(command==="collab.follow"){
    const id=params.client;
    if(id!==undefined && (typeof id!=="number" || !Number.isInteger(id) || !room?.getSnapshot().some(p=>p.client===id)))
      throw new Error("No such client in this session");
    room?.setFollow(id);
    return {follow:room?.following??null};
  }
  if(command==="collab.cursorChat"){
    if(params.text===undefined){
      room?.openChat();
      return {open:!!room,chat:room?.cursorChat??""};
    }
    if(typeof params.text!=="string")throw new Error("Chat text must be a string");
    const chat=cleanPresenceSignal({kind:"chat",text:params.text})?.text??"";
    if(!room && chat)throw new Error("Join a live session to use cursor chat");
    room?.setChat(chat);
    return {chat};
  }
  if(command==="collab.spotlight"){
    const on=params.on===undefined?!room?.spotlighting:params.on;
    if(typeof on!=="boolean")throw new Error("Spotlight must be true or false");
    if(!room && on)throw new Error("Join a live session to spotlight");
    room?.setSpotlight(on);
    return {spotlighting:on};
  }
  throw new Error("Unknown live presence command");
}

import type {Point} from "../geometry";
import type {LiveTransport} from "./live-transport";
import {cleanPresenceSignal,readPeerMessage,presenceInterval,presenceColours,type LivePeerMessage,type LivePresence} from "./live-presence";

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
  private resend=true;
  private hello=true;
  private active=false;
  private alive=false;
  private cursor:Point|null=null;
  private retainedName="";
  private ownColour:string=presenceColours[0];
  get colour(){return this.ownColour;}
  private followed?:number;
  private chat="";
  private spotlight=false;
  constructor(private editor:PeopleEditor,private transport:NonNullable<LiveTransport["people"]>,private client:number){}
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
  get spotlighting(){return this.spotlight;}
  get cursorChat(){return this.chat;}
  setFollow(id?:number) {
    const peer=id===undefined?undefined:this.entries.get(id)?.message;
    this.followed=peer?.client;
    if(peer)this.editor.follow(peer);
    this.publish();
  }
  setSpotlight(on:boolean){if(on)this.followed=undefined;this.spotlight=on;this.changed();this.publish();}
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
    if(this.departed.size>4096)this.departed.delete(this.departed.keys().next().value!);
  }
  private accept=(input:unknown)=>{
    let peer:LivePeerMessage;
    try{peer=readPeerMessage(input);}catch{return;}
    if(peer.client===this.client)return;
    const old=this.entries.get(peer.client)?.message, previousFollow=this.followed;
    const last=old??this.departed.get(peer.client);
    if(last && (BigInt(peer.generation)<BigInt(last.generation) || peer.generation===last.generation && peer.sequence<=last.sequence))return;
    if(peer.left) {
      this.rememberDeparture(peer);
      if(!old)return;
      this.entries.delete(peer.client);if(this.followed===peer.client)this.followed=undefined;
    } else {
      if(!old && this.entries.size>=4096)return;
      this.departed.delete(peer.client);
      this.entries.set(peer.client,{message:peer,heard:performance.now()});
      if(peer.hello){this.resend=true;this.changed();}
      if(peer.spotlight && !old?.spotlight)this.followed=peer.client;
      if(old?.spotlight && !peer.spotlight && this.followed===peer.client)this.followed=undefined;
      if(this.followed===peer.client)this.editor.follow(peer);
    }
    this.publish(!old || peer.left || old.name!==peer.name || old.colour!==peer.colour || previousFollow!==this.followed);
  };
  start() {
    this.alive=true;
    const unlisten=this.transport.listen(this.accept,()=>{this.readyEpoch++;this.hello=true;this.resend=true;this.changed();}),unwatch=this.editor.subscribe(this.changed);
    this.changed();
    this.heartbeat=setInterval(()=>{
      const cutoff=performance.now()-45000;
      let expired=false;
      for(const [id,entry] of this.entries){
        if(entry.heard>=cutoff)continue;
        this.rememberDeparture(entry.message);
        this.entries.delete(id);
        if(this.followed===id)this.followed=undefined;
        expired=true;
      }
      if(expired)this.publish();
      this.resend=true;this.changed();
    },15000);
    return ()=>{
      this.alive=false;clearTimeout(this.timer);clearInterval(this.heartbeat);unwatch();unlisten();
      if(this.sequence)void this.transport.send({...this.sample(),sequence:++this.sequence,left:true}).catch(()=>{});
      this.entries.clear();this.followed=undefined;this.publish();
    };
  }
  private sample() {
    const name=this.editor.name();
    if(name && name!=="You")this.retainedName=name;
    return {name:this.retainedName,chat:this.chat,spotlight:this.spotlight,
      presence:this.active?this.editor.capture(this.cursor):empty,hello:this.hello,left:false};
  }
  private changed=()=>{
    if(!this.alive || this.sending || this.timer!==undefined)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.send();},Math.max(0,this.lastSend+presenceInterval-performance.now()));
  };
  private async send(){
    const epoch=this.readyEpoch,sample=this.sample(),key=JSON.stringify(sample);
    if(!this.resend && key===this.previous)return;
    this.sending=true;this.resend=false;this.lastSend=performance.now();
    let failed=false;
    try{
      const receipt=await this.transport.send({...sample,sequence:++this.sequence});
      if(presenceColours.some(colour=>colour===receipt.colour))this.ownColour=receipt.colour;
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

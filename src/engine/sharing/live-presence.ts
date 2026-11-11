import {parseNodeId} from "../parameters";

export interface LivePresence {
  cursor: [string,number,number] | null;
  selection: string[] | null;
  viewport: [string,number,number,number,number] | null;
  editingText: {node:string;caret:number;selection:[number,number]|null} | null;
}
export interface PresenceSignal {kind:"chat"|"spotlight"|"name"|"ready";text:string}
export const presenceColours=["#0D99FF","#9747FF","#14AE5C","#F24822","#D9730D","#E83E8C","#00A3A3","#665CE0"] as const;
export const presenceInterval=33;

function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Invalid presence object");
  return value as Record<string,unknown>;
}
function nodeId(value:unknown) {
  if(typeof value==="string" && !/^\d{1,20}$/.test(value))throw new Error("Invalid presence node identifier");
  const id=parseNodeId(value);
  if (!id) throw new Error("Invalid presence node identifier");
  return id;
}
function offset(value:unknown) {
  if(typeof value!=="number" || !Number.isSafeInteger(value) || value<0) throw new Error("Invalid presence text offset");
  return value;
}
function tuple(value:unknown,n:number) {
  if(value==null)return null;
  if (!Array.isArray(value)||value.length!==n) throw new Error("Invalid presence tuple");
  return value;
}

export function readPresence(value:unknown):LivePresence {
  const p=object(value),cursor=tuple(p.cursor,3),viewport=tuple(p.viewport,5);
  const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
  if (p.selection!=null&&!Array.isArray(p.selection)) throw new Error("Invalid presence selection");
  const editing=p.editingText==null?null:object(p.editingText);
  const range=tuple(editing?.selection,2);
  return {
    cursor:cursor && finite(cursor[1]) && finite(cursor[2]) ? [nodeId(cursor[0]),cursor[1],cursor[2]] : null,
    viewport:viewport && viewport.slice(1).every(finite) && viewport[3]>0 && viewport[4]>0
      ? [nodeId(viewport[0]),viewport[1],viewport[2],viewport[3],viewport[4]] : null,
    selection:p.selection==null?null:p.selection.slice(0,10_000).map(nodeId),
    editingText:editing && {node:nodeId(editing.node),caret:offset(editing.caret),selection:range && [offset(range[0]),offset(range[1])]},
  };
}

export function cleanPresenceSignal(value:unknown):PresenceSignal|null {
  const {kind,text}=object(value);
  if(typeof kind!=="string" || typeof text!=="string" || new TextEncoder().encode(kind+text).length>1024) return null;
  if(kind==="ready")return text===""?{kind,text}:null;
  if(kind==="spotlight") return text==="on"||!text?{kind,text}:null;
  if(kind==="chat") {
    const clean=[...text.replace(/\p{Cc}/gu," ")].slice(0,100).join("");
    return {kind,text:/[^\p{White_Space}]/u.test(clean)?clean:""};
  }
  if(kind==="name") {
    const clean=[...text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,"").replace(/\p{Cc}/gu,"")].slice(0,64).join("").replace(/\p{White_Space}+$/u,"");
    return clean?{kind,text:clean}:null;
  }
  return null;
}

/** A sample carries the latest state so a newly joined or reconnected peer can request it again. */
export interface LivePeerSample {
  sequence:number;
  name:string;
  chat:string;
  spotlight:boolean;
  hello:boolean;
  left:boolean;
  presence:LivePresence;
}
export interface LivePeerMessage extends LivePeerSample {
  client:number;
  colour:string;
  generation:string;
}
export function readPeerSample(input:unknown):LivePeerSample {
  const p=object(input);
  if(typeof p.name!=="string" || typeof p.chat!=="string" || typeof p.hello!=="boolean" ||
    typeof p.left!=="boolean" || typeof p.spotlight!=="boolean") throw new Error("Invalid live sample");
  const chat=cleanPresenceSignal({kind:"chat",text:p.chat}),name=cleanPresenceSignal({kind:"name",text:p.name});
  if(!chat || !name && p.name.trim())throw new Error("Invalid live signal");
  return {sequence:offset(p.sequence),name:name?.text??"",chat:chat.text,spotlight:p.spotlight,hello:p.hello,left:p.left,presence:readPresence(p.presence)};
}

export function readPeerMessage(input:unknown):LivePeerMessage {
  const p=object(input);
  if(typeof p.client!=="number" || !Number.isInteger(p.client) || p.client<1 || p.client>=0xffffffff ||
    typeof p.colour!=="string" || !presenceColours.some(c=>c===p.colour) ||
    typeof p.generation!=="string" || !/^[1-9][0-9]{0,19}$/.test(p.generation)) throw new Error("Invalid live peer");
  return {...readPeerSample(p),client:p.client,colour:p.colour,generation:p.generation};
}

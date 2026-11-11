import type {SupabaseClient} from "@supabase/supabase-js";
import {cleanPresenceSignal,presenceColours,readPeerSample,type LivePeerMessage} from "../../engine/sharing/live-presence";
import type {LiveConnection} from "./live-journal";

export async function welcomeLivePeople(writer:SupabaseClient,connection:LiveConnection,input:unknown) {
  if(typeof input!=="string")throw Object.assign(new Error("Invalid display name"),{code:"22023"});
  const display=cleanPresenceSignal({kind:"name",text:input})?.text ?? "";
  const {data,error}=await writer.rpc("live_participants",{...connection,display,welcome:true});
  if(error)throw error;
  const identity=(p:{client:number;name:string;generation:string;colour:number})=>
    ({client:p.client,name:p.name,generation:p.generation,colour:presenceColours[p.colour]});
  return {me:identity(data),peers:data.peers.map(identity)};
}

/** The host supplies the current JWT principal and login. A browser never chooses its sender or recipients. */
export async function sendLivePresence(writer:SupabaseClient,connection:LiveConnection,input:unknown,
  deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  let sample;
  try {sample=readPeerSample(input);}
  catch(error){throw Object.assign(new Error("Invalid presence sample",{cause:error}),{code:"22023"});}
  const {data,error}=await writer.rpc("live_participants",{...connection,display:sample.name,welcome:false});
  if(error)throw error;
  const name=data.name;
  const peer={...sample,name,client:data.client,colour:presenceColours[data.colour],generation:data.generation};
  if (data.targets.length) await deliver(data.targets,peer);
  return {client:peer.client,colour:peer.colour,name,generation:peer.generation};
}

/** Releasing a grant is final even if its best-effort Realtime notification is lost. */
export async function leaveLiveConnection(writer:SupabaseClient,{actor,login,tab}:Omit<LiveConnection,"target">,
  deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  const {data,error}=await writer.rpc("leave_live_connection",{actor,login,tab});
  if(error)throw error;
  await announceDeparture(data,deliver);
}

type Departure={targets:string[];client:number;colour:number;generation:string};
async function announceDeparture(data:Departure|null,deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  if(!data?.targets.length)return;
  // A late sample from this physical connection must never reinstate the departed peer.
  await deliver(data.targets,{
    client:data.client,colour:presenceColours[data.colour],generation:data.generation,sequence:Number.MAX_SAFE_INTEGER,
    left:true,hello:false,spotlight:false,name:"",chat:"",presence:{cursor:null,selection:null,viewport:null,editingText:null},
  }).catch(()=>{ /* The remote heartbeat expires disconnected peers after transport failure. */ });
}

/** Owner or server-operator verification precedes the transaction that expels a single physical client. */
export async function removeLiveParticipant(writer:SupabaseClient,request:{
  actor:string;login:string;target:string;tab:string|null;peer:number;server_operator:boolean;
},deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  const {data,error}=await writer.rpc("remove_live_participant",request);
  if(error)throw error;
  if(!data || data.removed!==request.peer)throw new Error("Invalid removal receipt");
  await announceDeparture(data.departure,deliver);
  return {removed:request.peer,name:data.name as string|null};
}

/** Direct private HTTP broadcasts omit database retention. Bound each batch by bytes as well as channel count. */
export function presenceBroadcaster(projectUrl:string,serviceKey:string) {
  const url=new URL("/realtime/v1/api/broadcast",projectUrl),headers={"Content-Type":"application/json",apikey:serviceKey,Authorization:"Bearer "+serviceKey};
  return async (targets:readonly string[],payload:LivePeerMessage)=>{
    const bytes=new TextEncoder().encode(JSON.stringify(payload)).length+220;
    const count=Math.max(1,Math.min(64,Math.floor(512*1024/bytes)));
    for(let start=0;start<targets.length;start+=count) {
      const messages=targets.slice(start,start+count).map(topic=>({topic,event:"presence",private:true,payload}));
      const result=await fetch(url,{method:"POST",headers,body:JSON.stringify({messages}),signal:AbortSignal.timeout(6000)});
      await result.body?.cancel();
      if(!result.ok) throw new Error("Could not send live presence");
    }
  };
}

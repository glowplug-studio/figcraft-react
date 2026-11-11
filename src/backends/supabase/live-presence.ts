import type {SupabaseClient} from "@supabase/supabase-js";
import {presenceColours,readPeerSample,type LivePeerMessage} from "../../engine/sharing/live-presence";
import type {LiveConnection} from "./live-journal";

/** The host supplies the current JWT principal and login. A browser never chooses its sender or recipients. */
export async function sendLivePresence(writer:SupabaseClient,connection:LiveConnection,input:unknown,
  deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  let sample;
  try {sample=readPeerSample(input);}
  catch(error){throw Object.assign(new Error("Invalid presence sample",{cause:error}),{code:"22023"});}
  const {data,error}=await writer.rpc("live_presence_targets",{...connection,anonymous_name:!sample.name});
  if(error)throw error;
  const name=sample.name || "Guest "+(data.guest??data.client);
  const peer={...sample,name,client:data.client,colour:presenceColours[data.colour],generation:data.generation};
  if (data.targets.length) await deliver(data.targets,peer);
  return {client:peer.client,colour:peer.colour,name,generation:peer.generation};
}

/** Releasing a grant is final even if its best-effort Realtime notification is lost. */
export async function leaveLiveConnection(writer:SupabaseClient,{actor,login,tab}:Omit<LiveConnection,"target">,
  deliver:(targets:readonly string[],payload:LivePeerMessage)=>Promise<void>) {
  const {data,error}=await writer.rpc("leave_live_connection",{actor,login,tab});
  if(error)throw error;
  if(!data?.targets.length)return;
  // A late sample from this physical connection must never reinstate the departed peer.
  await deliver(data.targets,{
    client:data.client,colour:presenceColours[data.colour],generation:data.generation,sequence:Number.MAX_SAFE_INTEGER,
    left:true,hello:false,spotlight:false,name:"",chat:"",presence:{cursor:null,selection:null,viewport:null,editingText:null},
  }).catch(()=>{ /* The remote heartbeat expires disconnected peers after transport failure. */ });
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

import {presenceBroadcaster,removeLiveParticipant} from "@glowplug-studio/figcraft-react/backends/supabase/live-session";
import {PublicationKeyError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import {verifyServerKey} from "../../../../lib/sharing/operator-publication";
import {supabaseConfig} from "../../../../lib/supabase/config";
import {onlinePost} from "../../../../lib/supabase/online-post";

const uuid=(value:unknown):value is string=>typeof value==="string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});

export async function POST(request:Request) {
  const host=await onlinePost(request);
  if(host instanceof Response)return host;
  if(typeof host.session!=="string")return reply({error:"Sign in to manage a session"},401);
  const body=await request.json().catch(()=>null);
  if(!uuid(body?.file) || !Number.isInteger(body.client) || body.client<0 || body.client>0xffffffff)
    return reply({error:"Invalid participant"},400);
  const operator=Object.hasOwn(body,"serverKey");
  if(!operator && !uuid(body.tab))return reply({error:"A session is required"},400);
  try{
    if(operator)await verifyServerKey(host.user,host.writer,body.serverKey);
    const result=await removeLiveParticipant(host.writer,{actor:host.principal,login:host.session,tab:operator?null:body.tab,
      target:body.file,peer:body.client,server_operator:operator},presenceBroadcaster(supabaseConfig().url,process.env.SUPABASE_SECRET_KEY!));
    return reply(result);
  }catch(error){
    if(error instanceof PublicationKeyError)return reply({error:error.message},403);
    const code=error && typeof error==="object" && "code" in error?error.code:undefined;
    if(code==="42501")return reply({error:"Only the file's owner can remove people from it"},403);
    if(code==="FC044")return reply({error:"Nobody with client id "+body.client+" is in this file"},404);
    return reply({error:"Could not remove the participant"},503);
  }
}

import {presenceBroadcaster,sendLivePresence} from "@glowplug-studio/figcraft-react/backends/supabase/live-session";
import {boundedJson} from "../../../../lib/sharing/bounded-body";
import {onlinePost} from "../../../../lib/supabase/online-post";
import {supabaseConfig} from "../../../../lib/supabase/config";

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export async function POST(request:Request) {
  const host=await onlinePost(request);
  if(host instanceof Response)return host;
  if(typeof host.session!=="string")return new Response(null,{status:401});
  const data=await boundedJson(request,256*1024);
  if(data instanceof Response)return data;
  if(!data || typeof data.file!=="string" || !uuid.test(data.file) || typeof data.tab!=="string" || !uuid.test(data.tab)) return new Response(null,{status:400});
  try {
    const result=await sendLivePresence(host.writer,{actor:host.principal,login:host.session,target:data.file,tab:data.tab},data.sample,
      presenceBroadcaster(supabaseConfig().url,process.env.SUPABASE_SECRET_KEY!));
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const code=error && typeof error==="object" && "code" in error && error.code;
    return new Response(null,{status:code==="42501"?403:code==="22023"?400:503});
  }
}

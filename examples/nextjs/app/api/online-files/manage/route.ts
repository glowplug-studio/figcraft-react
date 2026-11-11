import {manageOwnedFile,OwnerFileError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import {ingressAddress} from "../../../../lib/sharing/ingress-address";
import {supabaseConfig} from "../../../../lib/supabase/config";
import {onlinePost} from "../../../../lib/supabase/online-post";

export async function POST(request:Request) {
  const host=await onlinePost(request);
  if (host instanceof Response) return host;
  const body=await request.json().catch(()=>null);
  const headers={"Cache-Control":"private, no-store"};
  if (typeof body?.id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.id) ||
    (body.name!==null && typeof body.name!=="string")) return Response.json({error:"Invalid file change"},{status:400,headers});
  try {
    const file=await manageOwnedFile(host.writer,host.principal,body.id,body.name?.replaceAll("\0","\u0001") ?? null,
      ingressAddress(request.headers,process.env.VERCEL==="1"),supabaseConfig());
    return file ? Response.json(file,{headers}) : new Response(null,{status:204,headers});
  } catch (error) {
    if (error instanceof OwnerFileError) return Response.json({error:error.message},{status:error.status,headers});
    return Response.json({error:"File management is temporarily unavailable"},{status:503,headers});
  }
}

import {OwnerFileError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import {onlinePost} from "../../../../lib/supabase/online-post";
import {ingressAddress} from "../../../../lib/sharing/ingress-address";
import {manageIndividualLinks,type IndividualLinkRequest} from "../../../../lib/sharing/individual-links";

export async function POST(request:Request) {
  const host=await onlinePost(request);
  if(host instanceof Response)return host;
  const input:unknown=await request.json().catch(()=>null);
  const body=input && typeof input==="object" ? input as Record<string,unknown> : {};
  const headers={"Cache-Control":"private, no-store"};
  if(typeof body?.file!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.file)
    || typeof body.action!=="string" || !["links","createLink","revoke"].includes(body.action)
    || (body.action==="createLink" && (typeof body.access!=="string" || !["edit","view","comment"].includes(body.access)||typeof body.label!=="string"))
    || (body.action==="revoke" && typeof body.link!=="string")) {
    return Response.json({error:"Invalid link management request"},{status:400,headers});
  }
  const action:IndividualLinkRequest=body.action==="links" ? {action:"links"}
    : body.action==="revoke" ? {action:"revoke",link:body.link as string}
    : {action:"createLink",access:body.access as "edit"|"view"|"comment",label:body.label as string};
  try {
    return Response.json(await manageIndividualLinks(host.writer,host.principal,body.file,action,
      ingressAddress(request.headers,process.env.VERCEL==="1")),{headers});
  }catch(error){
    if(error instanceof OwnerFileError)return Response.json({error:error.message},{status:error.status,headers});
    return Response.json({error:"Link management is temporarily unavailable"},{status:503,headers});
  }
}

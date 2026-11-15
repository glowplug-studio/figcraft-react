import {createHash,randomBytes} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {OnlineManagedLink} from "@glowplug-studio/figcraft-react";
import {cleanOnlineName,OwnerFileError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";

export type IndividualLinkRequest={action:"links"}|{action:"revoke";link:string}|{action:"createLink";access:"edit"|"view"|"comment";label:string};

/** Only the authenticated host supplies actor and ingress address. Plain tokens are never listed. */
export async function manageIndividualLinks(writer:SupabaseClient,actor:string,file:string,request:IndividualLinkRequest,address:string) {
  const made=request.action==="createLink" ? {id:randomBytes(8).toString("hex"),token:randomBytes(16).toString("base64url"),access:request.access} : undefined;
  const newLink=made && request.action==="createLink" ? {id:made.id,access_level:made.access,label:cleanOnlineName(request.label),
    token_hash:createHash("sha256").update(made.token).digest("hex"),code_hash:null,wrapped_token:null} : null;
  const send=()=>writer.rpc("manage_online_link",{actor,target:file,operation:request.action,
    link_id:request.action==="revoke" ? request.link : null,new_link:newLink,address});
  let response=await send();
  for(let attempt=0;response.data?.state==="contended" && attempt<8;attempt++){
    await new Promise(resolve=>setTimeout(resolve,10*2**attempt));
    response=await send();
  }
  const {data,error}=response;
  if(error)throw error;
  if(data?.state==="contended")throw new OwnerFileError("The file is changing. Try again.",409);
  if(data?.state==="unavailable")throw new OwnerFileError("The file is unavailable",403);
  if(data?.state==="busy")throw new OwnerFileError("Too many changes to this server's files from your address: wait a minute and try again",429);
  if(data?.state==="missing")throw new OwnerFileError("That file has no such link",422);
  if(data?.state==="limit" && typeof data.maximum==="string" && /^\d+$/.test(data.maximum))
    throw new OwnerFileError(`A file has at most ${data.maximum} links: revoke one first`,422);
  if(data?.state==="listed" && request.action==="links" && Array.isArray(data.links)) {
    return {links:(data.links as (Omit<OnlineManagedLink,"created"> & {created:string})[]).map(row=>{
      const epoch=Number(row.created);
      return {...row,created:Number.isSafeInteger(epoch) ? epoch : row.created};
    })};
  }
  if(data?.state!=="done")throw new Error("Invalid link management receipt");
  return made ?? {done:true as const};
}

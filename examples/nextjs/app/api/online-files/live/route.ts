import {boundedJson} from "../../../../lib/sharing/bounded-body";
import { maxLiveMessageBytes, readLiveUpdates, submitLiveBatch } from "@glowplug-studio/figcraft-react/backends/supabase/live-session";
import { onlinePost } from "../../../../lib/supabase/online-post";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const u64 = (v: unknown): v is string => typeof v === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= BigInt("18446744073709551615");
const json = (data: unknown,status = 200) => Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null,{status:401});
  const data = await boundedJson(request,maxLiveMessageBytes);
  if (data instanceof Response) return data;
  if (!data || typeof data.file !== "string" || !uuid.test(data.file) || typeof data.tab !== "string" || !uuid.test(data.tab)) {
    return json({error:"Invalid live connection"},400);
  }
  const connection = {actor:host.principal,login:host.session,tab:data.tab,target:data.file};
  try {
    if (data.action === "read" && (data.after === null || u64(data.after))) {
      return json(await readLiveUpdates(host.writer,connection,data.after));
    }
    if (data.action === "submit" && u64(data.batch) && data.batch !== "0" && u64(data.base) && Array.isArray(data.changes)) {
      return json(await submitLiveBatch(host.writer,connection,data.batch,data.base,data.changes));
    }
    return json({error:"Invalid live request"},400);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "42501") return json({error:"This connection has ended"},403);
    if (code === "22023") return json({error:"Invalid live batch"},400);
    if (code === "40001") return json({error:"Retry the same submission"},409);
    return json({error:"Shared edits are temporarily unavailable"},503);
  }
}

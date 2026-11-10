import {onlinePost} from "../../../../lib/supabase/online-post";
import {ingressAddress} from "../../../../lib/sharing/ingress-address";

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null, {status:401});
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("connection" in body) || typeof body.connection !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.connection)
    || !("reason" in body) || typeof body.reason !== "string") return new Response(null, {status:400});
  const address = ingressAddress(request.headers, process.env.VERCEL === "1");
  const {data, error} = await host.writer.rpc("submit_participant_report", {
    actor:host.principal, auth_session:host.session, tab:body.connection, address, reason:body.reason.replaceAll("\0"," "),
  });
  const headers = {"Cache-Control":"private, no-store"};
  if (!error && data === "kept") return new Response(null, {status:204, headers});
  if (!error && data === "empty") return Response.json({error:"Say what is wrong with the file"}, {status:422, headers});
  if (!error && data === "rate") return Response.json({error:"Too many reports from your address lately: try again in an hour"}, {status:429, headers});
  if (!error && data === "unavailable") return Response.json({error:"The session is no longer available"}, {status:403, headers});
  return Response.json({error:"The report could not be saved"}, {status:503, headers});
}

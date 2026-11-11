import { leaveLiveConnection, presenceBroadcaster } from "@glowplug-studio/figcraft-react/backends/supabase/live-session";
import { supabaseConfig } from "../../../../lib/supabase/config";
import { onlinePost } from "../../../../lib/supabase/online-post";

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("connection" in body) || typeof body.connection !== "string"
    || !/^[0-9a-f-]{36}$/.test(body.connection)) return new Response(null, { status: 400 });
  try {
    await leaveLiveConnection(host.writer, {actor:host.principal,login:host.session,tab:body.connection},
      presenceBroadcaster(supabaseConfig().url,process.env.SUPABASE_SECRET_KEY!));
    return new Response(null, {status:204});
  } catch {
    return new Response(null, {status:422});
  }
}

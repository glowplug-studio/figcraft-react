import { onlinePost } from "../../../../lib/supabase/online-post";

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("connection" in body) || typeof body.connection !== "string"
    || !/^[0-9a-f-]{36}$/.test(body.connection)) return new Response(null, { status: 400 });
  const result = await host.writer.from("online_file_connections").delete().eq("id", body.connection)
    .eq("principal_id", host.principal).eq("session_id", host.session);
  return new Response(null, { status: result.error ? 422 : 204 });
}

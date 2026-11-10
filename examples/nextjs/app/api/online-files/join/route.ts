import { onlinePost } from "../../../../lib/supabase/online-post";
import { readSharedDrawing } from "../../../../lib/sharing/join";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("file" in body) || typeof body.file !== "string" || !uuid.test(body.file)
    || !("tab" in body) || typeof body.tab !== "string" || !uuid.test(body.tab)
    || !("token" in body) || typeof body.token !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.token)) {
    return Response.json({ error: "Invalid invite" }, { status: 400 });
  }
  try {
    const result = await readSharedDrawing(host.user, host.writer, host.principal, host.session, body.tab, body.file, body.token);
    return new Response(result.bytes, { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Figcraft-Access": result.access,
    } });
  } catch {
    return Response.json({ error: "The invite is unavailable" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}

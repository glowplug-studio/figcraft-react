import { onlinePost } from "../../../../lib/supabase/online-post";
import { readSharedDrawing, UnavailableInvite } from "../../../../lib/sharing/join";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  if (typeof host.session !== "string") return new Response(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("file" in body) || typeof body.file !== "string" || !uuid.test(body.file)
    || !("tab" in body) || typeof body.tab !== "string" || !uuid.test(body.tab)
    || ("resume" in body && (typeof body.resume !== "string" || !uuid.test(body.resume)))
    || !("token" in body) || typeof body.token !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.token)) {
    return Response.json({ error: "Invalid invite" }, { status: 400 });
  }
  try {
    const configured = process.env.FIGCRAFT_MAX_PEOPLE;
    const limit = configured === undefined ? 256 : Number(configured);
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid participant limit");
    const result = await readSharedDrawing(host.user, host.writer, host.principal, host.session, body.tab, body.file, body.token,
      "resume" in body ? body.resume as string : undefined, Math.min(limit, 4096));
    return new Response(result.bytes, { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Figcraft-Access": result.access,
      "X-Figcraft-Client": String(result.client), "X-Figcraft-Room": result.room,
    } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "54000") return Response.json({error: "The room has reached its client limit"}, {status: 409});
    const refused = error instanceof UnavailableInvite || code === "42501";
    return Response.json({ error: refused ? "The invite is unavailable" : "The session could not be reached" }, { status: refused ? 403 : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

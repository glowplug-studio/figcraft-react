import {PublicationKeyError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import {verifyServerKey} from "../../../../lib/sharing/operator-publication";
import { onlinePost } from "../../../../lib/supabase/online-post";
import { ingressAddress } from "../../../../lib/sharing/ingress-address";
import { AdminRateError, applyOwnerSharing, ownerSharingStatus } from "../../../../lib/sharing/links";

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const reply = (value: unknown, status = 200) => Response.json(value, {status, headers: {"Cache-Control": "private, no-store"}});

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  const input: unknown = await request.json().catch(() => null);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!uuid(body.file)) return reply({error: "Invalid online file"}, 400);
  try {
    let owner: string | null = host.principal;
    if ("serverKey" in body) {
      await verifyServerKey(host.user, host.writer, body.serverKey);
      owner = null;
    }
    if (body.action === "status") return reply(await ownerSharingStatus(host.writer, owner, body.file));
    if (body.action !== "change" || !uuid(body.revision) || (body.expected !== null && !uuid(body.expected))
      || !Array.isArray(body.revoke) || body.revoke.length > 3
      || !body.revoke.every((id: unknown) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id))
      || (body.seed !== null && (typeof body.seed !== "string" || !/^[0-9a-f]{64}$/.test(body.seed)))) {
      return reply({error: "Invalid sharing change"}, 400);
    }
    const links = await applyOwnerSharing(host.writer, owner, body.file, body.expected, body.revision, body.revoke, body.seed,
      ingressAddress(request.headers,process.env.VERCEL === "1"));
    return reply({links});
  } catch (error) {
    if (error instanceof PublicationKeyError) return reply({error:error.message},403);
    if (error instanceof AdminRateError) return reply({error:error.message},429);
    if (error instanceof Error && error.message === "The file is unavailable") return reply({error: "The file is unavailable"}, 403);
    if ((error instanceof Error && error.message === "Sharing changed elsewhere")
      || (error && typeof error === "object" && "code" in error && error.code === "40001")) {
      return reply({error: "Sharing changed elsewhere"}, 409);
    }
    if (error && typeof error === "object" && "code" in error && ["22023", "23505"].includes(String(error.code))) {
      return reply({error: "The sharing change was rejected"}, 422);
    }
    return reply({error: "Sharing is temporarily unavailable"}, 503);
  }
}

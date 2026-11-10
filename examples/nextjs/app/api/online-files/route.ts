import { publicationCapacity } from "../../../lib/sharing/publication-capacity";
import { finaliseOnlineFile, PublicationCapacityError, PublicationRateError } from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import { isPublishedLinkDigests } from "@glowplug-studio/figcraft-react/backends/supabase";
import { onlinePost } from "../../../lib/supabase/online-post";

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || body.id.length !== 36) {
    return Response.json({ error: "Invalid online file identity" }, { status: 400 });
  }
  const links = "links" in body ? body.links : undefined;
  if (links !== undefined && !isPublishedLinkDigests(links)) return Response.json({ error: "Invalid published links" }, { status: 400 });
  try {
    const listing = await finaliseOnlineFile(host.user, host.writer, body.id, links, publicationCapacity(request.headers, process.env));
    return Response.json(listing, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PublicationRateError) return Response.json({error: error.message}, {status: 429});
    if (error instanceof PublicationCapacityError) return Response.json({error: error.message}, {status: 409});
    return Response.json({ error: "The online file could not be published" }, { status: 422 });
  }
}

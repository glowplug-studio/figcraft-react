import {verifyServerKey} from "../../../lib/sharing/operator-publication";
import { publicationCapacity } from "../../../lib/sharing/publication-capacity";
import { finaliseOnlineFile, finaliseOperatorFile, OperatorRateError, PublicationKeyError, PublicationCapacityError, PublicationRateError } from "@glowplug-studio/figcraft-react/backends/supabase/publication";
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
    const capacity = publicationCapacity(request.headers,process.env);
    let listing;
    if ("serverKey" in body) {
      if (typeof body.serverKey !== "string" || !body.serverKey || [...body.serverKey].length > 128 || !links) {
        return Response.json({error:"Invalid keyed publication"}, {status:400});
      }
      const policy = await verifyServerKey(host.user, host.writer, body.serverKey);
      listing = await finaliseOperatorFile(host.user,host.writer,body.id,links,capacity,policy.file_mb);
    } else {
      listing = await finaliseOnlineFile(host.user,host.writer,body.id,links,capacity);
    }
    return Response.json(listing, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PublicationKeyError) return Response.json({error:error.message},{status:403});
    if (error instanceof OperatorRateError || error instanceof PublicationRateError) return Response.json({error: error.message}, {status: 429});
    if (error instanceof PublicationCapacityError) return Response.json({error: error.message}, {status: 409});
    return Response.json({ error: "The online file could not be published" }, { status: 422 });
  }
}

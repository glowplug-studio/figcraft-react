import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublishedLinks, isPublishedLinkDigests, publishedLinkDigests, type PublishedLinkDigests } from "../published-links";
import { validateOnlineSnapshot } from "../../engine/sharing/publication";
import { onlineFileInfo, onlineSnapshotPath } from "./online-files";

/** Server only. The authenticated client must be able to read the exact staged object. */
export async function finaliseOnlineFile(user: SupabaseClient, writer: SupabaseClient, id: string, links?: PublishedLinkDigests) {
  const claims = await user.auth.getClaims();
  const principal = claims.data?.claims.sub;
  if (claims.error || !principal) throw new Error("Sign in to publish a file");
  const path = onlineSnapshotPath(principal, id);
  const storage = user.storage.from("figcraft-files");
  const object = await storage.info(path);
  if (object.error) throw object.error;
  if (links !== undefined && !isPublishedLinkDigests(links)) throw new Error("Invalid published links");
  const prior = await user.from("online_files").select("name").eq("id", id)
    .eq("owner_id", principal).eq("snapshot_id", object.data.id).maybeSingle();
  if (prior.error) throw prior.error;
  let name: string;
  if (prior.data) name = prior.data.name;
  else {
    const download = await storage.download(path);
    if (download.error) throw download.error;
    name = (await validateOnlineSnapshot(download.data, id)).name;
  }
  const pair = links ?? await publishedLinkDigests(createPublishedLinks());
  const reply = await writer.rpc("finalise_online_publication", {
    actor: principal, target: id, snapshot: object.data.id, title: name, links: pair, verify_pair: links !== undefined,
  }).single<{ id: string; name: string; created_at: string }>();
  if (reply.error) throw reply.error;
  return onlineFileInfo(reply.data);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublishedLinks, isPublishedLinkDigests, publishedLinkDigests, type PublishedLinkDigests } from "../published-links";
import { validateOnlineSnapshot } from "../../engine/sharing/publication";
import { onlineFileInfo, onlineSnapshotPath } from "./online-files";

/** Only the trusted host supplies these overrides. PostgreSQL owns the native defaults. */
export interface PublicationCapacity {
  address: string;
  max_files?: number;
  max_files_per_ip?: number;
  max_bytes_per_ip?: number;
  max_total_bytes?: number;
}

export class PublicationCapacityError extends Error {}

async function measurePriorPublications(writer: SupabaseClient) {
  const missing = await writer.rpc("unmeasured_online_files")
    .returns<{file_id: string; owner_id: string; snapshot_id: string}[]>();
  if (missing.error) throw missing.error;
  if (!Array.isArray(missing.data)) throw new Error("Invalid retained file inventory");
  for (const row of missing.data) {
    const path = onlineSnapshotPath(row.owner_id, row.file_id);
    const download = await writer.storage.from("figcraft-files").download(path);
    if (download.error) {
      const retained = await writer.from("online_files").select("id").eq("id", row.file_id)
        .eq("snapshot_id", row.snapshot_id).maybeSingle();
      if (retained.error) throw retained.error;
      if (!retained.data) continue;
      throw download.error;
    }
    // Files accepted by a previous version retain their actual size, even if a
    // new upload of the same drawing would exceed today's publication limit.
    const { snapshotBytes } = await validateOnlineSnapshot(download.data, row.file_id, Infinity);
    const saved = await writer.rpc("record_prior_online_usage", {
      target: row.file_id, snapshot: row.snapshot_id, measured: snapshotBytes,
    });
    if (saved.error) throw saved.error;
  }
}

/** Server only. The authenticated client must be able to read the exact staged object. */
export async function finaliseOnlineFile(user: SupabaseClient, writer: SupabaseClient, id: string, links?: PublishedLinkDigests,
  capacity: PublicationCapacity = {address: "127.0.0.1"}) {
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
  let name: string, measured: number | null = null;
  if (prior.data) name = prior.data.name;
  else {
    const download = await storage.download(path);
    if (download.error) throw download.error;
    const validated = await validateOnlineSnapshot(download.data, id);
    name = validated.name;
    measured = validated.snapshotBytes;
  }
  const pair = links ?? await publishedLinkDigests(createPublishedLinks());
  for (;;) {
    const reply = await writer.rpc("keep_online_publication", {
      ...capacity, actor: principal, target: id, snapshot: object.data.id, title: name,
      links: pair, verify_pair: links !== undefined, measured,
    }).single<{ id: string; name: string; created_at: string }>();
    if (!reply.error) return onlineFileInfo(reply.data);
    if (reply.error.code === "FC002") throw new PublicationCapacityError(reply.error.message);
    if (reply.error.code !== "FC001") throw reply.error;
    await measurePriorPublications(writer);
  }
}

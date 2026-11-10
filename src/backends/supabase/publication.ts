import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublishedLinks, isPublishedLinkDigests, publishedLinkDigests, type PublishedLinkDigests } from "../published-links";
import { validateOnlineSnapshot } from "../../engine/sharing/publication";
import { onlineFileInfo, onlineSnapshotPath } from "./online-files";

/** Only the trusted host supplies these overrides. PostgreSQL owns the native defaults. */
export interface PublicationCapacity {
  address: string;
  publishes_per_hour?: number;
  max_files?: number;
  max_files_per_ip?: number;
  max_bytes_per_ip?: number;
  max_total_bytes?: number;
}

export class PublicationCapacityError extends Error {}
export class PublicationRateError extends Error {
  constructor() { super("Too many files published from your address lately: try again in an hour"); }
}

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
  const { publishes_per_hour, ...retained } = capacity;
  const readPrior = async () => {
    const prior = await user.from("online_files").select("name").eq("id", id)
      .eq("owner_id", principal).eq("snapshot_id", object.data.id).maybeSingle();
    if (prior.error) throw prior.error;
    return prior.data;
  };
  let prior = await readPrior();
  if (!prior) {
    const admitted = await writer.rpc("admit_online_publication", {
      address: capacity.address, ...(publishes_per_hour !== undefined && {hourly: publishes_per_hour}),
    });
    if (admitted.error) throw admitted.error;
    if (typeof admitted.data !== "boolean") throw new Error("Invalid publication admission receipt");
    if (!admitted.data) {
      // Another worker may just have committed the original acknowledgement.
      prior = await readPrior();
      if (!prior) throw new PublicationRateError();
    }
  }
  let name: string, measured: number | null = null;
  if (prior) name = prior.name;
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
      ...retained, actor: principal, target: id, snapshot: object.data.id, title: name,
      links: pair, verify_pair: links !== undefined, measured,
    }).single<{ id: string; name: string; created_at: string }>();
    if (!reply.error) {
      const info = await user.rpc("online_host_information", {target: id}).single<{expires: string | null}>();
      if (info.error) throw info.error;
      return onlineFileInfo({...reply.data, online_expiry_epoch: info.data.expires});
    }
    if (reply.error.code === "FC002") throw new PublicationCapacityError(reply.error.message);
    if (reply.error.code !== "FC001") throw reply.error;
    await measurePriorPublications(writer);
  }
}

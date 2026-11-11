import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublishedLinks, isPublishedLinkDigests, publishedLinkDigests, type PublishedLinkDigests } from "../published-links";
import { PUBLIC_FILE_BYTES, validateOnlineSnapshot } from "../../engine/sharing/publication";
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
export class PublicationKeyError extends Error {}
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
  const host = await user.rpc("online_host_information",{target:null})
    .single<{open_publish?:boolean;file_mb?:number}>();
  if (host.error) throw host.error;
  const fileLimit = host.data.file_mb === undefined ? PUBLIC_FILE_BYTES : host.data.file_mb * 1024 * 1024;
  const { publishes_per_hour, ...retained } = capacity;
  const readPrior = async () => {
    const prior = await user.from("online_files").select("name").eq("id", id)
      .eq("owner_id", principal).eq("snapshot_id", object.data.id).maybeSingle();
    if (prior.error) throw prior.error;
    return prior.data;
  };
  let prior = await readPrior();
  if (!prior) {
    if (host.data.open_publish === false) throw new PublicationKeyError("This server takes files only from people who have its key");
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
    const validated = await validateOnlineSnapshot(download.data, id, fileLimit);
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

/** Store content under an immutable, private host namespace. A lost acknowledgement can reuse the object. */
export async function keepHostArchive(writer: SupabaseClient, namespace: "operator" | "library", id: string, archive: Blob) {
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256",await archive.arrayBuffer()));
  const hash = Array.from(checksum,b => b.toString(16).padStart(2,"0")).join("");
  const destination = namespace + "/" + id + "/" + hash + ".figcraft";
  const bucket = writer.storage.from("figcraft-files");
  const saved = await bucket.upload(destination,archive,{upsert:false,contentType:"application/octet-stream"});
  if (saved.error && saved.error.status !== 409 && saved.error.statusCode !== "Duplicate" && saved.error.statusCode !== "409") throw saved.error;
  const snapshot = saved.data?.id ?? (await bucket.info(destination)).data?.id;
  if (!snapshot) throw new Error("The host archive is unavailable");
  return snapshot;
}

export class OperatorRateError extends Error {}

/** Only a trusted, key-authenticated host may call this with its privileged writer. */
export async function finaliseOperatorFile(user: SupabaseClient, writer: SupabaseClient, id: string,
  links: PublishedLinkDigests, capacity: PublicationCapacity, maxFileMb: number) {
  const claims = await user.auth.getClaims();
  const actor = claims.data?.claims.sub;
  if (claims.error || !actor) throw new Error("Sign in to publish a file");
  const readPrior = async () => {
    const {data,error} = await writer.from("online_files").select("published_without_key").eq("id",id).maybeSingle();
    if (error) throw error;
    if (data?.published_without_key) throw new Error("The file already has a different publication receipt");
    return data;
  };
  let prior = await readPrior();
  if (!prior) {
    const admission = await writer.rpc("admit_keyed_publication",{address:capacity.address});
    if (admission.error) throw admission.error;
    if (admission.data !== true) {
      prior = await readPrior();
      if (!prior) throw new OperatorRateError("Too many changes to this server's files from your address: wait a minute and try again");
    }
  }
  const upload = await user.storage.from("figcraft-files").download(onlineSnapshotPath(actor,id));
  if (upload.error) throw upload.error;
  const archive = upload.data;
  const validated = await validateOnlineSnapshot(archive,id,prior ? Infinity : maxFileMb * 1024 * 1024);
  const snapshot = await keepHostArchive(writer,"operator",id,archive);
  const result = await writer.rpc("keep_operator_publication",{target:id,snapshot,title:validated.name,links,
    measured:validated.snapshotBytes,...(capacity.max_files === undefined ? {} : {max_files:capacity.max_files})})
    .single<{id:string;name:string;created_at:string}>();
  if (result.error?.code === "FC002") throw new PublicationCapacityError(result.error.message);
  if (result.error) throw result.error;
  return {id:result.data.id,name:result.data.name,created:result.data.created_at,expires:null,managedByKey:true as const};
}

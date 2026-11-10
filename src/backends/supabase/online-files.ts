import {PUBLIC_FILE_BYTES} from "../../engine/sharing/publication";
import { readTeamDirectory } from "../../engine/sharing/team-directory";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlineFileInfo, OnlineFileStore } from "../online-files";

const bucket = "figcraft-files";
const columns = "id,name,created_at,online_expiry_epoch";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function onlineSnapshotPath(principal: string, id: string) {
  if (!uuid.test(principal) || !uuid.test(id)) throw new Error("Invalid online file identity");
  return principal + "/" + id + ".figcraft";
}

export function onlineFileInfo(row: { id: string; name: string; created_at: string; online_expiry_epoch?: string | null }): OnlineFileInfo {
  return { id: row.id, name: row.name, created: row.created_at, expires: row.online_expiry_epoch };
}

async function sameBytes(first: Blob, second: Blob) {
  if (first.size !== second.size) return false;
  const [a, b] = await Promise.all([first.arrayBuffer(), second.arrayBuffer()]);
  const other = new Uint8Array(b);
  return new Uint8Array(a).every((byte, index) => byte === other[index]);
}

/** The request-scoped publisher validates staged bytes before making a listing visible. */
export class SupabaseOnlineFileStore implements OnlineFileStore {
  constructor(
    private client: SupabaseClient,
    private principal: string,
    private finalise: (id: string) => Promise<OnlineFileInfo>,
  ) {}

  async teamDirectory() {
    const {data, error} = await this.client.rpc("online_team_directory");
    if (error?.code === "PGRST202") return {state:"none" as const};
    if (error) throw error;
    return readTeamDirectory(data);
  }

  async resolveTeamFile(file: string): Promise<{file: string; token: string}> {
    // Native file IDs are broader than this provider's UUID keys.
    const {data, error} = await this.client.rpc("resolve_team_file", {target: uuid.test(file) ? file : null});
    if (error) throw new Error("The team file could not be reached");
    if (data?.status === "disabled") throw new Error("This server keeps no team list");
    if (data?.status === "unshared") throw new Error("This file isn't shared now");
    if (data?.status === "full" && typeof data.limit === "string" && /^\d+$/.test(data.limit)) {
      throw new Error("A file has at most " + data.limit + " links: revoke one first");
    }
    if (data?.file !== file || typeof data.token !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(data.token)) {
      throw new Error("Invalid team file receipt");
    }
    return {file, token:data.token};
  }

  async hosting(file?: string) {
    const result = await this.client.rpc("online_host_information", {target: file ?? null})
      .single<{idle_seconds: string; expires: string | null; operator_contact?: string; terms_url?: string; accepts_reports?: boolean}>();
    if (result.error) throw result.error;
    const info = result.data;
    return {idleSeconds: info.idle_seconds, expires: info.expires, operator: info.operator_contact,
      terms: info.terms_url, reports: info.accepts_reports === true, open: true, maxFileMb: PUBLIC_FILE_BYTES / (1024 * 1024)};
  }

  async publish(id: string, snapshot: Blob) {
    const path = onlineSnapshotPath(this.principal, id);
    const storage = this.client.storage.from(bucket);
    const uploaded = await storage.upload(path, snapshot, { contentType: "application/octet-stream", upsert: false });
    if (uploaded.error) {
      if (uploaded.error.status !== 409 && uploaded.error.statusCode !== "Duplicate" && uploaded.error.statusCode !== "409") throw uploaded.error;
      const previous = await storage.download(path);
      if (previous.error) throw previous.error;
      if (!await sameBytes(previous.data, snapshot)) throw new Error("This publication ID already has a different snapshot");
    }
    return this.finalise(id);
  }

  async owned(ids: readonly string[]) {
    if (!ids.length) return [];
    if (ids.length > 200) throw new Error("Ask about at most 200 files at a time");
    for (const id of ids) onlineSnapshotPath(this.principal, id);
    const { data, error } = await this.client.from("online_files").select(columns).eq("owner_id", this.principal).in("id", ids);
    if (error) throw error;
    const byId = new Map(data.map(row => [row.id, onlineFileInfo(row)]));
    return ids.flatMap(id => byId.get(id) ?? []);
  }

  async open(id: string) {
    const path = onlineSnapshotPath(this.principal, id);
    if (!(await this.owned([id])).length) throw new Error("This file is no longer on its server");
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error) throw error;
    return data;
  }

  async rename(id: string, name: string) {
    const { data, error } = await this.client.from("online_files").update({ name }).eq("id", id).select(columns).single();
    if (error) throw error;
    return onlineFileInfo(data);
  }

  async remove(id: string) {
    const { error } = await this.client.storage.from(bucket).remove([onlineSnapshotPath(this.principal, id)]);
    if (error) throw error;
  }
}

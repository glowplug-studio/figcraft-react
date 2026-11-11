import type { SupabaseClient } from "@supabase/supabase-js";
import { highestIdSpace } from "../../engine/branch-ids";
import { decodeFigcraft } from "../../engine/file-format";

type Welcome = { client: number; access: "view" | "edit" | "comment"; path: string };

/** Validate the stored snapshot on first join, then atomically grant one physical connection and one namespace. */
export async function joinLiveFile(writer: SupabaseClient, request: {
  actor: string; auth_session: string; tab: string; target: string; presented_hash: string; resume_hash: string; peer_limit: number;
}): Promise<Welcome> {
  let snapshot: string | null = null, floor: number | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await writer.rpc("join_live_file", { ...request, scanned_snapshot: snapshot, scanned_floor: floor });
    if (result.error) throw result.error;
    const data: Partial<Welcome> & { scan?: string } = result.data ?? {};
    if (typeof data?.path !== "string") throw new Error("Invalid live file receipt");
    if (typeof data.scan !== "string") {
      if (typeof data.client !== "number" || !Number.isInteger(data.client) || data.client < 1 || data.client >= 0xffffffff ||
          (data.access !== "view" && data.access !== "edit" && data.access !== "comment")) throw new Error("Invalid live client receipt");
      return { client: data.client, access: data.access, path: data.path };
    }
    const read = await writer.storage.from("figcraft-files").download(data.path);
    if (read.error) throw read.error;
    const decoded = await decodeFigcraft(read.data);
    floor = highestIdSpace(decoded.document);
    snapshot = data.scan;
  }
  throw new Error("The shared snapshot changed during admission");
}

export { readLiveUpdates, submitLiveBatch } from "./live-journal";
export { maxLiveMessageBytes } from "../../engine/sharing/live-wire";

export {leaveLiveConnection,sendLivePresence,presenceBroadcaster} from "./live-presence";

import type { LiveUpdate } from "../../engine/sharing/live-transport";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeFigcraft } from "../../engine/file-format";
import { idString } from "../../engine/native-values";
import { admitLiveChanges, type RemovedLiveIds } from "../../engine/sharing/live-admission";
import { liveReplica, type LiveChange, type LiveReplica } from "../../engine/sharing/live-changes";
import { makeLiveCheckpoint, restoreLiveCheckpoint } from "../../engine/sharing/live-checkpoint";
import { applyLive } from "../../engine/sharing/live-replica";
import { liveChangeWeight, readLiveChanges } from "../../engine/sharing/live-wire";

export interface LiveConnection {actor: string; login: string; tab: string; target: string}
type AuthorityRead = LiveUpdate & {path: string; checkpointSeq: string; removed: RemovedLiveIds; highest: number;
  issued: number[]; logBytes: number; logChanges: number};

async function query(writer: SupabaseClient, conn: LiveConnection, after: string | null, validation: boolean) {
  const result = await writer.rpc("read_live_journal",{...conn,after_seq:after,validation});
  if (result.error) throw result.error;
  return result.data;
}

export async function readLiveUpdates(writer: SupabaseClient, conn: LiveConnection, after: string | null): Promise<LiveUpdate> {
  const result = await query(writer,conn,after === null ? null : idString(after,"sequence"),false);
  // The client has its authenticated starting archive. Internal Storage paths and admission metadata stay on the host.
  const {path:_private,...update} = result;
  return update;
}

async function confirmed(writer: SupabaseClient, state: AuthorityRead): Promise<LiveReplica> {
  let replica: LiveReplica;
  if (state.checkpoint) replica = await restoreLiveCheckpoint(state.checkpoint);
  else {
    const data = await writer.storage.from("figcraft-files").download(state.path);
    if (data.error) throw data.error;
    replica = liveReplica((await decodeFigcraft(data.data)).document);
  }
  let seq = BigInt(state.checkpointSeq);
  for (const item of state.batches) {
    if (BigInt(item.sequence) !== ++seq) throw new Error("Incomplete live journal");
    replica = (await applyLive(replica,item.changes)).replica;
  }
  if (seq !== BigInt(state.sequence)) throw new Error("Incomplete live checkpoint");
  return replica;
}

export async function submitLiveBatch(writer: SupabaseClient, conn: LiveConnection, batch: string, base: string, raw: unknown) {
  const batchId = BigInt(idString(batch,"batch")), baseSeq = BigInt(idString(base,"base sequence"));
  if (!batchId) throw new Error("A batch ID must be positive");
  let changes: LiveChange[];
  try { changes = readLiveChanges(raw); }
  catch (error) { throw Object.assign(new Error("Invalid live changes",{cause:error}),{code:"22023"}); }
  for (let attempt = 0; attempt < 8; attempt++) {
    const state: AuthorityRead = await query(writer,conn,null,true);
    if (batchId <= BigInt(state.lastBatch)) return {decision:"processed",sequence:state.sequence,refused:state.refused.includes(batch)};
    const sequence = BigInt(state.sequence);
    const replica = await confirmed(writer,state);
    let proposed: Awaited<ReturnType<typeof admitLiveChanges>> | undefined;
    let reason: string | undefined;
    try {
      proposed = await admitLiveChanges(replica,state.removed,new Set(state.issued),
        {access:state.access,client:state.client,base:baseSeq,sequence,changes});
    } catch (error) {
      reason = error instanceof Error ? error.message : "Invalid live batch";
    }
    const weight = proposed ? liveChangeWeight(changes) : 0;
    const snapshot = proposed && (sequence - BigInt(state.checkpointSeq) >= 127n ||
      state.logBytes + weight > 64 * 1024 * 1024 || state.logChanges + changes.length > 1_000_000)
      ? await makeLiveCheckpoint(proposed.replica) : null;
    const result = await writer.rpc("commit_live_batch",{...conn,expected:state.sequence,issued_floor:state.highest,batch,
      accepted:!!proposed,ops:proposed ? changes : [],removed_ids:proposed?.removed ?? null,stored_checkpoint:snapshot,weight_bytes:weight});
    if (result.error) {
      if (result.error.code === "40P01" || result.error.code === "40001") continue;
      throw result.error;
    }
    if (result.data === "retry" || result.data === "processed") continue;
    if (!proposed && result.data === "refused") return {decision:"refused",reason,sequence:state.sequence,refused:true};
    if (proposed && result.data === "accepted") return {decision:"accepted",sequence:String(sequence+1n),refused:false};
    throw new Error("Invalid live journal decision");
  }
  throw Object.assign(new Error("Concurrent edits require a retry"),{code:"40001"});
}

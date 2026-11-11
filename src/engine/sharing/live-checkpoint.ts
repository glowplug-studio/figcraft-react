import { initialPositions } from "../branch-diff";
import { validatePosition } from "../branch-position";
import {idString} from "../native-values";
import { fileData } from "../file-bytes";
import { decodeFigcraft, encodeFigcraft } from "../file-format";
import { base64Bytes } from "../recovery";
import type { LiveReplica } from "./live-changes";

/** Archive the confirmed drawing only. Named versions and private recovery remain with their owning file. */
export interface LiveCheckpoint {
  archive: string;
  currentPageReference?:string|null;
  positions: [string,string][];
}

export async function makeLiveCheckpoint(replica: LiveReplica): Promise<LiveCheckpoint> {
  const fresh = initialPositions(replica.document);
  return {...(replica.currentPageReference!==undefined && {currentPageReference:replica.currentPageReference}),archive:base64Bytes(await encodeFigcraft(replica.document)),
    positions:[...replica.positions].filter(([id,key]) => fresh.get(id) !== key)};
}

export async function restoreLiveCheckpoint(checkpoint: LiveCheckpoint): Promise<LiveReplica> {
  const {document} = await decodeFigcraft(fileData(checkpoint.archive,Math.floor(checkpoint.archive.length * 3/4)));
  const positions = initialPositions(document);
  for (const [id,key] of checkpoint.positions) {
    if (!positions.has(id)) throw new Error("Checkpoint position refers to a missing layer");
    validatePosition(key);
    positions.set(id,key);
  }
  const {currentPageReference}=checkpoint;
  if(currentPageReference!=null)idString(currentPageReference,"checkpoint current page");
  return {document,positions,...(currentPageReference!==undefined && {currentPageReference})};
}

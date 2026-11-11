import type {Document} from "../document";
import {diffLive, type LiveReplica} from "./live-changes";
import type {OnlineRecoveryNote} from "../../backends/recovery";
import {onlineServerKey} from "./remembered-files";
import type {LiveIdentity} from "./live-transport";

export interface OnlineRecoveryPosition extends LiveIdentity {
  sequence: string;
}

/** Compare the crashed drawing with the complete, authenticated server welcome. */
export async function recoveredDrawing(
  confirmed: LiveReplica,
  copy: Document,
  stored: OnlineRecoveryPosition,
  current: OnlineRecoveryPosition,
  access: "edit" | "view" | "comment",
): Promise<"equal" | "apply" | "copy"> {
  try {
    const {changes} = await diffLive(confirmed, copy);
    if (!changes.length) return "equal";
    if (access !== "edit" || stored.room !== current.room || stored.client !== current.client ||
        stored.sequence !== current.sequence) return "copy";
    const ownsNewLayers = changes.every(change => change.type !== "create" ||
      (BigInt(change.id) >> 32n) === BigInt(current.client));
    return ownsNewLayers ? "apply" : "copy";
  } catch {
    return "copy";
  }
}

/** A malformed optional note must never make its native archive unreadable. */
export function readOnlineNote(value: unknown): OnlineRecoveryNote | null {
  if (!value || typeof value !== "object") return null;
  const note = value as Partial<OnlineRecoveryNote>;
  const bounded = (text: unknown): text is string =>
    typeof text === "string" && text.length > 0 && text.length <= 512 && !/[\p{Cc}\p{White_Space}]/u.test(text);
  if (!bounded(note.server) || note.server.includes("?") || !onlineServerKey(note.server) ||
      !bounded(note.file) || !/^[a-zA-Z0-9_-]{1,64}$/.test(note.file) || !bounded(note.room) ||
      typeof note.client !== "number" || !Number.isInteger(note.client) || note.client < 1 || note.client >= 0xffffffff ||
      typeof note.sequence !== "string" || !/^(0|[1-9]\d{0,19})$/.test(note.sequence) ||
      BigInt(note.sequence) > 0xffffffffffffffffn || !bounded(note.resume?.handle) || !bounded(note.resume?.secret)) return null;
  const {server,file,room,client,sequence,resume}=note;
  return {server,file,room,client,sequence,resume:{handle:resume.handle,secret:resume.secret}};
}

import type {LivePeerSample,PeopleWelcome} from "./live-presence";
import type { LiveChange } from "./live-changes";
import type { LiveCheckpoint } from "./live-checkpoint";

export interface LiveAccepted {sequence: string; client: number; batch: string; changes: LiveChange[]}
export interface LiveUpdate {
  client: number; access: "edit" | "comment" | "view"; sequence: string; lastBatch: string; refused: string[];
  reset: boolean; checkpoint?: LiveCheckpoint | null; checkpointSeq?: string; batches: LiveAccepted[];
}
export interface LiveIdentity {room:string;client:number}
export interface LiveTransport {
  readonly archive: Blob;
  /** Current authenticated welcome. Both values survive a physical reconnect. */
  readonly identity?: LiveIdentity;
  people?: {
    readonly welcome?:PeopleWelcome;
    send(sample:LivePeerSample):Promise<{client:number;name:string;colour:string;generation:string}>;
    listen(receive:(message:unknown)=>void,ready:()=>void):()=>void;
  };
  listen?(wake: () => void): () => void;
  read(after: string | null): Promise<LiveUpdate>;
  submit(batch: string, base: string, changes: readonly LiveChange[]): Promise<{
    decision: "accepted" | "processed" | "refused"; sequence: string; reason?: string; refused: boolean;
  }>;
}

import type {LibraryUsageSummary,LibraryUsageReport} from "../engine/sharing/library-usage";
import type { TeamDirectory } from "../engine/sharing/team-directory";

/** A server listing. The document itself retains the title captured at publication. */
export interface OnlineFileInfo {
  id: string;
  name: string;
  created: string;
  managedByKey?: true;
  /** Identifiers reported in a checked owner listing, including an empty list after revocation. */
  linkIds?:readonly string[];
  /** UTC epoch seconds as decimal text to preserve the native u64 range. */
  expires?: string | null;
}

export interface OnlineHostInformation {
  idleSeconds: string;
  expires: string | null;
  operator?: string;
  terms?: string;
  reports?: boolean;
  open?: boolean;
  maxFileMb?: number;
}

/** An embedding host supplies the authenticated store. Publication IDs survive retries. */
export interface OnlineFileStore {
  teamDirectory?(): Promise<TeamDirectory>;
  hosting?(file?: string): Promise<OnlineHostInformation>;
  publish(id: string, snapshot: Blob, serverKey?: string): Promise<OnlineFileInfo>;
  owned(ids: readonly string[],includeLinkIds?:boolean): Promise<readonly OnlineFileInfo[]>;
  open(id: string): Promise<Blob>;
  rename(id: string, name: string): Promise<OnlineFileInfo>;
  remove(id: string): Promise<void>;
}

/** Account-scoped device preference. Authority is checked afresh by the configured server. */
export interface RememberedOnlineFile {
  /** Original credential-free address when its spelling differs from the device lookup key. */
  recordedAddress?:string;
  server: string;
  file: string;
  name: string;
  created: number;
  opened: number;
}

/** Private, immutable upload retained until the host confirms the listing. */
export interface PendingOnlinePublication {
  file: string;
  name: string;
  server: string;
  started: number;
  snapshot: Blob;
  requiresKey?: true;
}

export interface OnlineFileRegistry {
  files: readonly RememberedOnlineFile[];
  pending: readonly PendingOnlinePublication[];
}

export interface OnlineFileDevice {
  cachedCodes?(principal:string,server:string,file:string):Promise<OwnerShareSummary["codes"]>;
  onlineRegistry(
    principal: string,
    update?: (current: OnlineFileRegistry) => OnlineFileRegistry,
  ): Promise<OnlineFileRegistry>;
  onlineFiles(
    principal: string,
    update?: (current: readonly RememberedOnlineFile[]) => readonly RememberedOnlineFile[],
  ): Promise<readonly RememberedOnlineFile[]>;
}

/** One authenticated guest tab. Bearer secrets remain in the host adapter. */
export interface OnlineGuestSession {
  file: string;
  connection: string;
  client?: number;
  /** Logical room identity survives ordinary reconnects. */
  room?: string;
  access: "edit" | "view" | "comment";
  /** The device opened its recorded publication. This flag confers no management authority. */
  openedAsOwner?: true;
  /** The current authenticated account owns this file. The server rechecks every removal. */
  canRemovePeople?: boolean;
  ended?: GuestSessionEnd;
  reconnectAttempt?: number;
}
export type GuestSessionEnd = "stopped" | "removed" | "expelled" | "unavailable";
export type GuestWelcome = Pick<OnlineGuestSession, "access" | "client" | "room" | "canRemovePeople">;
export type GuestConnectionStatus = {attempt: number} | GuestWelcome;
export interface SessionDetails {
  identity?:{name:string;colour:string};
  link:string;url:string;address:string;network:boolean;
  published?:{server:string;file:string;name:string;edit:string;view:string;owner:null;expires:number|string|null};
  share?:{via:"online";access:OnlineGuestSession["access"];shared:boolean;editCode:string|null;commentCode:string|null;
    viewCode:string|null;editLink:string|null;commentLink:string|null;viewLink:string|null};
  code?:string|null;
  hosting?:{open:boolean;operator:string;terms:string;idleDays:number|null;maxFileMb:number;expires:number|string|null};
}
export interface OnlineInvitations {
  /** Read authorised, in-memory invitation details for this logical session only. */
  inspect?(connection:string):SessionDetails|undefined;
  live?(connection: string): import("../engine/sharing/live-transport").LiveTransport | undefined;
  /** Redeem this device's original edit link. Older records may predate link storage. */
  joinOwned?(file: string, managedByKey?: boolean, listing?:Pick<OnlineFileInfo,"name"|"expires">, recorded?:boolean): Promise<{session: OnlineGuestSession; archive: Blob} | undefined>;
  sessionHosting?(connection:string):Promise<OnlineHostInformation>;
  serverInfo?(server:string):Promise<OnlineHostInformation>;
  removePerson?(connection:string,client:number):Promise<{removed:number;name:string|null}>;
  report?(connection: string, reason: string): Promise<void>;
  retryNow?(connection: string): void;
  rejoin?(connection: string): Promise<OnlineGuestSession["access"] | GuestWelcome>;
  watch?(connection: string, ended: (reason: GuestSessionEnd) => void, changed?: (status: GuestConnectionStatus) => void): () => void;
  canAttach?(connection:string):boolean;
  beginJoin?(invite:string):{connection:string;completed:Promise<void>};
  join?(invite: string): Promise<void>;
  showJoin(): void;
  subscribe(joined: (session: OnlineGuestSession, archive: Blob, current?:()=>boolean) => Promise<void>, joining?: (connection:string, failed?:string|null) => void): () => void;
  copyPublished(file: string, access: "edit" | "view"): Promise<void>;
  leave(connection: string): Promise<void>;
}

export interface OwnerShareSummary {
  codes: Partial<Record<OnlineGuestSession["access"], string>>;
  pending?: "start" | "stop";
}
export interface OnlineOwnerSharing {
  /** Capture the locally issued group before the server checks it, so a later reshare survives an old reply. */
  prepareRefresh?(file:string):Promise<(retained:readonly string[])=>Promise<void>>;
  read(file: string, refresh?: boolean): Promise<OwnerShareSummary>;
  access?(file:string):OnlineGuestSession["access"];
  selectAccess?(file:string,access:OnlineGuestSession["access"]):void;
  change(file: string, enabled: boolean): Promise<OwnerShareSummary>;
  copy(file: string, access: OnlineGuestSession["access"], format: "code" | "link"): Promise<void>;
}

export interface OnlineWorkspaceHost {
  /** Optional authenticated adapter for another server remembered on this device. */
  forServer?(server:string):OnlineWorkspaceHost|undefined;
  libraries?: OnlineTeamLibraries;
  supportsServerKey?: boolean;
  /** Destination receiving the raw key when the host proxies administrative requests. */
  operatorOrigin?:string;
  releasePublished?(file: string): void;
  serverKeyChanged?(key: string): void;
  sharing?: OnlineOwnerSharing;
  server: string;
  store: OnlineFileStore;
  device: OnlineFileDevice;
  invitations?: OnlineInvitations;
}

export type TeamLibraryReply = {state:"empty"} | {state:"unchanged"; version:string} |
  {state:"available"; version:string; archive:Blob};

/** Paths identify a private credential held by the host. They may be saved in a drawing. */
export interface OnlineTeamLibraries {
  fromInvite(text: string): Promise<string>;
  fromSession(connection: string): Promise<string>;
  fetch(path: string, have: string | null, usage?:LibraryUsageReport): Promise<TeamLibraryReply>;
  trusted?(remember?:string):Promise<readonly string[]>;
  usage?(path:string,days:number):Promise<LibraryUsageSummary>;
  publish(path: string, archive: Blob, submission: string): Promise<string>;
}

/** A server listing. The document itself retains the title captured at publication. */
export interface OnlineFileInfo {
  id: string;
  name: string;
  created: string;
}

/** An embedding host supplies the authenticated store. Publication IDs survive retries. */
export interface OnlineFileStore {
  publish(id: string, snapshot: Blob): Promise<OnlineFileInfo>;
  owned(ids: readonly string[]): Promise<readonly OnlineFileInfo[]>;
  open(id: string): Promise<Blob>;
  rename(id: string, name: string): Promise<OnlineFileInfo>;
  remove(id: string): Promise<void>;
}

/** Account-scoped device preference. Authority is checked afresh by the configured server. */
export interface RememberedOnlineFile {
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
}

export interface OnlineFileRegistry {
  files: readonly RememberedOnlineFile[];
  pending: readonly PendingOnlinePublication[];
}

export interface OnlineFileDevice {
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
  access: "edit" | "view" | "comment";
  /** The device opened its recorded publication. This flag confers no management authority. */
  openedAsOwner?: true;
  ended?: GuestSessionEnd;
  reconnectAttempt?: number;
}
export type GuestSessionEnd = "stopped" | "removed" | "unavailable";
export type GuestConnectionStatus = {attempt: number} | {access: OnlineGuestSession["access"]};
export interface OnlineInvitations {
  /** Redeem this device's original edit link. Older records may predate link storage. */
  joinOwned?(file: string): Promise<{session: OnlineGuestSession; archive: Blob} | undefined>;
  retryNow?(connection: string): void;
  rejoin?(connection: string): Promise<OnlineGuestSession["access"]>;
  watch?(connection: string, ended: (reason: GuestSessionEnd) => void, changed?: (status: GuestConnectionStatus) => void): () => void;
  showJoin(): void;
  subscribe(joined: (session: OnlineGuestSession, archive: Blob) => Promise<void>): () => void;
  copyPublished(file: string, access: "edit" | "view"): Promise<void>;
  leave(connection: string): Promise<void>;
}

export interface OwnerShareSummary {
  codes: Partial<Record<OnlineGuestSession["access"], string>>;
  pending?: "start" | "stop";
}
export interface OnlineOwnerSharing {
  read(file: string, refresh?: boolean): Promise<OwnerShareSummary>;
  change(file: string, enabled: boolean): Promise<OwnerShareSummary>;
  copy(file: string, access: OnlineGuestSession["access"], format: "code" | "link"): Promise<void>;
}

export interface OnlineWorkspaceHost {
  sharing?: OnlineOwnerSharing;
  server: string;
  store: OnlineFileStore;
  device: OnlineFileDevice;
  invitations?: OnlineInvitations;
}

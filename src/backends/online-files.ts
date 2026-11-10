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
  ended?: GuestSessionEnd;
}
export type GuestSessionEnd = "stopped" | "removed" | "unavailable";
export interface OnlineInvitations {
  rejoin?(connection: string): Promise<OnlineGuestSession["access"]>;
  watch?(connection: string, ended: (reason: GuestSessionEnd) => void): () => void;
  showJoin(): void;
  subscribe(joined: (session: OnlineGuestSession, archive: Blob) => Promise<void>): () => void;
  copyPublished(file: string, access: "edit" | "view"): Promise<void>;
  leave(connection: string): Promise<void>;
}

export interface OnlineWorkspaceHost {
  server: string;
  store: OnlineFileStore;
  device: OnlineFileDevice;
  invitations?: OnlineInvitations;
}

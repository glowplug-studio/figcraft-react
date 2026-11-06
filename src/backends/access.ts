import type { Unsubscribe } from "./identity";

export type DocumentAccessLevel = "none" | "view" | "comment" | "edit";

export type DocumentCapability =
  | "document.read"
  | "document.comment"
  | "document.edit"
  | "document.rename"
  | "document.delete"
  | "document.manageSharing"
  | "library.publish";

export type AccessGrantSource =
  | "none"
  | "owner"
  | "membership"
  | "shareLink";

export interface OwnerReference {
  id: string;
}

/** A server-resolved view of one principal's access to one document. */
export interface DocumentAccessSnapshot {
  documentId: string;
  status: "loading" | "ready" | "error";
  level: DocumentAccessLevel;
  capabilities: readonly DocumentCapability[];
  source: AccessGrantSource;
  owner: OwnerReference | null;
  revision: string;
  expiresAt?: string;
  error?: string;
}

export type DocumentAccessListener = (snapshot: DocumentAccessSnapshot) => void;

/**
 * Resolves UI capabilities only. Provider backends must authorise every read
 * and mutation independently; the browser snapshot is never authoritative.
 */
export interface DocumentAccessAdapter {
  getSnapshot(documentId: string): DocumentAccessSnapshot;
  refresh(documentId: string): Promise<DocumentAccessSnapshot>;
  subscribe(documentId: string, listener: DocumentAccessListener): Unsubscribe;
}

export const noDocumentAccess = (
  documentId: string,
  revision = "0",
): DocumentAccessSnapshot => ({
  documentId,
  status: "ready",
  level: "none",
  capabilities: [],
  source: "none",
  owner: null,
  revision,
});

export const can = (
  snapshot: DocumentAccessSnapshot,
  capability: DocumentCapability,
): boolean =>
  snapshot.status === "ready" && snapshot.capabilities.includes(capability);

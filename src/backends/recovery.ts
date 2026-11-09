/**
 * Latest native-file recovery snapshot for each host principal.
 * Recovery is not a file save and must never mark the document saved.
 * A successful write acknowledges an atomic replacement; failure keeps the old copy.
 * Principal keys separate accounts on this device, not a server authorisation boundary.
 */
export interface RecoveryStore {
  read(principalId: string): Promise<Uint8Array | null>;
  write(principalId: string, bytes: Uint8Array): Promise<void>;
  /** Blob-aware hosts can store and restore large archives without copying them into the JS heap. */
  readBlob?(principalId: string): Promise<Blob | null>;
  writeBlob?(principalId: string, archive: Blob): Promise<void>;
  /** Device-local publications selected by this principal. The editable source file is excluded. */
  readLibrary?(principalId:string,path:string):Promise<Blob|null>;
  writeLibrary?(principalId:string,path:string,publication:Blob):Promise<void>;
  remove(principalId: string): Promise<void>;
  close(): void;
}

/**
 * Latest native-file recovery snapshot for each host principal.
 * Recovery is not a file save and must never mark the document saved.
 * A successful write acknowledges an atomic replacement; failure keeps the old copy.
 * Principal keys separate accounts on this device, not a server authorisation boundary.
 */
export interface RecoveryStore {
  read(principalId: string): Promise<Uint8Array | null>;
  write(principalId: string, bytes: Uint8Array): Promise<void>;
  remove(principalId: string): Promise<void>;
  close(): void;
}

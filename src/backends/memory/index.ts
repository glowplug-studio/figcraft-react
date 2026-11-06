import {
  noDocumentAccess,
  type DocumentAccessAdapter,
  type DocumentAccessListener,
  type DocumentAccessSnapshot,
} from "../access";
import {
  signedOutIdentity,
  type IdentityAdapter,
  type IdentityListener,
  type IdentitySnapshot,
  type Unsubscribe,
} from "../identity";

const cloneIdentity = (snapshot: IdentitySnapshot): IdentitySnapshot => {
  if (snapshot.status !== "authenticated") {
    return { ...snapshot };
  }

  return { ...snapshot, principal: { ...snapshot.principal } };
};

const cloneAccess = (
  snapshot: DocumentAccessSnapshot,
): DocumentAccessSnapshot => ({
  ...snapshot,
  capabilities: [...snapshot.capabilities],
  owner: snapshot.owner ? { ...snapshot.owner } : null,
});

/** Reference adapter for tests, previews and adapter conformance suites. */
export class MemoryIdentityAdapter implements IdentityAdapter {
  readonly #listeners = new Set<IdentityListener>();
  #snapshot: IdentitySnapshot;

  constructor(snapshot: IdentitySnapshot = signedOutIdentity()) {
    this.#snapshot = cloneIdentity(snapshot);
  }

  getSnapshot(): IdentitySnapshot {
    return cloneIdentity(this.#snapshot);
  }

  subscribe(listener: IdentityListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setSnapshot(snapshot: IdentitySnapshot): void {
    this.#snapshot = cloneIdentity(snapshot);
    const next = this.getSnapshot();
    this.#listeners.forEach((listener) => listener(next));
  }
}

/** Reference document-access adapter with explicit grant and revocation events. */
export class MemoryDocumentAccessAdapter implements DocumentAccessAdapter {
  readonly #listeners = new Map<string, Set<DocumentAccessListener>>();
  readonly #snapshots = new Map<string, DocumentAccessSnapshot>();

  getSnapshot(documentId: string): DocumentAccessSnapshot {
    return cloneAccess(
      this.#snapshots.get(documentId) ?? noDocumentAccess(documentId),
    );
  }

  async refresh(documentId: string): Promise<DocumentAccessSnapshot> {
    return this.getSnapshot(documentId);
  }

  subscribe(
    documentId: string,
    listener: DocumentAccessListener,
  ): Unsubscribe {
    const listeners = this.#listeners.get(documentId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(documentId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(documentId);
      }
    };
  }

  setSnapshot(snapshot: DocumentAccessSnapshot): void {
    this.#snapshots.set(snapshot.documentId, cloneAccess(snapshot));
    const next = this.getSnapshot(snapshot.documentId);
    this.#listeners
      .get(snapshot.documentId)
      ?.forEach((listener) => listener(next));
  }

  revoke(documentId: string, revision: string): void {
    this.setSnapshot(noDocumentAccess(documentId, revision));
  }
}

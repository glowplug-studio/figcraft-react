import { describe, expect, it, vi } from "vitest";

import type {
  DocumentAccessAdapter,
  DocumentAccessSnapshot,
  IdentityAdapter,
  IdentitySnapshot,
} from "../../src";

export interface HostAdapterHarness {
  identity: IdentityAdapter;
  access: DocumentAccessAdapter;
  authenticate(snapshot: Extract<IdentitySnapshot, { status: "authenticated" }>):
    | void
    | Promise<void>;
  signOut(revision: string): void | Promise<void>;
  grant(snapshot: DocumentAccessSnapshot): void | Promise<void>;
  revoke(documentId: string, revision: string): void | Promise<void>;
}

export type HostAdapterHarnessFactory = () => HostAdapterHarness;

/** Shared behavioural contract for every host identity/access adapter. */
export function hostAdapterContract(
  name: string,
  createHarness: HostAdapterHarnessFactory,
): void {
  describe(`${name} host adapter contract`, () => {
    it("publishes authenticated and signed-out identity transitions", async () => {
      const harness = createHarness();
      const listener = vi.fn();
      const unsubscribe = harness.identity.subscribe(listener);

      await harness.authenticate({
        status: "authenticated",
        principal: { id: "user-1", displayName: "Ada" },
        revision: "identity-1",
      });

      expect(harness.identity.getSnapshot()).toMatchObject({
        status: "authenticated",
        principal: { id: "user-1" },
      });

      await harness.signOut("identity-2");
      expect(harness.identity.getSnapshot()).toEqual({
        status: "signedOut",
        principal: null,
        revision: "identity-2",
      });
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
    });

    it("publishes grants and removes capabilities immediately on revocation", async () => {
      const harness = createHarness();
      const listener = vi.fn();
      const unsubscribe = harness.access.subscribe("document-1", listener);

      await harness.grant({
        documentId: "document-1",
        status: "ready",
        level: "edit",
        capabilities: ["document.read", "document.edit"],
        source: "membership",
        owner: { id: "owner-1" },
        revision: "access-1",
      });

      expect(harness.access.getSnapshot("document-1")).toMatchObject({
        level: "edit",
        source: "membership",
      });

      await harness.revoke("document-1", "access-2");
      expect(harness.access.getSnapshot("document-1")).toEqual({
        documentId: "document-1",
        status: "ready",
        level: "none",
        capabilities: [],
        source: "none",
        owner: null,
        revision: "access-2",
      });
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
    });
  });
}

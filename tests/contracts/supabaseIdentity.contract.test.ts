import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { SupabaseIdentityAdapter, type SupabaseIdentityAuth } from "../../src/backends/supabase/identity";
import { MemoryDocumentAccessAdapter } from "../../src/backends/memory";
import { signedOutIdentity } from "../../src/backends/identity";
import { hostAdapterContract } from "./hostAdapterContract";

type ClaimsResponse = Awaited<ReturnType<SupabaseIdentityAuth["getClaims"]>>;
const adapters: SupabaseIdentityAdapter[] = [];
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.dispose());
  vi.useRealTimers();
});

function authHarness() {
  let callback: ((event: AuthChangeEvent, session: Pick<Session, "expires_at"> | null) => void) | undefined;
  let response: ClaimsResponse = { data: null, error: null };
  const unsubscribe = vi.fn();
  const getClaims = vi.fn(async () => response);
  const auth: SupabaseIdentityAuth = {
    getClaims,
    onAuthStateChange(listener) {
      callback = listener;
      return { data: { subscription: { unsubscribe } } };
    },
  };
  const identity = new SupabaseIdentityAdapter(auth, signedOutIdentity("identity-0"));
  adapters.push(identity);
  return {
    identity, getClaims, unsubscribe,
    setResponse(next: ClaimsResponse) { response = next; },
    emit(event: AuthChangeEvent, session: Pick<Session, "expires_at"> | null = null) { callback?.(event, session); },
    async authenticate(id = "user-1") {
      response = { data: { claims: { sub: id, exp: Date.now() / 1000 + 3600 } }, error: null };
      await identity.refresh();
    },
  };
}

// Memory access exercises the unchanged shared access contract, NOT Supabase RLS.
// This slice has no persisted resources; real Auth denial tests run separately.
hostAdapterContract("Supabase identity with in-memory local document access", () => {
  const harness = authHarness();
  const access = new MemoryDocumentAccessAdapter();
  return {
    identity: harness.identity,
    access,
    authenticate: (snapshot) => harness.authenticate(snapshot.principal.id),
    signOut: () => harness.emit("SIGNED_OUT"),
    grant: (snapshot) => access.setSnapshot(snapshot),
    revoke: (documentId, revision) => access.revoke(documentId, revision),
  };
});

describe("Supabase identity validation", () => {
  it("publishes only a stable validated principal and caches immutable snapshots", async () => {
    const harness = authHarness();
    await harness.authenticate();
    const first = harness.identity.getSnapshot();
    expect(first).toEqual({ status: "authenticated", principal: { id: "user-1" }, revision: "identity-1" });
    expect(harness.identity.getSnapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    await harness.identity.refresh();
    expect(harness.identity.getSnapshot()).toBe(first);
  });

  it("does not restore identity when an older validation finishes after sign-out", async () => {
    const harness = authHarness();
    await harness.authenticate();
    let resolve!: (response: ClaimsResponse) => void;
    harness.getClaims.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = harness.identity.refresh();
    harness.emit("SIGNED_OUT");
    resolve({ data: { claims: { sub: "user-1", exp: Date.now() / 1000 + 3600 } }, error: null });
    await pending;
    expect(harness.identity.getSnapshot().status).toBe("signedOut");
  });

  it("fails closed for rejected, invalid and expired claims", async () => {
    const harness = authHarness();
    for (const response of [
      { data: { claims: { sub: "user-1", exp: Date.now() / 1000 + 3600 } }, error: new Error("denied") },
      { data: { claims: { sub: "", exp: Date.now() / 1000 + 3600 } }, error: null },
      { data: { claims: { sub: "user-1", exp: 1 } }, error: null },
      { data: { claims: { sub: "user-1", exp: Number.NaN } }, error: null },
    ]) {
      await harness.authenticate();
      harness.setResponse(response);
      await harness.identity.refresh();
      expect(harness.identity.getSnapshot().status).toBe("signedOut");
    }
  });

  it("clears identity when claims expire without an auth event", async () => {
    vi.useFakeTimers();
    const harness = authHarness();
    harness.setResponse({ data: { claims: { sub: "user-1", exp: Date.now() / 1000 + 1 } }, error: null });
    await harness.identity.refresh();
    await vi.advanceTimersByTimeAsync(1001);
    expect(harness.identity.getSnapshot().status).toBe("signedOut");
  });

  it("validates refreshed sessions outside the auth callback and unsubscribes", async () => {
    const harness = authHarness();
    harness.setResponse({ data: { claims: { sub: "user-2", exp: Date.now() / 1000 + 3600 } }, error: null });
    harness.emit("TOKEN_REFRESHED", { expires_at: Date.now() / 1000 + 3600 });
    expect(harness.getClaims).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(harness.identity.getSnapshot()).toMatchObject({ principal: { id: "user-2" } });
    harness.identity.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores a queued sign-in callback superseded by sign-out", async () => {
    const harness = authHarness();
    harness.setResponse({ data: { claims: { sub: "user-1", exp: Date.now() / 1000 + 3600 } }, error: null });
    harness.emit("SIGNED_IN", { expires_at: Date.now() / 1000 + 3600 });
    harness.emit("SIGNED_OUT");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(harness.identity.getSnapshot().status).toBe("signedOut");
  });
});

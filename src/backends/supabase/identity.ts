import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { signedOutIdentity, type IdentityAdapter, type IdentityListener, type IdentitySnapshot } from "../identity";

/** Narrow provider interface permits contract tests without publishing provider data to core. */
export interface SupabaseIdentityAuth {
  getClaims(): Promise<{ data: { claims: { sub?: unknown; exp?: unknown } } | null; error: unknown }>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Pick<Session, "expires_at"> | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

/** Host-side adapter. Tokens and user-editable metadata never enter its snapshots. */
export class SupabaseIdentityAdapter implements IdentityAdapter {
  readonly #auth: SupabaseIdentityAuth;
  readonly #listeners = new Set<IdentityListener>();
  readonly #unsubscribe: () => void;
  #snapshot: IdentitySnapshot;
  #revision = 0;
  #request = 0;
  #disposed = false;
  #expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(auth: SupabaseIdentityAuth, initial: IdentitySnapshot = { status: "loading", principal: null, revision: "identity-0" }) {
    this.#auth = auth;
    this.#snapshot = this.#freeze(initial);
    const { data } = auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        this.#request++;
        this.#publish(null);
      } else {
        // Never await another Auth call inside onAuthStateChange's lock.
        const request = this.#request;
        queueMicrotask(() => { if (!this.#disposed && request === this.#request) void this.refresh(); });
      }
    });
    this.#unsubscribe = () => data.subscription.unsubscribe();
  }

  getSnapshot = (): IdentitySnapshot => this.#snapshot;

  subscribe = (listener: IdentityListener): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async refresh(): Promise<void> {
    if (this.#disposed) return;
    const request = ++this.#request;
    try {
      const { data, error } = await this.#auth.getClaims();
      if (this.#disposed || request !== this.#request) return;
      const subject = data?.claims.sub;
      const expiry = data?.claims.exp;
      if (error || typeof subject !== "string" || !subject || typeof expiry !== "number" || !Number.isFinite(expiry) || expiry * 1000 <= Date.now()) {
        this.#publish(null);
        return;
      }
      this.#publish(subject);
      this.#expiry = setTimeout(() => {
        this.#request++;
        this.#publish(null);
        void this.refresh();
      }, Math.min(expiry * 1000 - Date.now(), 2_147_483_647));
    } catch {
      if (!this.#disposed && request === this.#request) this.#publish(null);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#request++;
    clearTimeout(this.#expiry);
    this.#unsubscribe();
    this.#listeners.clear();
  }

  #freeze(snapshot: IdentitySnapshot): IdentitySnapshot {
    return Object.freeze(snapshot.status === "authenticated"
      ? { ...snapshot, principal: Object.freeze({ id: snapshot.principal.id }) }
      : { ...snapshot });
  }

  #publish(subject: string | null): void {
    clearTimeout(this.#expiry);
    if (this.#disposed) return;
    const current = this.#snapshot;
    if ((subject === null && current.status === "signedOut") || (current.status === "authenticated" && subject === current.principal.id)) return;
    const revision = `identity-${++this.#revision}`;
    this.#snapshot = this.#freeze(subject === null ? signedOutIdentity(revision) : { status: "authenticated", principal: { id: subject }, revision });
    this.#listeners.forEach((listener) => listener(this.#snapshot));
  }
}

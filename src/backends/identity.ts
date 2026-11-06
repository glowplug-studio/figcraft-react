export type Unsubscribe = () => void;

/** Provider-neutral identity supplied by the embedding host. */
export interface Principal {
  id: string;
  displayName?: string;
  avatarUrl?: string;
}

export type IdentitySnapshot =
  | { status: "loading"; principal: null; revision: string }
  | { status: "signedOut"; principal: null; revision: string }
  | { status: "authenticated"; principal: Principal; revision: string };

export type IdentityListener = (snapshot: IdentitySnapshot) => void;

/**
 * Host-owned authentication state. Implementations must not expose provider
 * clients, cookies, access tokens or refresh tokens through this contract.
 */
export interface IdentityAdapter {
  getSnapshot(): IdentitySnapshot;
  subscribe(listener: IdentityListener): Unsubscribe;
}

export const signedOutIdentity = (revision = "0"): IdentitySnapshot => ({
  status: "signedOut",
  principal: null,
  revision,
});

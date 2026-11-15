import { OnlineServerPreference } from "../../engine/sharing/server-preference";

// A refused write must survive a fresh host instance within this page, even if
// storage reads still return an older value. This fallback never holds keys or files.
const unsaved = new Map<string, string>();

/** Device-local, account-scoped preference; no document or share credentials. */
export function browserServerPreference(principal: string, defaultUrl: string): OnlineServerPreference {
  const key = `figcraft.publish-server.${principal}`;
  let stored = unsaved.get(key);
  if (stored === undefined) {
    try { stored = localStorage.getItem(key) ?? undefined; } catch { /* Storage may be unavailable. */ }
  }
  return new OnlineServerPreference(defaultUrl, stored, url => {
    try {
      localStorage.setItem(key, url);
      unsaved.delete(key);
    } catch {
      unsaved.set(key, url);
    }
  });
}

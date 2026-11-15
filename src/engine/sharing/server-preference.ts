import { parseJoinCode } from "./join-code";

export interface OnlineServerPreferenceSnapshot {
  readonly url: string;
  readonly default: string;
}

// Native also suggests LAN hosting; the browser port cannot host LAN sessions.
export const ONLINE_SHARING_OFF = "Online sharing is off: choose a server in Preferences";

// Rust str::trim uses Unicode White_Space, which differs from JavaScript trim
// for U+0085 and U+FEFF. Keep the command's spelling rather than normalising URLs.
const trim = (value: string): string => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const valid = (url: string): boolean => url === "" || (
  (url.startsWith("ws://") || url.startsWith("wss://")) &&
  new TextEncoder().encode(url).length <= 500 &&
  !/[\p{White_Space}\p{Cc}?#]/u.test(url)
);
const invalidAddress = "the server's address is ws://host:port/ or wss://host/path/, without a key (it is saved with your preferences)";

/** Provider-neutral preferences, outside document state and share credentials. */
export class OnlineServerPreference {
  #snapshot: OnlineServerPreferenceSnapshot;
  #listeners = new Set<() => void>();
  readonly #save: ((url: string) => void) | undefined;

  constructor(defaultUrl: string, stored?: string, save?: (url: string) => void) {
    const selected = stored === undefined ? defaultUrl : trim(stored);
    this.#snapshot = Object.freeze({ url: valid(selected) ? selected : defaultUrl, default: defaultUrl });
    this.#save = save;
  }

  getSnapshot = (): OnlineServerPreferenceSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  execute(params: Record<string, unknown>): OnlineServerPreferenceSnapshot {
    if (params.url != null && typeof params.url !== "string") {
      throw new Error("`url` must be a string");
    }
    // Native automation/params.rs::get treats JSON null as an omitted parameter.
    const url = params.url == null ? this.#snapshot.default : trim(params.url as string);
    if (!valid(url)) throw new Error(invalidAddress);
    const changed = url !== this.#snapshot.url;
    if (changed) this.#snapshot = Object.freeze({ url, default: this.#snapshot.default });
    // Browser storage can refuse writes (for example in private browsing).
    // A persistence failure must not disable an otherwise usable preference.
    try { this.#save?.(url); } catch { /* Keep the in-memory choice. */ }
    if (changed) for (const listener of this.#listeners) listener();
    return this.#snapshot;
  }
}

/** Native sharing/live/types.rs::join_target: explicit destinations bypass the default. */
export function resolveOnlineJoinTarget(input: string, preference: OnlineServerPreference): string {
  const typed = trim(input);
  if (typed.includes("://") || typed.includes("?")) return typed;
  const parsed = parseJoinCode(typed);
  if (parsed.kind === "local") return parsed.link;
  const server = trim(preference.getSnapshot().url);
  if (!server) throw new Error("that is an online join code, and " + ONLINE_SHARING_OFF);
  return `figcraft://join?server=${server}&code=${parsed.code}`;
}

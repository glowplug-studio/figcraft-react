import type { OnlineGuestSession } from "../online-files";

export interface SharedCredential {
  id: string;
  access: OnlineGuestSession["access"];
  token: string;
  code: string;
}

export interface PendingSharingChange {
  expected: string | null;
  revision: string;
  revoke: string[];
  seed: string | null;
}

/** This row is private to the issuing device. The normal online list contains no invite secrets. */
export interface DeviceOwnerSharing {
  links: readonly SharedCredential[];
  pending?: PendingSharingChange;
}

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const linkId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);

export function isSharedCredentials(value: unknown): value is SharedCredential[] {
  if (!Array.isArray(value) || (value.length !== 0 && value.length !== 3)) return false;
  const roles = new Set<string>();
  for (const item of value) {
    if (!item || !linkId(item.id) || !["edit", "view", "comment"].includes(item.access)
      || typeof item.token !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(item.token)
      || typeof item.code !== "string" || !/^([0-9A-HJKMNP-TV-Z]{3}-){2}[0-9A-HJKMNP-TV-Z]{3}$/.test(item.code)) return false;
    roles.add(item.access);
  }
  return roles.size === value.length && new Set(value.map(link => link.id)).size === value.length
    && new Set(value.map(link => link.code)).size === value.length && new Set(value.map(link => link.token)).size === value.length;
}

export function readDeviceOwnerSharing(value: unknown): DeviceOwnerSharing {
  if (value === undefined) return {links: []};
  if (value && typeof value === "object" && "links" in value && isSharedCredentials(value.links)) {
    if (!("pending" in value)) return {links: value.links};
    const p = value.pending;
    if (p && typeof p === "object" && "expected" in p && (p.expected === null || uuid(p.expected))
      && "revision" in p && uuid(p.revision) && "revoke" in p && Array.isArray(p.revoke)
      && p.revoke.length <= 3 && p.revoke.every(linkId) && "seed" in p && (p.seed === null ||
        typeof p.seed === "string" && /^[0-9a-f]{64}$/.test(p.seed))) {
      return {links: value.links, pending: {expected: p.expected, revision: p.revision, revoke: p.revoke, seed: p.seed}};
    }
  }
  throw new Error("Invalid private sharing record");
}

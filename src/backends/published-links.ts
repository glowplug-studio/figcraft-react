/** Private to the embedding host. The editor receives only the online file summary. */
export type PublishedAccess = "edit" | "view";
export interface PublishedLink { id: string; token: string }
export type PublishedLinks = Record<PublishedAccess, PublishedLink>;
export type PublishedLinkDigests = Record<PublishedAccess, { id: string; hash: string }>;

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function createPublishedLinks(): PublishedLinks {
  const create = (): PublishedLink => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    return { id: hex(crypto.getRandomValues(new Uint8Array(8))), token };
  };
  return { edit: create(), view: create() };
}

export async function publishedLinkDigests(links: PublishedLinks): Promise<PublishedLinkDigests> {
  const digest = async ({ id, token }: PublishedLink) => ({
    id, hash: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))),
  });
  return { edit: await digest(links.edit), view: await digest(links.view) };
}

export function isPublishedLinkDigests(value: unknown): value is PublishedLinkDigests {
  if (!value || typeof value !== "object" || !("edit" in value) || !("view" in value)) return false;
  const valid = (item: unknown): item is { id: string; hash: string } => !!item && typeof item === "object"
    && "id" in item && typeof item.id === "string" && /^[0-9a-f]{16}$/.test(item.id)
    && "hash" in item && typeof item.hash === "string" && /^[0-9a-f]{64}$/.test(item.hash);
  return valid(value.edit) && valid(value.view) && value.edit.id !== value.view.id && value.edit.hash !== value.view.hash;
}

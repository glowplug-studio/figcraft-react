import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodeOnlineJoinCode, groupedJoinCode } from "@glowplug-studio/figcraft-react/sharing/join-code";
import { JoinCodeKey } from "./codes";

type Access = "edit" | "view" | "comment";
export type LinkSet = "published" | "shared";

function issue(access: Access, group: LinkSet, entropy = randomBytes(32)) {
  const id = entropy.subarray(0, 8).toString("hex");
  const token = entropy.subarray(8, 24).toString("base64url");
  const code = group === "shared" ? encodeOnlineJoinCode(entropy.readBigUInt64LE(24)) : undefined;
  const sealed = code && new JoinCodeKey(code).seal(token);
  return {
    receipt: { id, access, token, ...(code ? { code: groupedJoinCode(code) } : {}) },
    record: {
      id, access_level: access, label: (group === "shared" ? "Shared" : "Published") + " (" + access + ")",
      token_hash: createHash("sha256").update(token).digest("hex"),
      code_hash: sealed ? sealed.hash : null, wrapped_token: sealed ? sealed.token : null,
    },
  };
}

/** The host passes a verified account ID. Only this transaction can return new bearer secrets. */
export async function changeFileLinks(writer: SupabaseClient, owner: string, file: string,
  revoke: readonly string[], create?: LinkSet, limit = 100) {
  const levels: Access[] = create === "shared" ? ["edit", "view", "comment"] : ["edit", "view"];
  for (let attempt = 0; attempt < 3; attempt++) {
    const links = create ? levels.map(access => issue(access, create)) : [];
    const result = await writer.rpc("change_online_file_links", {
      actor: owner, target: file, revoke_ids: revoke, new_links: links.map(link => link.record), link_limit: limit,
    });
    if (!result.error) return links.map(link => link.receipt);
    // A generated ID or code collision rolls the entire operation back, including revocations.
    if (result.error.code !== "23505" || attempt === 2) throw result.error;
  }
  throw new Error("Could not issue unique share links");
}

/** Rebuild the exact receipt after a lost response; only the issuer holds the random seed. */
export async function applyOwnerSharing(writer: SupabaseClient, owner: string, file: string,
  expected: string | null, revision: string, revoke: readonly string[], seed: string | null) {
  const before = await ownerSharingStatus(writer, owner, file);
  if (seed !== null && !/^[0-9a-f]{64}$/.test(seed)) throw new Error("Invalid sharing credential");
  const links = seed === null ? [] : (["edit", "view", "comment"] as const).map(access => {
    const entropy = createHmac("sha256", Buffer.from(seed, "hex"))
      .update(JSON.stringify(["figcraft-share", file, revision, access])).digest();
    return issue(access, "shared", entropy);
  });
  if (before.revision !== expected && before.revision !== revision) {
    // Other successful changes may have advanced the revision after our acknowledgement was lost.
    // Recognise only the requested outcome. Never replay the write against the newer state.
    if (links.every(link => before.ids.includes(link.receipt.id)) && revoke.every(id => !before.ids.includes(id))) {
      return links.map(link => link.receipt);
    }
    throw new Error("Sharing changed elsewhere");
  }
  const result = await writer.rpc("apply_online_share_change", {
    actor: owner, target: file, expected, revision, revoke_ids: revoke, new_links: links.map(link => link.record),
  });
  if (result.error) throw result.error;
  if (before.revision === revision && links.some(link => !before.ids.includes(link.receipt.id))) {
    throw new Error("Sharing changed elsewhere");
  }
  return links.map(link => link.receipt);
}

export async function ownerSharingStatus(writer: SupabaseClient, owner: string, file: string) {
  const response = await writer.from("online_files")
    .select("id, online_file_share_changes(revision), online_file_links(id,label)").eq("id", file).eq("owner_id", owner)
    .maybeSingle<{id: string; online_file_share_changes: {revision: string} | null; online_file_links: {id: string; label: string}[]}>();
  if (response.error) throw response.error;
  if (!response.data) throw new Error("The file is unavailable");
  return {revision: response.data.online_file_share_changes?.revision ?? null, ids: response.data.online_file_links.filter(link => !link.label.startsWith("Team (")).map(link => link.id)};
}

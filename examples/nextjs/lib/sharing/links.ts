import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodeOnlineJoinCode, groupedJoinCode } from "@glowplug-studio/figcraft-react/sharing/join-code";
import { JoinCodeKey } from "./codes";

type Access = "edit" | "view" | "comment";
export type LinkSet = "published" | "shared";

function issue(access: Access, group: LinkSet) {
  const token = randomBytes(16).toString("base64url");
  const id = randomBytes(8).toString("hex");
  const code = group === "shared" ? encodeOnlineJoinCode(randomBytes(8).readBigUInt64LE()) : undefined;
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

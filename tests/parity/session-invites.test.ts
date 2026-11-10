import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inviteEndpoint, nativeInviteLink, parseSessionInvite } from "../../src/engine/sharing/invite";

type Case = { input: string; expected: { error: string } | { kind: string; endpoint: string; link?: string } };
const cases: Case[] = JSON.parse(readFileSync(new URL("../fixtures/native-session-invites.json", import.meta.url), "utf8"));
it.each(cases.map((row, index) => ({ ...row, index })))("matches pinned invite parser case $index", ({ input, expected }) => {
  if ("error" in expected) {
    expect(() => parseSessionInvite(input)).toThrow(new Error(expected.error));
  } else {
    const parsed = parseSessionInvite(input);
    const { server, ...rest } = parsed;
    expect({ ...rest, endpoint: inviteEndpoint(server), ...(parsed.kind === "link" ? { link: nativeInviteLink(parsed) } : {}) }).toEqual(expected);
  }
});

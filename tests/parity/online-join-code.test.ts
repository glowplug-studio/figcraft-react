import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { groupedJoinCode, parseJoinCode } from "../../src/engine/sharing/join-code";

interface Example { typed: string; kind: "online" | "local" | "error"; result: string }
const cases: Example[] = JSON.parse(readFileSync(new URL("../fixtures/native-join-codes.json", import.meta.url), "utf8"));

it.each(cases.map((example, index) => ({ ...example, index })))("matches native $kind join-code case $index", ({ typed, kind, result }) => {
  if (kind === "error") {
    expect(() => parseJoinCode(typed)).toThrow(new Error(result));
    return;
  }
  const parsed = parseJoinCode(typed);
  expect(parsed.kind).toBe(kind);
  expect(parsed.kind === "local" ? parsed.link : groupedJoinCode(parsed.code)).toBe(result);
});

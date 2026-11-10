import { publicationCapacity } from "../../examples/nextjs/lib/sharing/publication-capacity";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingressAddress } from "../../examples/nextjs/lib/sharing/ingress-address";
import { JoinCodeKey, type SealedJoinCode } from "../../examples/nextjs/lib/sharing/codes";
import { encodeOnlineJoinCode } from "../../src/engine/sharing/join-code";

interface Example {
  bits: string; code: string; token: string;
  result: { sealed: SealedJoinCode; opened: string } | { error: string };
}
const cases: Example[] = JSON.parse(readFileSync(new URL("../fixtures/native-sealed-join-codes.json", import.meta.url), "utf8"));

describe("pinned native server join-code records", () => {
  for (const bits of new Set(cases.map(row => row.bits))) {
    const examples = cases.filter(row => row.bits === bits);
    it("issues and wraps the native tokens for " + bits, () => {
      const code = encodeOnlineJoinCode(BigInt(bits));
      expect(code).toBe(examples[0].code);
      const key = new JoinCodeKey(code);
      for (const { result, token } of examples) {
        if ("error" in result) expect(() => key.seal(token)).toThrow(result.error);
        else {
          expect(key.seal(token)).toEqual(result.sealed);
          expect(key.open(result.sealed)).toBe(result.opened);
        }
      }
    });
  }

  it("rejects another code, an invalid hash, damaged hex and oversized wrapped tokens", () => {
    const correct = new JoinCodeKey("000000001");
    const stored = correct.seal("fixture");
    expect(new JoinCodeKey("000000002").open(stored)).toBeUndefined();
    expect(correct.open({ ...stored, hash: "é".repeat(64) })).toBeUndefined();
    expect(correct.open({ ...stored, token: "ZZ" })).toBeUndefined();
    expect(correct.open({ ...stored, token: "00".repeat(33) })).toBeUndefined();
  });
});

it("uses the configured ingress address and a shared local fallback", () => {
  const headers = new Headers({"x-forwarded-for": "198.51.100.1", "x-vercel-forwarded-for": "2001:db8::19"});
  expect(ingressAddress(headers, false)).toBe("127.0.0.1");
  expect(ingressAddress(headers, true)).toBe("2001:db8::19");
  headers.set("x-vercel-forwarded-for", "198.51.100.1, 192.0.2.1");
  expect(ingressAddress(headers, true)).toBe("127.0.0.1");
});

it("applies retained publication overrides from the trusted host", () => {
  const headers = new Headers({"x-forwarded-for": "192.0.2.31", "x-vercel-forwarded-for": "2001:db8::10"});
  expect(publicationCapacity(headers, {})).toEqual({address: "127.0.0.1"});
  expect(publicationCapacity(headers, {VERCEL: "1", FIGCRAFT_MAX_FILES: "10", FIGCRAFT_MAX_FILES_PER_IP: "2",
    FIGCRAFT_MAX_MB_PER_IP: "4", FIGCRAFT_MAX_TOTAL_MB: "16", FIGCRAFT_PUBLISHES_PER_HOUR: "3"})).toEqual({address: "2001:db8::10", max_files: 10,
      publishes_per_hour: 3, max_files_per_ip: 2, max_bytes_per_ip: 4 * 1024 * 1024, max_total_bytes: 16 * 1024 * 1024});
  for (const value of ["0", "-2", "1.5", "invalid", "999999999999999999999"]) {
    expect(() => publicationCapacity(headers, {FIGCRAFT_MAX_FILES: value})).toThrow("FIGCRAFT_MAX_FILES");
  }
});

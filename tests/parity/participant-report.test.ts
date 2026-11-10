import {describe, expect, it} from "vitest";
import {participantReportReason} from "../../src/engine/sharing/participant-report";

describe("live guest report reasons", () => {
  it.each(["", "  ", "\u0085\u205f"])("requires a reason after native whitespace trimming", reason => {
    expect(() => participantReportReason(reason)).toThrow("what is wrong");
  });
  it("keeps bidi marks for server-side cleaning and replaces C0 and C1 controls", () => {
    expect(participantReportReason("\u3000a\0b\u0080c\u202ed\u3000")).toBe("a b c\u202ed");
  });
  it("counts Unicode scalars and preserves grapheme components at the native boundary", () => {
    const prefix = "🙂".repeat(498) + "a";
    expect(participantReportReason(prefix + "\u0301b")).toBe(prefix + "\u0301");
  });
});

import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { breakBetween, isWrapSpace, justifyBetween, safeEmergencyBreak } from "../../src/engine/text-wrap-boundaries";

it("respects native opening, closing, glue and justification priorities", () => {
  expect(breakBetween("日","本")).toBe(true);
  expect(justifyBetween("日","本")).toBe(true);
  for (const [a,b] of [["「","本"],["本","。"],["日"," "],[" ","日"],[" ","！"],["日","ㇰ"]]) {
    expect(breakBetween(a,b)).toBe(false);
    expect(justifyBetween(a,b)).toBe(false);
  }
  expect(breakBetween(" ","日")).toBe(true);
  expect(justifyBetween(" ","日")).toBe(false);
  expect(isWrapSpace(" ")).toBe(false);
  expect(breakBetween("-","a")).toBe(true);
  expect(safeEmergencyBreak("เ","ก")).toBe(false);
  expect(safeEmergencyBreak("ก","้")).toBe(false);
});

it("matches all native pairwise break, justification, emergency and space flags", () => {
  // Digest of bytes from crates/text/src/breaks.rs at a4251ca8, in the same row order.
  const chars = "a0 \t。日ア（［｛｢｟𠀀힣々・ヾ゜ーㇰｧﾞๆเກເก้ ​‌‍  　-‐–—/!¿«́😀";
  const bytes: number[] = [];
  for (const a of chars) for (const b of chars) {
    bytes.push(Number(breakBetween(a,b)) | Number(justifyBetween(a,b))<<1 |
      Number(safeEmergencyBreak(a,b))<<2 | Number(isWrapSpace(a))<<3);
  }
  expect(createHash("sha256").update(Uint8Array.from(bytes)).digest("hex"))
    .toBe("23a8ef01835222337e2167cb676406e1f60e9c0ac03c3ba9e1f9238d5bf50f3c");
});

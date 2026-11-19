import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-round-corners.json";
import type { PathCommand } from "../../src/engine/corners";
import { roundCorners } from "../../src/engine/round-corners";

// Native `figcraft_pathops::round_corners` on native boolean folds, observed at bad07e44 through a disposable Rust
// executable (tests/fixtures/native-round-corners.provenance.md). Shapes restate crates/pathops/src/round_tests.rs.
type Elements = readonly (readonly [string, ...number[]])[];
const number = (value: unknown): number => value === "NaN" ? NaN : value === "Infinity" ? Infinity : value === "-Infinity" ? -Infinity : value as number;
const cases = fixture.cases.flatMap(c => c.results.map(r => ({ name: c.name, folded: c.folded as unknown as PathCommand[], ...r })));

describe("native corner radius on a closed path", () => {
  it.each(cases)("rounds $name at radius $radius, smoothing $smoothing as native does", ({ name, folded, radius, smoothing, rounded, unchanged }) => {
    const actual = roundCorners(folded, number(radius), number(smoothing)) as Elements, expected = rounded as unknown as Elements;
    if (unchanged) expect(actual).toBe(folded);
    expect(actual.map(c => c[0]).join(""), name).toBe(expected.map(c => c[0]).join(""));
    // Corners beside a curve cut it by arc length, which the port measures to the same 1e-6 but not bit for bit.
    const digits = folded.some(c => c[0] === "C") ? 4 : 9;
    actual.forEach((command, i) => command.slice(1).forEach((value, j) => expect(value as number, `${name}: element ${i}`).toBeCloseTo(expected[i][j + 1] as number, digits)));
  });
});

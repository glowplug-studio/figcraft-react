import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-variable-outline-dashes.json";
import { flattenContours, type PathCommand } from "../../src/engine/corners";
import { defaultStroke, type StrokeProps } from "../../src/engine/stroke";
import { parseSvgPath } from "../../src/engine/svg-path";
import { variableStrokeOutline } from "../../src/engine/variable-stroke";
import { parseWidthProfile } from "../../src/engine/width-profile";

// One allowance of dashes for all subpaths of a variable-width stroke, observed through native
// `pathops::width::variable_outline` at bad07e44 (upstream 554ad0ea, #2249;
// tests/fixtures/native-variable-outline-dashes.provenance.md).

type Case = { name: string; d?: string; lines?: number[]; width: number; dashes: number[]; profile?: number[][]; elements: number; subpaths: number; bounds: number[]; area: number; outline?: unknown[][] };
const cases = fixture.cases as unknown as Case[];
function input(c: Case): PathCommand[] {
  if (!c.lines) return [...parseSvgPath(c.d!)];
  const [count, length, spacing] = c.lines, path: PathCommand[] = [];
  for (let i = 0; i < count; i++) path.push(["M", 0, i * spacing], ["L", length, i * spacing]);
  return path;
}
function outline(c: Case): readonly PathCommand[] {
  const profile = parseWidthProfile(c.profile ?? [[0, 1], [1, 1]])!;
  const props: StrokeProps = { ...defaultStroke, weight: c.width, align: "center", dashes: c.dashes, widthProfile: profile };
  return variableStrokeOutline(input(c), c.width, props, profile)!;
}
/** Signed area as Kurbo reports it: straight edges between flattened points, y down. */
function area(path: readonly PathCommand[]): number {
  let sum = 0;
  for (const points of flattenContours(path)) for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; }
  return sum / 2;
}

describe("native dash allowance of a variable-width stroke", () => {
  it.each(cases.map(c => [c.name, c] as const))("draws what native draws: %s", (_name, c) => {
    const drawn = outline(c);
    expect(drawn.filter(command => command[0] === "M").length, "dashes and solid pieces").toBe(c.subpaths);
    expect(drawn.length, "elements").toBe(c.elements);
    const points = flattenContours(drawn).flat(), xs = points.map(p => p.x), ys = points.map(p => p.y);
    const box = [xs.reduce((a, b) => Math.min(a, b)), ys.reduce((a, b) => Math.min(a, b)), xs.reduce((a, b) => Math.max(a, b)), ys.reduce((a, b) => Math.max(a, b))];
    box.forEach((value, i) => expect(value).toBeCloseTo(c.bounds[i], 6));
    expect(Math.abs(area(drawn))).toBeCloseTo(Math.abs(c.area), 3);
    if (c.outline) {
      expect(drawn.map(command => command[0]).join("")).toBe(c.outline.map(command => command[0]).join(""));
      drawn.forEach((command, i) => command.slice(1).forEach((value, j) => expect(value as number, `element ${i}`).toBeCloseTo(c.outline![i][j + 1] as number, 9)));
    }
  });

  // crates/pathops/src/width_tests.rs: dashes_of_all_subpaths_share_one_allowance and
  // a_short_subpath_is_budgeted_by_the_whole_pattern_it_takes.
  it("lets later subpaths draw solid once the allowance is used", () => {
    const many = (n: number) => outline({ name: "", lines: [n, 15_000, 4], width: 1, dashes: [1, 1] } as Case).length;
    expect(many(10)).toBeLessThan(3 * many(1));
    const short = outline({ name: "", lines: [100, 1, 4], width: 1, dashes: Array(4000).fill(1) } as Case).length;
    expect(short).toBeLessThan(20_000 * 12);
  });
});

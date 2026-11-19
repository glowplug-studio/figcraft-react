import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-simplify-path.json";
import type { PathCommand } from "../../src/engine/corners";
import { simplifyBezPath, simplifyPath, simplifyPencil } from "../../src/engine/simplify-path";
import { pathBounds } from "../../src/engine/vector-path";

// Native `simplify_path` and Kurbo's own `simplify_bezpath`, observed at bad07e44 through a disposable Rust
// executable (tests/fixtures/native-simplify-path.provenance.md). Inputs restate the native tests of upstream #1741.
type Elements = readonly (readonly [string, ...number[]])[];
const letters = (path: Elements) => path.map(c => c[0]).join("");
function expectPath(actual: Elements, expected: Elements, digits: number, what: string) {
  expect(letters(actual), what).toBe(letters(expected));
  actual.forEach((command, i) => command.slice(1).forEach((value, j) => expect(value as number, `${what}: element ${i}`).toBeCloseTo(expected[i][j + 1] as number, digits)));
}
// Kurbo's fit runs a handle hundreds of units off these inputs. The port reproduces the shape of that failure, not
// its exact coordinates; the guarded result is identical because the run is discarded either way.
const wild = new Set(["pencil nearly straight", "nearly collinear"]);

describe("native simplification that keeps to its input", () => {
  const cases = fixture.cases.flatMap(c => c.results.map(r => ({ name: c.name, input: c.input as unknown as PathCommand[], ...r })));
  const exact = new Set(["a cubic out and back"]);
  it.each(cases)("matches native simplify_path for $name at $accuracy", ({ name, input, accuracy, native }) => {
    expectPath(simplifyPath(input, accuracy), native as unknown as Elements, 8, name);
  });
  it.each(cases.filter(c => c.kurbo !== null))("matches Kurbo's own fit for $name at $accuracy", ({ name, input, accuracy, kurbo }) => {
    const actual = simplifyBezPath(input, accuracy), expected = kurbo as unknown as Elements;
    if (wild.has(name) && accuracy < 8) expect(letters(actual)).toBe(letters(expected));
    else expectPath(actual, expected, exact.has(name) ? 4 : 8, name);
  });
  it("keeps a fitted stroke within its input's box grown by twice the accuracy, as the native tests require", () => {
    for (const { name, input, accuracy } of cases) {
      const source = pathBounds(input), fitted = pathBounds(simplifyPath(input, accuracy));
      if (!source || !fitted) { expect(simplifyPath(input, accuracy).filter(c => c[0] !== "M" && c[0] !== "Z"), name).toEqual([]); continue; }
      const grow = 2 * accuracy + 1e-9;
      expect(fitted.x, `${name} at ${accuracy}`).toBeGreaterThanOrEqual(source.x - grow);
      expect(fitted.y, `${name} at ${accuracy}`).toBeGreaterThanOrEqual(source.y - grow);
      expect(fitted.x + fitted.width, `${name} at ${accuracy}`).toBeLessThanOrEqual(source.x + source.width + grow);
      expect(fitted.y + fitted.height, `${name} at ${accuracy}`).toBeLessThanOrEqual(source.y + source.height + grow);
    }
  });
  it("draws the Pencil's samples through the same simplification, keeping the turn as a point of the stroke", () => {
    for (const name of ["pencil out and back", "pencil nearly straight", "a dip straight down and back up", "a slip back at the end", "a near reversal in a curve"]) {
      const c = fixture.cases.find(x => x.name === name)!, native = c.results.find(r => r.accuracy === .75)!.native as unknown as Elements;
      const samples = (c.input as unknown as [string, number, number][]).map(([, x, y]) => ({ x, y }));
      expectPath(simplifyPencil(samples) as Elements, native, 8, name);
    }
    const turned = simplifyPencil([{ x: 80, y: -160 }, { x: 86.04356571908697, y: -173.74440234910094 }, { x: 87.85185073933535, y: -179.20284644595452 }, { x: 86.04356571908697, y: -173.74440234910094 }, { x: 95, y: -185 }]);
    expect(turned.some(c => c.at(-2) === 87.85185073933535 && c.at(-1) === -179.20284644595452)).toBe(true);
  });
});

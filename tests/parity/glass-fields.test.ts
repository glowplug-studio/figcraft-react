import { expect, test } from "vitest";
import { glassBendDirections, glassInsideDistance, glassNormals, nearestGlassSites, NO_GLASS_SITE } from "../../src/engine/glass-fields";

test("glass distance and nearest-site ties match exhaustive Euclidean search", () => {
  for (const [width, height] of [[1, 1], [20, 1], [1, 20], [9, 7], [10, 14]]) {
    for (let seed = 0; seed < 12; seed++) {
      const mask = Uint8Array.from({ length: width * height }, (_, i) => Number(seed && (i * 31 + seed) % (seed + 1) < 2));
      const near = nearestGlassSites(mask, width, height);
      const distance = glassInsideDistance(mask.map(s => s ? 127 : 128), width, height);
      for (let i = 0; i < mask.length; i++) {
        let site = NO_GLASS_SITE, best = Infinity;
        for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
          const index = y * width + x;
          const d = (x - i % width) ** 2 + (y - Math.floor(i / width)) ** 2;
          if (mask[index] && d < best) { site = index; best = d; }
        }
        expect(near[i]).toBe(site);
        expect(distance[i]).toBe(Math.fround(Math.max(0, Math.sqrt(Math.min(1e20, best)) - .5)));
      }
    }
  }
});

function fields(width: number, height: number, covered: (x: number, y: number) => boolean) {
  const alpha = Uint8Array.from({length: width * height}, (_, i) => covered(i % width, Math.floor(i / width)) ? 255 : 0);
  const distance = glassInsideDistance(alpha, width, height);
  return { distance, normal: glassNormals(distance, width, height, 1), bend: glassBendDirections(distance, width, height, 20, 1) };
}

test("the glass core rounds a sharp corner and preserves inward normals at a straight edge", () => {
  const { distance, normal, bend } = fields(160, 120, (x, y) => x >= 20 && x < 140 && y >= 20 && y < 100);
  const at = (x: number, y: number) => y * 160 + x;
  expect(distance[at(20, 50)]).toBe(.5);
  expect(distance[at(80, 59)]).toBe(39.5);
  expect(normal.x[at(21, 60)]).toBeCloseTo(1, 5);
  expect(normal.y[at(21, 60)]).toBeCloseTo(0, 5);
  expect(bend.x[at(22, 22)]).toBeCloseTo(Math.SQRT1_2, 2);
  expect(bend.y[at(22, 22)]).toBeCloseTo(Math.SQRT1_2, 2);
  expect(bend.x[at(24, 29)]).toBeCloseTo(bend.y[at(29, 24)], 4);
});

test("adjacent thin strokes bend into their own cores", () => {
  const { bend } = fields(60, 60, (x, y) => y >= 10 && y < 50 && ((x >= 10 && x < 18) || (x >= 20 && x < 28)));
  expect(bend.x[30 * 60 + 17]).toBeLessThan(-.9);
  expect(bend.x[30 * 60 + 20]).toBeGreaterThan(.9);
  expect(bend.x.every(Number.isFinite) && bend.y.every(Number.isFinite)).toBe(true);
});

import { expect, it } from "vitest";
import { displaySide, displaySides } from "../../src/engine/image-renderer";

// Restates native crates/render/src/large_image_tests.rs `side` assertions at bad07e44 (upstream c82986b2).
it("decodes an image shown smaller than its pixels at the smallest copy side that holds the size shown", () => {
  expect(displaySides).toEqual([256, 512, 1024, 2048, 4096, 8192]);
  expect(displaySide(6000, 1500)).toBe(2048);
  expect(displaySide(4096, 100)).toBe(256);
  expect(displaySide(3000, 20)).toBe(256);
  expect(displaySide(200, 100), "no copy smaller than the image: the image itself").toBe(16_384);
  expect(displaySide(20_000, 9000), "past every copy: the image itself").toBe(16_384);
});

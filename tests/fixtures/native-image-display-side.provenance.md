# Native reference for zoomed-out image copies (upstream c82986b2, 503823f9)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the copy sizes are native renderer constants checked by native unit tests; the port restates them. The disposable `replay` oracle exports from the image itself, which this change leaves alone.

## Native tests restated

| Native test (`crates/render/src/large_image_tests.rs`) | Expected | Port case |
|---|---|---|
| The `side` assertions | `display_side(6000, 1500)` 2048; `(4096, 100)` 256; `(3000, 20)` 256; `(200, 100)` the image itself (16,384) | `tests/parity/image-display-side.test.ts` |
| Two 6000 × 8 images at 25% | Each drawn from a 2048 × 3 copy, only that copy decoded | `tests/e2e/image-rendering.spec.ts` "two large images reuse preview copies…" (was 4096 × 5) |

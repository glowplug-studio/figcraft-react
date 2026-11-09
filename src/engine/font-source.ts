import type { LocalFontName } from "./font-library";

/** Read OpenType faces from a user file or bundled font. Load the shaper on first use. */
export async function readFontFaces(bytes: Uint8Array, local?:LocalFontName) {
  const { ShapingFace, prepareShapingFace } = await import("./shaping-face");
  await prepareShapingFace();
  return ShapingFace.read(bytes,local);
}

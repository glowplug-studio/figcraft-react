// The browser build emits the upstream shaper and its separate WASM file.
// Node resolves the original package and reads its WASM file from disk.
export { Blob, Buffer, Direction, Face, Feature, Font, Variation, shape } from "harfbuzzjs";

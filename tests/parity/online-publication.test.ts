import { initialSnapshotSize } from "../../src/engine/sharing/session-postcard";
import { initialDocumentState, measureDocumentSnapshot } from "../../src/engine/sharing/document-session";
import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { decodeFigcraft, encodeFigcraftBlob } from "../../src/engine/file-format";
import { cleanOnlineName, prepareOnlineSnapshot, ONLINE_ARCHIVE_BYTES, PUBLIC_FILE_BYTES, validateOnlineSnapshot } from "../../src/engine/sharing/publication";

const file = "00000000-0001-4000-8000-000000002345"; // native test session 0x12345
const fixture = unzipSync(readFileSync(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url)))["Cover.figcraft"];

it("publishes the cleaned title on the new snapshot and preserves the source drawing", async () => {
  const { document, nextId } = await decodeFigcraft(fixture);
  const name = document.name;
  const snapshot = await prepareOnlineSnapshot(document, BigInt(nextId), file, " \u0085Design\u202e🌿\u2069 ");
  expect(await validateOnlineSnapshot(snapshot, file)).toMatchObject({ name: "Design🌿" });
  expect((await decodeFigcraft(snapshot)).document.nodes).toEqual(document.nodes);
  expect(document.name).toBe(name);
  const fallback = await prepareOnlineSnapshot(document, BigInt(nextId), file, " \u2066 ");
  expect((await validateOnlineSnapshot(fallback, file)).name).toBe(name);
  expect(cleanOnlineName("🌿".repeat(260))).toBe("🌿".repeat(256));
});

it("refuses local file history, malformed snapshots and oversized uploads", async () => {
  const entries = unzipSync(fixture);
  const withHistory = zipSync({ ...entries, "versions/1.json": strToU8("{}") });
  await expect(validateOnlineSnapshot(new Blob([new Uint8Array(withHistory)]), file)).rejects.toThrow("local file history");
  await expect(validateOnlineSnapshot(new Blob(["{}"]), file)).rejects.toThrow();
  await expect(validateOnlineSnapshot(new Blob([new Uint8Array(ONLINE_ARCHIVE_BYTES + 1)]), file)).rejects.toThrow("50 MiB");
});

it("accepts exactly 16 MiB of framed state and rejects one more byte on both publication paths", async () => {
  const { document, nextId } = await decodeFigcraft(fixture);
  const withNote = (note: string) => ({...document, nodes: {...document.nodes,
    "2": {...document.nodes["2"], sourceMetadata: { note }}}});
  const sizeFor = (note: string) => measureDocumentSnapshot(withNote(note), 0x12345n);
  // The property length prefix has the same width here as at the quota.
  const seed = "a".repeat(1 << 22);
  const used = await sizeFor(seed);
  const note = seed + "b".repeat(PUBLIC_FILE_BYTES - used);
  const archive = await prepareOnlineSnapshot(withNote(note), BigInt(nextId), file);
  expect(archive.size).toBeLessThan(100_000);
  expect(await validateOnlineSnapshot(archive, file)).toEqual({name: document.name, snapshotBytes: PUBLIC_FILE_BYTES});
  const over = withNote(note + "x");
  await expect(prepareOnlineSnapshot(over, BigInt(nextId), file)).rejects.toThrow("16 MiB");
  const unchecked = await encodeFigcraftBlob(over, nextId);
  await expect(validateOnlineSnapshot(unchecked, file)).rejects.toThrow("16 MiB");
}, 30_000);

it("measures image base64 padding and large images without reading their bytes", async () => {
  const { document } = await decodeFigcraft(fixture);
  class Unreadable extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error("Image bytes were read"); }
  }
  for (const length of [0, 1, 2, 3, 4, 400]) {
    const bytes = new Uint8Array(length);
    const image = {width: 32, height: 24, bytes: new Blob([bytes])};
    const expected = initialSnapshotSize(await initialDocumentState({...document, images: {picture: image}}, 0x12345n));
    const measured = {...document, images: {picture: {...image, bytes: new Unreadable([bytes])}}};
    expect(await measureDocumentSnapshot(measured, 0x12345n)).toBe(expected);
  }
});

it("accepts a valid archive above 16 MiB when the native framed drawing fits", async () => {
  const entries = unzipSync(fixture);
  const archive = zipSync({...entries, "thumbnail.png": new Uint8Array(PUBLIC_FILE_BYTES)}, { level: 0 });
  expect(archive.length).toBeGreaterThan(PUBLIC_FILE_BYTES);
  expect(await validateOnlineSnapshot(new Blob([new Uint8Array(archive)]), file))
    .toEqual({name: "Untitled", snapshotBytes: 406});
});

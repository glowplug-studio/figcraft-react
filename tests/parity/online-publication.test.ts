import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { decodeFigcraft } from "../../src/engine/file-format";
import { cleanOnlineName, prepareOnlineSnapshot, PUBLIC_FILE_BYTES, validateOnlineSnapshot } from "../../src/engine/sharing/publication";

const fixture = unzipSync(readFileSync(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url)))["Cover.figcraft"];

it("publishes the cleaned title on the new snapshot and preserves the source drawing", async () => {
  const { document, nextId } = await decodeFigcraft(fixture);
  const name = document.name;
  const snapshot = await prepareOnlineSnapshot(document, BigInt(nextId), " \u0085Design\u202e🌿\u2069 ");
  expect(await validateOnlineSnapshot(snapshot)).toEqual({ name: "Design🌿" });
  expect((await decodeFigcraft(snapshot)).document.nodes).toEqual(document.nodes);
  expect(document.name).toBe(name);
  const fallback = await prepareOnlineSnapshot(document, BigInt(nextId), " \u2066 ");
  expect((await validateOnlineSnapshot(fallback)).name).toBe(name);
  expect(cleanOnlineName("🌿".repeat(260))).toBe("🌿".repeat(256));
});

it("refuses local file history, malformed snapshots and oversized uploads", async () => {
  const entries = unzipSync(fixture);
  const withHistory = zipSync({ ...entries, "versions/1.json": strToU8("{}") });
  await expect(validateOnlineSnapshot(new Blob([new Uint8Array(withHistory)]))).rejects.toThrow("local file history");
  await expect(validateOnlineSnapshot(new Blob(["{}"]))).rejects.toThrow();
  await expect(validateOnlineSnapshot(new Blob([new Uint8Array(PUBLIC_FILE_BYTES + 1)]))).rejects.toThrow("16 MiB");
});

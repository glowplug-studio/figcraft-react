import { createHash } from "node:crypto";
import { initialDocumentState, measureDocumentSnapshot } from "../../src/engine/sharing/document-session";
import { decodeFigcraft } from "../../src/engine/file-format";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { parse, stringify, type LosslessNumber } from "lossless-json";
import { expect, it } from "vitest";
import { encodeInitialState, initialSnapshotSize, type InitialChange } from "../../src/engine/sharing/session-postcard";

const fixtures = unzipSync(readFileSync(new URL("../fixtures/native-initial-session-states.zip", import.meta.url)));

type ReferenceChange =
  | { create: { id: LosslessNumber; kind: unknown; parent: LosslessNumber | null; position: string; props: [string, unknown][] } }
  | { setDoc: { prop: string; value: unknown } }
  | { put: { entry: Record<string, string | LosslessNumber>; value: unknown } };

// Keep Rust's original number tokens inside the compact JSON property strings.
function readChange(change: ReferenceChange): InitialChange {
  if ("create" in change) {
    const { id, kind, parent, position, props } = change.create;
    return { type: "create", id: id.value, kind: stringify(kind)!, parent: parent?.value ?? null,
      position, props: props.map(([key, value]) => [key, stringify(value)!]) };
  }
  if ("setDoc" in change) {
    return { type: "setDoc", prop: change.setDoc.prop, value: stringify(change.setDoc.value)! };
  }
  const [[entry, key]] = Object.entries(change.put.entry);
  return { type: "put", entry, key: String(key), value: stringify(change.put.value)! };
}

it.each([
  ["Cover.figcraft", 406],
  ["native-branch-conflict.figcraft", 383],
  ["native-file-versions.figcraft", 2222],
] as const)("matches the complete upstream postcard body and framed size for %s", (file, framedBytes) => {
  const reference = parse(strFromU8(fixtures[file + "/state.json"])) as {
    session: LosslessNumber; next_client: LosslessNumber; snapshot: ReferenceChange[];
  };
  const state = { session: BigInt(reference.session.value), nextClient: Number(reference.next_client.value),
    changes: reference.snapshot.map(readChange) };
  expect(encodeInitialState(state)).toEqual(fixtures[file + "/body.bin"]);
  expect(initialSnapshotSize(state)).toBe(framedBytes);
});

const printFixture = unzipSync(readFileSync(new URL("../fixtures/native-pdf-print-dialog.zip", import.meta.url)));
const drawings = Object.keys(fixtures).filter(path => path.endsWith("/body.bin")).map(path => path.split("/")[0]);

it.each(drawings)("builds the upstream session directly from %s", async file => {
  const data = file === "Cover.figcraft" ? printFixture[file] : readFileSync(new URL("../fixtures/" + file, import.meta.url));
  const { document } = await decodeFigcraft(data);
  const state = await initialDocumentState(document, 0x12345n);
  const expected = fixtures[file + "/body.bin"];
  const actual = encodeInitialState(state);
  expect(Buffer.from(actual).equals(expected), file + ": expected " + expected.length + " bytes, got " + actual.length).toBe(true);
  expect(initialSnapshotSize(state)).toBe(expected.length + 17);
});

const corpus = JSON.parse(strFromU8(fixtures["corpus.json"])) as Record<string, Record<string, [number, string]>>;
it.each(Object.entries(corpus))("matches every distinct native session from %s", async (archive, entries) => {
  const drawings = unzipSync(readFileSync(new URL("../fixtures/" + archive, import.meta.url)), {
    filter: member => Object.hasOwn(entries, member.name),
  });
  for (const [name, [size, digest]] of Object.entries(entries)) {
    const { document } = await decodeFigcraft(drawings[name]);
    const state = await initialDocumentState(document, 0x12345n);
    const body = encodeInitialState(state);
    expect(createHash("sha256").update(body).digest("hex"), name).toBe(digest);
    expect(await measureDocumentSnapshot(document, 0x12345n), name).toBe(size + 17);
  }
});

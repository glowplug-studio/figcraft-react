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

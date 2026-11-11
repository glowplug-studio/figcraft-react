import { createHash } from "node:crypto";
import { initialDocumentState, measureDocumentSnapshot } from "../../src/engine/sharing/document-session";
import { encodeInitialState } from "../../src/engine/sharing/session-postcard";
import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { highestIdSpace, nextBranchClient } from "../../src/engine/branch-ids";
import { commentPosition } from "../../src/engine/comments";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";

const native = readFileSync(new URL("../fixtures/native-comment-threads.figcraft", import.meta.url));

it("retains native replies, reactions, resolution and the current conversation when restoring a design", async () => {
  const engine = EditorEngine.newTab();
  await engine.recoverFile(new Blob([new Uint8Array(native)]));
  const original = engine.getSnapshot().document.comments!;
  expect(original[0]).toMatchObject({ text: "Current inset", anchor: "3", readBy: ["Sam"],
    replies: [{ author: "Sam", text: "Looks right" }], reactions: [{ emoji: "👍", users: ["Lin"] }] });
  expect(original[1]).toMatchObject({ anchor: null, resolved: true, readBy: ["Lin"] });
  await engine.executeAsync("version.preview", { index: 0 });
  expect(engine.getSnapshot().document.comments![0].text).toBe("Review the inset");
  engine.execute("version.exitPreview");
  await engine.executeAsync("version.restore", { index: 0 });
  expect(engine.getSnapshot().document.comments).toEqual(original);
  expect((await decodeFigcraft((await engine.saveFile()).data)).document.comments).toEqual(original);
});

it("reanchors to the surviving frame and then to page coordinates, including after undo", async () => {
  const engine = EditorEngine.newTab();
  await engine.recoverFile(new Blob([new Uint8Array(native)]));
  const doc = () => engine.getSnapshot().document;
  const pin = () => doc().comments![0];
  const position = () => commentPosition(doc(), pin());
  expect(position()).toEqual({ x: 130, y: 140 });
  engine.execute("edit.delete", { ids: ["3"] });
  expect(pin()).toMatchObject({ anchor: "2", x: 30, y: 40 });
  engine.execute("node.set", { id: "2", props: { x: 200 } });
  expect(position()).toEqual({ x: 230, y: 140 });
  engine.execute("edit.delete", { ids: ["2"] });
  expect(pin()).toMatchObject({ anchor: null, x: 230, y: 140 });
  engine.execute("edit.undo");
  expect(pin().anchor).toBe("2");
  const recovered = await decodeFigcraft(await engine.nativeSnapshot());
  expect(recovered.document.comments).toEqual(doc().comments);
  const second = engine.execute("page.add", { name: "Second" }).id;
  engine.execute("page.select", { id: "1" });
  engine.execute("node.reparent", { id: "2", parent: second });
  expect(pin()).toMatchObject({ anchor: "2", page: second });
  expect(doc().comments![1].page).toBe("1");
});

it("round-trips unsigned 64-bit comment fields and distinguishes absent and empty read state", async () => {
  const members = unzipSync(native);
  const root = JSON.parse(strFromU8(members["document.json"]));
  const [first, second] = root.comments;
  first.id = "COMMENT_ID";
  first.replies[0].edited = "MAX_TIME";
  first.replies[0].agent = true;
  delete first.read_by;
  second.read_by = [];
  members["document.json"] = strToU8(JSON.stringify(root).replace('"COMMENT_ID"', "9007199254740993")
    .replace('"MAX_TIME"', "18446744073709551615"));
  const engine = EditorEngine.newTab();
  await engine.recoverFile(new Blob([new Uint8Array(zipSync(members))]));
  const { document } = await decodeFigcraft((await engine.saveFile()).data);
  expect(document.comments![0]).toMatchObject({ id: "9007199254740993", replies: [{ edited: "18446744073709551615", agent: true }] });
  expect(document.comments![0]).not.toHaveProperty("readBy");
  expect(document.comments![1].readBy).toEqual([]);
  expect(highestIdSpace(document)).toBe(2097152);
  expect(nextBranchClient(document, [])).toBe(2097153);
});


it("matches the pinned Rust collaboration snapshot including both threads and the framed size", async () => {
  const { document } = await decodeFigcraft(native);
  const state = await initialDocumentState(document, 0x12345n);
  const bytes = encodeInitialState(state);
  expect(createHash("sha256").update(bytes).digest("hex"))
    .toBe("bad2d4def3dbc6fbc7935d2bb7ffd891c162b93942194489fabc4cfc127d26cf");
  expect(await measureDocumentSnapshot(document, 0x12345n)).toBe(921);
});

it("merges independent threads and preserves legacy duplicate IDs as a whole list", async () => {
  const { planBranch } = await import("../../src/engine/branch-merge");
  const { applyBranch } = await import("../../src/engine/branch-apply");
  const { document } = await decodeFigcraft(native);
  const [first, second] = document.comments!;
  const main = { ...document, comments: [first, { ...second, text: "Main note" }] };
  const branch = { ...document, comments: [{ ...first, text: "Branch note" }, second] };
  const plan = planBranch(document, branch, main);
  expect(plan.conflicts).toEqual([]);
  expect(applyBranch(plan, "branch", {}).comments!.map(c => c.text)).toEqual(["Branch note", "Main note"]);
  const repeated = { ...document, comments: [first, { ...second, id: first.id }] };
  const legacy = planBranch(document, repeated, document);
  expect([...legacy.branch.files.keys()]).toEqual(["doc/comments"]);
  expect(applyBranch(legacy, "branch", {}).comments).toEqual(repeated.comments);
});

it("refuses unknown message fields atomically and legacy timestamps default to zero", async () => {
  const members = unzipSync(native);
  const raw = JSON.parse(strFromU8(members["document.json"]));
  delete raw.comments[0].created;
  members["document.json"] = strToU8(JSON.stringify(raw));
  const engine = EditorEngine.newTab();
  await engine.recoverFile(new Blob([new Uint8Array(zipSync(members))]));
  const before = engine.getSnapshot().document;
  expect(before.comments![0].created).toBe("0");
  raw.comments[0].replies[0].future = "Keep me";
  members["document.json"] = strToU8(JSON.stringify(raw));
  await expect(engine.openFile(new File([new Uint8Array(zipSync(members))], "Future.figcraft"))).rejects.toThrow(/future/);
  expect(engine.getSnapshot().document).toBe(before);
});

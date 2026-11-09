import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, readVersionDocument } from "../../src/engine/file-format";

const native = readFileSync(new URL("../fixtures/native-file-versions.figcraft", import.meta.url));

it("keeps the Rust named version, automatic checkpoint and publication through edit, recovery and download", async () => {
  const engine = new EditorEngine();
  await engine.openFile(new File([native], "Kit.figcraft"));
  engine.execute("file.rename", { name: "Current author drawing" });
  const fresh = new EditorEngine();
  await fresh.recoverFile(await engine.captureNativeSnapshot()());
  const reopened = await decodeFigcraft((await fresh.saveFile()).data);
  expect(reopened.document.name).toBe("Current author drawing");
  expect(reopened.document.published?.manifest.components.length).toBeGreaterThan(0);
  expect(reopened.versions?.map(v => [v.name, v.description, v.auto])).toEqual([
    ["First", "Signed off", false], ["Autosave", "", true],
  ]);
  const original = await decodeFigcraft(native);
  for (const [i, version] of reopened.versions!.entries()) {
    expect(version.id).toBe(original.versions![i].id);
    const before = await readVersionDocument(original.versions![i]);
    const after = await readVersionDocument(version);
    expect(after).toEqual(before);
    expect(after.document.name).toBe(i ? "After rename" : "Before rename");
  }
});

it("isolates history-only images and retains their bytes in a reopened archive", async () => {
  const members = unzipSync(native);
  const index = JSON.parse(new TextDecoder().decode(members["versions/index.json"]));
  index.versions[0].images = ["history-image"];
  members["versions/index.json"] = strToU8(JSON.stringify(index));
  members["images/history-image"] = readFileSync(new URL("../fixtures/images/icc-grey.png", import.meta.url));
  const engine = new EditorEngine();
  await engine.recoverFile(new Blob([new Uint8Array(zipSync(members))]));
  expect(engine.getSnapshot().document.images?.["history-image"]).toBeUndefined();
  const archive = await engine.nativeSnapshot();
  const history = (await decodeFigcraft(archive)).versions!;
  const snapshot = await readVersionDocument(history[0]);
  expect(new Uint8Array(await snapshot.document.images!["history-image"].bytes.arrayBuffer())).toEqual(new Uint8Array(members["images/history-image"]));
  expect((await readVersionDocument(history[1])).document.images).toBeUndefined();
});

it("reports invalid, duplicate and missing versions and keeps a damaged lazy snapshot available for round trips", async () => {
  const members = unzipSync(native);
  const index = JSON.parse(new TextDecoder().decode(members["versions/index.json"]));
  index.versions.unshift({ id: "../unsafe" }, { id: "missing" });
  index.versions.push(index.versions[2], { id: "broken", name: "Broken" });
  members["versions/broken.json"] = strToU8("{");
  members["versions/index.json"] = strToU8(JSON.stringify(index));
  const decoded = await decodeFigcraft(zipSync(members));
  expect(decoded.issues).toHaveLength(3);
  expect(decoded.versions).toHaveLength(3);
  await expect(readVersionDocument(decoded.versions![2])).rejects.toThrow();
});

it("replays named, automatic, renamed, deleted, previewed and restored versions from pinned Rust", async () => {
  const engine = EditorEngine.newTab();
  expect(engine.execute("version.autosave")).toEqual({ saved: false });
  const first = engine.execute("file.saveVersion", { name: "   ", description: "  Start  " });
  expect(first).toMatchObject({ index: 0, name: "Version 1", description: "Start" });
  expect(engine.execute("version.autosave")).toEqual({ saved: false });
  engine.execute("shape.rectangle");
  expect(engine.execute("version.autosave")).toMatchObject({ saved: true, version: { name: "Autosave", index: 1, auto: true } });
  engine.execute("version.rename", { index: 1, name: "  Geometry  ", description: "Checkpoint" });
  engine.execute("version.delete", { index: 0 });
  const current = engine.getSnapshot();
  await engine.executeAsync("version.preview", { index: 0 });
  expect(engine.getSnapshot()).toMatchObject({ editable: false, selection: [] });
  expect(() => engine.execute("shape.rectangle")).toThrow(/viewing an earlier version/);
  expect(engine.execute("version.list")).toMatchObject([{ name: "Geometry", description: "Checkpoint", previewing: true }]);
  expect(engine.execute("version.exitPreview")).toEqual({ ended: true });
  expect(engine.getSnapshot().document).toBe(current.document);
  expect(engine.getSnapshot().selection).toEqual(current.selection);
  engine.execute("file.rename", { name: "Revised" });
  await engine.executeAsync("version.restore", { index: 0 });
  expect(engine.getSnapshot().document.name).toBe("Revised");
  expect(engine.execute("version.list")).toMatchObject([{ name: "Geometry" }, { name: "Autosave", auto: true }]);
  engine.execute("edit.undo");
  expect(engine.execute("version.list")).toHaveLength(2);
});

it("keeps at most twenty automatic versions without pruning named checkpoints", () => {
  const engine = EditorEngine.newTab();
  engine.execute("file.saveVersion", { name: "Keep" });
  for (let i = 0; i < 24; i++) {
    engine.execute("file.rename", { name: "Drawing " + i });
    engine.execute("version.autosave");
  }
  const records = engine.execute("version.list");
  expect(records).toHaveLength(21);
  expect(records[0].name).toBe("Keep");
  while (engine.versions.length < 100) engine.execute("file.saveVersion");
  expect(() => engine.execute("file.saveVersion")).toThrow(/full/);
  engine.execute("version.rename", { id: records[1].id, name: "Keep too" });
  expect(engine.execute("version.list")[1]).not.toHaveProperty("auto");
});

it("captures file metadata at download time and recovers the live document while previewing", async () => {
  const engine = EditorEngine.newTab();
  engine.execute("file.saveVersion", { name: "Blank" });
  const pending = engine.saveFile();
  engine.execute("version.rename", { index: 0, name: "Earlier" });
  const { revision } = await pending;
  engine.execute("file.markSaved", { revision });
  expect(engine.getSnapshot().dirty).toBe(true);
  engine.execute("shape.rectangle");
  const current = engine.getSnapshot().document;
  await engine.executeAsync("version.preview", { index: 0 });
  expect(Object.keys(engine.getSnapshot().document.nodes)).toHaveLength(1);
  const recovered = await decodeFigcraft(await engine.captureNativeSnapshot()());
  expect(Object.keys(recovered.document.nodes)).toHaveLength(2);
  expect(recovered.versions?.[0].name).toBe("Earlier");
  const saved = await engine.saveFile();
  expect(engine.getSnapshot().document).toBe(current);
  engine.execute("file.markSaved", { revision: saved.revision });
  expect(engine.getSnapshot().dirty).toBe(false);
});

it("duplicates a version in an independent clean tab and refuses completions after sign-out", async () => {
  const { EditorWorkspace } = await import("../../src/engine/workspace");
  const workspace = new EditorWorkspace(), engine = workspace.activeEngine!;
  engine.execute("file.saveVersion", { name: "Blank" });
  engine.execute("shape.rectangle");
  expect(await workspace.duplicateVersion({ index: 0 })).toEqual({ index: 1 });
  expect(workspace.activeEngine!.getSnapshot()).toMatchObject({ dirty: false, canUndo: false, document: { name: "Untitled (Blank)" } });
  expect(workspace.activeEngine!.versions).toHaveLength(0);
  workspace.execute("doc.switch", { index: 0 });
  const pending = engine.executeAsync("version.preview", { index: 0 });
  workspace.setEditable(false);
  await expect(pending).rejects.toThrow();
  expect(engine.getSnapshot().previewVersionId).toBeUndefined();
  expect(() => engine.execute("version.list")).toThrow();
});

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

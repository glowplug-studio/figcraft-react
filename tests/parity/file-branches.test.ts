import { EditorWorkspace } from "../../src/engine/workspace";
import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, readVersionDocument } from "../../src/engine/file-format";

const native = readFileSync(new URL("../fixtures/file-branches.figcraft", import.meta.url));

it("retains native branch snapshots, client namespaces and nested history through recovery and save", async () => {
  const engine = EditorEngine.newTab();
  const opened = await engine.recoverFile(new Blob([new Uint8Array(native)]));
  expect(opened.repairs).toEqual([]);
  const inspect = async (input: Blob | Uint8Array) => {
    const { branches, document, issues } = await decodeFigcraft(input);
    expect(issues).toBeUndefined();
    expect(document.nodes["4294967297"]).toBeUndefined();
    expect(branches?.map(b => [b.name, b.client, b.state])).toEqual([["Review", 1, "active"], ["Alternate", 2, "archived"]]);
    const [review, alternate] = branches!;
    expect(review.base.document.nodes["4294967297"]).toBeUndefined();
    expect(review.head.document.nodes["4294967297"].name).toBe("Branch shape");
    expect(alternate.head.document.nodes["8589934593"].name).toBe("Other shape");
    const ready = review.versions.find(version => version.name === "Ready")!;
    expect((await readVersionDocument(ready)).document.nodes["4294967297"].kind).toBe("ellipse");
  };
  await inspect(await engine.captureNativeSnapshot()());
  engine.execute("shape.rectangle", { name: "Main edit" });
  await inspect((await engine.saveFile()).data);
});

it("reports damaged branches and preserves images present only in a branch", async () => {
  const members = unzipSync(native);
  const index = JSON.parse(strFromU8(members["branches/index.json"]));
  index.branches.unshift({ id: "../invalid" }, { id: "missing" });
  index.branches[2].headImages = ["branch-image"];
  members["branches/index.json"] = strToU8(JSON.stringify(index));
  members["images/branch-image"] = readFileSync(new URL("../fixtures/images/icc-grey.png", import.meta.url));
  const { branches, issues, document } = await decodeFigcraft(zipSync(members));
  expect(issues).toHaveLength(2);
  expect(branches).toHaveLength(2);
  expect(document.images).toBeUndefined();
  expect(branches![0].base.document.images).toBeUndefined();
  const bytes = await branches![0].head.document.images!["branch-image"].bytes.arrayBuffer();
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array(members["images/branch-image"]));
});

it("keeps branch edits in their main file across tab reorder, close, download and recovery", async () => {
  const workspace = new EditorWorkspace();
  const main = workspace.activeEngine!;
  main.execute("shape.rectangle", { name: "Keep" });
  const created = workspace.execute("branch.create", { name: " Review " });
  expect(created).toMatchObject({ name: "Review", index: 1 });
  const branch = workspace.activeEngine!;
  expect(() => workspace.execute("branch.create")).toThrow(/main file/);
  branch.execute("shape.ellipse", { name: "Branch shape" });
  expect(branch.getSnapshot().selection).toEqual(["4294967297"]);
  branch.execute("file.saveVersion", { name: "Ready" });
  const saved = await workspace.prepareDownload();
  branch.execute("shape.rectangle", { name: "Later" });
  saved.delivered();
  expect(branch.getSnapshot().dirty).toBe(true);
  expect(main.getSnapshot().dirty).toBe(true);
  expect(workspace.recoveryFiles).toEqual({ engines: [main], active: 0 });
  const captured = await decodeFigcraft(saved.data);
  expect(captured.document.nodes["4294967297"]).toBeUndefined();
  expect(captured.branches![0].head.document.nodes["4294967298"]).toBeUndefined();
  (await workspace.prepareDownload()).delivered();
  expect(main.getSnapshot().dirty).toBe(false);
  expect(branch.getSnapshot().dirty).toBe(false);
  workspace.execute("file.moveTab", { from: 1, to: 0 });
  expect(workspace.execute("branch.list")[0]).toMatchObject({ id: created.id, index: 0, state: "active" });
  workspace.execute("file.close");
  expect(workspace.activeEngine).toBe(main);
  workspace.execute("branch.open", { id: created.id });
  expect(workspace.activeEngine!.versions.map(v => v.name)).toEqual(["Branch created", "Ready"]);
  workspace.activeEngine!.execute("shape.rectangle");
  expect(workspace.activeEngine!.getSnapshot().selection).toEqual(["4294967299"]);
  expect(workspace.execute("branch.archive")).toEqual({ archived: true });
  expect(workspace.activeEngine).toBe(main);
  expect(workspace.execute("branch.list")[0]).toMatchObject({ state: "archived" });
  workspace.execute("branch.open", { id: created.id });
  workspace.execute("file.close", { index: 0, force: true });
  expect(workspace.engines).toHaveLength(0);
});

it("uses the native branch client counter for local nodes, collections, added modes and styles", () => {
  const workspace = new EditorWorkspace();
  const { id } = workspace.execute("branch.create", { name: "IDs" });
  const engine = workspace.activeEngine!;
  expect(engine.execute("variable.createCollection", { name: "Colours", modes: ["Day", "Night"] })).toEqual({ id: "VariableCollectionId:4294967297" });
  expect(engine.execute("variable.addMode", { collection: "Colours", name: "Other" })).toEqual({ id: "VariableCollectionId:4294967297/mode4294967298" });
  expect(engine.execute("shape.rectangle")).toEqual({ id: "4294967299" });
  expect(engine.execute("style.create", { name: "Fill", type: "paint" })).toEqual({ id: "S:4294967300" });
  workspace.execute("file.close");
  workspace.execute("branch.open", { id });
  expect(workspace.activeEngine!.execute("style.duplicate", { style: "S:4294967300" })).toMatchObject({ id: "S:4294967301" });
});

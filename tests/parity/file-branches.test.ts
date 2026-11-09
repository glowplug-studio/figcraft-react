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

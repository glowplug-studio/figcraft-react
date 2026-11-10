import { expect, it } from "vitest";
import cases from "../fixtures/native-branch-reviews.json";
import { EditorWorkspace } from "../../src/engine/workspace";
import combinations from "../fixtures/native-branch-combinations.json";
import { layerTransform } from "../../src/engine/document";
import rich from "../fixtures/native-branch-layout-paint-merge.json";
import { wireNode } from "../../src/engine/file-format";
import { readPaints } from "../../src/engine/solid-paint";
import { stringify } from "lossless-json";

it.each(cases)("replays the upstream branch review for $name", ({commands, review}) => {
  const workspace = new EditorWorkspace();
  let id: unknown;
  for (const input of commands) {
    const command = input[0] as string, params = input[1] as Record<string, unknown>;
    if (command === "branch.create") id = workspace.execute(command, params).id;
    else if (command === "doc.switch") workspace.execute(command, params);
    else if (command === "branch.review") expect(workspace.execute(command)).toEqual({ ...review, id });
    else workspace.activeEngine!.execute(command, params);
  }
});


it.each(combinations)("applies native resolved changes for $name", ({commands, result, layers}) => {
  const workspace = new EditorWorkspace();
  for (const input of commands) {
    const command = input[0] as string, params = input[1] as Record<string, unknown>;
    if (command === "branch.create") workspace.execute(command, params);
    else if (command === "doc.switch") workspace.execute(command, params);
    else if (command === "branch.review") continue;
    else if (command === "branch.merge" || command === "branch.updateFromMain") expect(workspace.execute(command, params)).toEqual(result);
    else workspace.activeEngine!.execute(command, params);
  }
  const doc = workspace.activeEngine!.getSnapshot().document;
  expect(Object.keys(doc.nodes).sort()).toEqual(Object.keys(layers).sort());
  for (const [id, golden] of Object.entries(layers)) {
    const n = doc.nodes[id];
    expect(n.name).toBe(golden.name);
    if ("children" in n) expect(n.children).toEqual((golden.children ?? []).map(String));
    if (n.kind === "page") continue;
    expect(n.width).toBe(golden.width);
    expect(n.height).toBe(golden.height);
    expect(n.opacity ?? 1).toBeCloseTo(golden.opacity ?? 1);
    expect(n.visible ?? true).toBe(golden.visible ?? true);
    expect([...layerTransform(n)]).toEqual(golden.transform ?? [1, 0, 0, 1, 0, 0]);
  }
});


it.each(rich)("matches upstream layout, paint and subtree merge for $name", ({commands, conflicts, result, layers}) => {
  const workspace = new EditorWorkspace();
  for (const input of commands) {
    const command = input[0] as string, params = input[1] as Record<string, unknown>;
    if (command === "branch.create") workspace.execute(command, params);
    else if (command === "doc.switch") workspace.execute(command, params);
    else if (command === "branch.review") expect(workspace.execute(command).conflicts).toEqual(conflicts);
    else if (command === "branch.merge" || command === "branch.updateFromMain") expect(workspace.execute(command, params)).toEqual(result);
    else workspace.activeEngine!.execute(command, params);
  }
  const nodes = workspace.activeEngine!.getSnapshot().document.nodes;
  expect(Object.keys(nodes).sort()).toEqual(Object.keys(layers).sort());
  for (const [id, expected] of Object.entries(layers)) {
    const wire = JSON.parse(stringify(wireNode(id, nodes[id]))!);
    for (const key of ["width", "height", "transform", "children", "parent", "layout", "fills"] as const) {
      const raw = expected as Record<string, unknown>;
      const fallback = key === "transform" ? [1, 0, 0, 1, 0, 0] : key === "children" || key === "fills" ? [] : undefined;
      if (key === "fills") {
        expect(readPaints(wire.fills ?? [])).toEqual(readPaints(raw.fills ?? []));
      } else if (key === "layout" && raw.layout) {
        expect(wire.layout).toMatchObject(raw.layout as object);
      } else expect(wire[key] ?? fallback).toEqual(raw[key] ?? fallback);
    }
  }
});

it("refuses unresolved or invalid conflicts atomically and starts a new undo history after updating", async () => {
  const workspace = new EditorWorkspace();
  const main = workspace.activeEngine!;
  main.execute("shape.rectangle", { name: "Box" });
  workspace.execute("branch.create", { name: "Proposed" });
  const branch = workspace.activeEngine!;
  branch.execute("node.set", { id: 2, props: { width: 40 } });
  main.execute("node.set", { id: 2, props: { width: 70 } });
  const capture = main.archiveRevision;
  expect(() => workspace.execute("branch.merge")).toThrow(/2\/width/);
  expect(() => workspace.execute("branch.merge", { resolutions: { "2/width": "both" } })).toThrow(/branch or main/);
  expect(main.archiveRevision).toBe(capture);
  workspace.execute("branch.updateFromMain", { resolutions: { "2/width": "branch" } });
  expect(branch.versions.map(v => v.name)).toEqual(["Branch created", "Updated from main"]);
  expect(branch.getSnapshot().canUndo).toBe(false);
  expect(workspace.execute("branch.review").conflicts).toHaveLength(0);
  branch.execute("file.saveVersion", { name: "Before" });
  branch.execute("shape.rectangle");
  await branch.executeAsync("version.restore", { index: 2 });
  expect(branch.versions.map(v => v.name)).toEqual(["Branch created", "Updated from main", "Before"]);
  workspace.execute("branch.merge");
  expect(main.getSnapshot().document.nodes["2"]).toMatchObject({ width: 40 });
  main.execute("edit.undo");
  expect(main.getSnapshot().document.nodes["2"]).toMatchObject({ width: 70 });
  expect(main.branches[0].state).toBe("merged");
});

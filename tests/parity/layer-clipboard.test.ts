import { stringify } from "lossless-json";
import { expect, it } from "vitest";
import { EditorWorkspace } from "../../src/engine/workspace";
import { wireNode } from "../../src/engine/file-format";
import cases from "../fixtures/native-layer-clipboard.json";

it.each(cases)("matches native clipboard behaviour for $name", ({ commands, results, selection, nodes }) => {
  const workspace = new EditorWorkspace();
  const expected = results as Record<string, { error?: string } | undefined>;
  commands.forEach((entry, index) => {
    const command = String(entry[0]), params = entry[1] as Record<string, unknown>;
    const execute = () => command === "file.new" ? workspace.execute(command, params) : workspace.activeEngine!.execute(command, params);
    if (expected[index]?.error) expect(execute).toThrow(/pages can't be copied/i);
    else {
      const actual = execute();
      if (expected[index]) expect(actual).toEqual(expected[index]);
    }
  });
  const snapshot = workspace.activeEngine!.getSnapshot();
  expect(snapshot.selection).toEqual(selection.map(String));
  expect(Object.keys(snapshot.document.nodes)).toEqual(Object.keys(nodes));
  for (const [id, expected] of Object.entries(nodes)) {
    const wire = JSON.parse(stringify(wireNode(id, snapshot.document.nodes[id]))!);
    for (const [k, value] of Object.entries(expected)) {
      const fallback = k === "children" ? [] : k === "transform" ? [1, 0, 0, 1, 0, 0] : undefined;
      expect(wire[k] ?? fallback, id + "." + k).toEqual(value);
    }
  }
});

import { readFileSync } from "node:fs";
import libraries from "../fixtures/native-clipboard-libraries.json";

it.each(libraries)("retains the native library and source IDs for $name", async ({ commands, nodes, records, selection, inserted }) => {
  const workspace = new EditorWorkspace();
  const file = new File([readFileSync(new URL("../fixtures/native-component-library-v1.figcraft", import.meta.url))], "Kit1.figcraft");
  for (const entry of commands) {
    const command = String(entry[0]), params = entry[1] as Record<string, unknown>;
    if (command === "library.add") await workspace.activeEngine!.pickLibrary(file);
    else if (command === "file.open") await workspace.open(file);
    else if (command === "file.new") workspace.execute(command, params);
    else workspace.activeEngine!.execute(command, params);
  }
  const snap = workspace.activeEngine!.getSnapshot();
  expect(snap.selection).toEqual(selection.map(String));
  expect(Object.keys(snap.document.nodes)).toEqual(Object.keys(nodes));
  for (const [id, expected] of Object.entries(nodes)) {
    const wire = JSON.parse(stringify(wireNode(id, snap.document.nodes[id]))!);
    expect(wire).toMatchObject(expected);
  }
  expect(snap.document.libraryStore?.components ?? []).toEqual(records.map(r => ({ ...r, key: String(r.key), root: String(r.root), version: String(r.version),
    ids: Object.fromEntries(Object.entries(r.ids).map(([key, value]) => [key, String(value)])) })));
  expect(snap.document.libraryStore?.inserted ?? []).toEqual(inserted.map(r => ({ ...r, key: String(r.key) })));
});

it("keeps the last accepted copy after a refused cut and clears it when the account leaves an empty workspace", async () => {
  const workspace = new EditorWorkspace(), engine = workspace.activeEngine!;
  const file = new File([readFileSync(new URL("../fixtures/native-component-library-v1.figcraft", import.meta.url))], "Kit.figcraft");
  const { id: library } = await engine.pickLibrary(file);
  engine.execute("library.place", { library, component: "Button", x: 100, y: 50 });
  engine.execute("shape.rectangle", { name: "Kept" });
  engine.execute("edit.copy");
  expect(() => engine.execute("edit.cut", { ids: [3] })).toThrow();
  const result = engine.execute("edit.paste");
  expect(engine.getSnapshot().document.nodes[String((result.ids as number[])[0])].name).toBe("Kept");
  workspace.execute("file.close", { force: true });
  expect(workspace.activeEngine).toBeUndefined();
  workspace.setEditable(false); workspace.setEditable(true);
  workspace.execute("file.new");
  expect(() => workspace.activeEngine!.execute("edit.paste")).toThrow(/clipboard is empty/i);
});
